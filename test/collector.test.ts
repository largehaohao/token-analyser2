import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createNodeCollectorFs } from '../lib/node-fs';
import { contextInventoryIndex, contextSessionKey } from '../lib/context-inventory';
import { consumeJsonlChunk, isSessionLogFile } from '../lib/jsonl-cursor';
import { createCollector, type CollectorFs } from '../lib/collector-service';

test('accepts session log extensions and ignores other files', () => {
  assert.equal(isSessionLogFile('session.jsonl'), true);
  assert.equal(isSessionLogFile('nested/run.ndjson'), true);
  assert.equal(isSessionLogFile('notes.md'), false);
  assert.equal(isSessionLogFile('.DS_Store'), false);
});

test('holds back an incomplete trailing line until the newline arrives', () => {
  const first = consumeJsonlChunk('', '{"type":"user"}\n{"type":"ass');
  assert.deepEqual(first.lines, ['{"type":"user"}']);
  assert.equal(first.pending, '{"type":"ass');
  const second = consumeJsonlChunk(first.pending, 'istant"}\n');
  assert.deepEqual(second.lines, ['{"type":"assistant"}']);
  assert.equal(second.pending, '');
});

function memoryFs(files: Record<string, string>): CollectorFs & { write(path: string, content: string): void } {
  const store = { ...files };
  return {
    async realpath(path) {
      return path;
    },
    async homeDir() {
      return '/home/dev';
    },
    async stat(path) {
      if (store[path] !== undefined) return { kind: 'file' as const, size: Buffer.byteLength(store[path]), mtimeMs: 1 };
      const prefix = path.endsWith('/') ? path : path + '/';
      const hasChildren = Object.keys(store).some((key) => key.startsWith(prefix) || key === path);
      if (!hasChildren) throw new Error('ENOENT ' + path);
      return { kind: 'directory' as const, size: 0, mtimeMs: 1 };
    },
    async readdir(path) {
      const prefix = path.endsWith('/') ? path : path + '/';
      const names = new Set<string>();
      for (const key of Object.keys(store)) {
        if (!key.startsWith(prefix)) continue;
        const rest = key.slice(prefix.length);
        const name = rest.split('/')[0];
        if (name) names.add(name);
      }
      return [...names].map((name) => {
        const child = prefix + name;
        const isFile = store[child] !== undefined;
        return { name, kind: isFile ? 'file' as const : 'directory' as const };
      });
    },
    async read(path, offset) {
      const content = store[path];
      if (content === undefined) throw new Error('ENOENT ' + path);
      const buffer = Buffer.from(content);
      return { chunk: buffer.subarray(offset).toString('utf8'), size: buffer.length };
    },
    write(path: string, content: string) {
      store[path] = content;
    },
  };
}

test('enriches session names without changing accounting, refreshes renames and retains incremental cwd', async () => {
  const log = '/logs/codex.jsonl';
  const initial = [
    { type: 'session_meta', payload: { id: 'named', cwd: '/projects/app', title: 'Original' } },
    { type: 'assistant', session_id: 'named', message: { id: 'a', model: 'gpt-5.6-sol', usage: { input_tokens: 10, output_tokens: 2 } } },
  ].map((row) => JSON.stringify(row)).join('\n') + '\n';
  const fs = memoryFs({ [log]: initial });
  let title = 'Saved name';
  fs.sessionMetadata = async () => new Map([['named', { title }]]);
  const collector = createCollector(fs);
  await collector.start('/logs');
  const first = collector.snapshot().analysis!;
  const revision = collector.statusSnapshot().revision;
  await collector.poll();
  assert.equal(collector.statusSnapshot().revision, revision);
  assert.equal(first.sessions[0].title, 'Saved name');
  assert.equal(first.sessions[0].cwd, '/projects/app');
  title = 'Renamed';
  await collector.poll();
  assert.notEqual(collector.statusSnapshot().revision, revision);
  assert.equal(collector.snapshot().analysis!.sessions[0].title, title);
  assert.deepEqual(collector.snapshot().analysis!.usage, first.usage);
  assert.deepEqual(collector.snapshot().analysis!.cost, first.cost);
  fs.write(log, initial + JSON.stringify({ type: 'assistant', session_id: 'named', message: { id: 'b', model: 'gpt-5.6-sol', usage: { input_tokens: 20, output_tokens: 3 } } }) + '\n');
  await collector.poll();
  assert.equal(collector.rawSnapshot().events.find((event) => event.callId === 'b')?.cwd, '/projects/app');
  assert.equal(collector.snapshot().analysis!.calls.length, 2);
});

test('reads Codex saved names read-only and falls back to index for unsupported database schemas', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'tokenscope-metadata-'));
  const root = path.join(temp, '.codex');
  try {
    await mkdir(root);
    const indexPath = path.join(root, 'session_index.jsonl');
    await writeFile(indexPath, '{"id":"a","thread_name":"Index title"}\n{"id":"b","thread_name":"Index only"}\n{"unfinished":');
    const databasePath = path.join(root, 'state_5.sqlite');
    const db = new DatabaseSync(databasePath);
    db.exec('CREATE TABLE threads (id TEXT, name TEXT, title TEXT, agent_nickname TEXT, cwd TEXT)');
    db.prepare('INSERT INTO threads VALUES (?, ?, ?, ?, ?)').run('a', 'Saved title', 'Old title', '', '/projects/app');
    db.prepare('INSERT INTO threads VALUES (?, ?, ?, ?, ?)').run('child', '', '', 'Fermat', '/projects/app');
    db.close();
    const before = await readFile(databasePath);
    const fs = createNodeCollectorFs();
    const metadata = await fs.sessionMetadata!(root);
    assert.deepEqual(metadata.get('a'), { title: 'Saved title', cwd: '/projects/app' });
    assert.equal(metadata.get('child')?.title, 'Fermat');
    assert.equal(metadata.get('b')?.title, 'Index only');
    assert.deepEqual(await readFile(databasePath), before);
    await writeFile(databasePath, 'unsupported database');
    assert.equal((await fs.sessionMetadata!(root)).get('a')?.title, 'Index title');
    assert.equal((await fs.sessionMetadata!(temp)).size, 0);
  } finally { await rm(temp, { recursive: true, force: true }); }
});

test('keeps collecting after a dashboard client disconnects', async () => {
  const fs = memoryFs({
    '/logs/session.jsonl': JSON.stringify({
      type: 'assistant',
      session_id: 'live-1',
      message: { id: 'msg-1', model: 'gpt-5.6-sol', usage: { input_tokens: 100, output_tokens: 10 } },
    }) + '\n',
  });
  const collector = createCollector(fs);
  await collector.start('/logs');
  const first = collector.snapshot();
  assert.equal(first.status, 'collecting');
  assert.equal(first.analysis?.calls.length, 1);

  fs.write(
    '/logs/session.jsonl',
    (await fs.read('/logs/session.jsonl', 0)).chunk +
      JSON.stringify({
        type: 'assistant',
        session_id: 'live-1',
        message: { id: 'msg-2', model: 'gpt-5.6-sol', usage: { input_tokens: 50, output_tokens: 5 } },
      }) +
      '\n',
  );
  await collector.poll();
  const afterDisconnect = collector.snapshot();
  assert.equal(afterDisconnect.status, 'collecting');
  assert.equal(afterDisconnect.analysis?.calls.length, 2);

  collector.stop();
  assert.equal(collector.snapshot().status, 'stopped');
  assert.equal(collector.snapshot().analysis?.calls.length, 2);
  collector.clear();
  assert.equal(collector.snapshot().status, 'idle');
  assert.equal(collector.snapshot().analysis, undefined);
});

test('incremental collection retains context snapshots and replaces the latest catalog without adding lengths', async () => {
  const line = (text: string, timestamp: string) => JSON.stringify({ type: 'response_item', session_id: 'context-live', timestamp, payload: { role: 'developer', content: [{ type: 'input_text', text }] } }) + '\n';
  const initial = line('## Skills\n- first: a long description', '2026-08-28T10:00:00Z');
  const updated = '## Skills\n- second: short';
  const fs = memoryFs({ '/logs/codex.jsonl': initial });
  const collector = createCollector(fs);
  await collector.start('/logs');
  fs.write('/logs/codex.jsonl', initial + line(updated, '2026-08-28T10:01:00Z'));
  await collector.poll();
  const raw = collector.rawSnapshot();
  const inventory = contextInventoryIndex(raw.events).get(contextSessionKey('codex', 'context-live'))!;
  assert.equal(inventory.observations.skills, 2);
  assert.equal(inventory.skills?.sourceLine, 2);
  assert.equal(inventory.skills?.contextSnapshot?.chars, [...updated].length);
  assert.equal(collector.snapshot().analysis?.calls.length, 0);
  assert.equal(raw.errors.length, 0);
});

test('does not treat a growing tail as a parse error and only counts the line once', async () => {
  const fs = memoryFs({
    '/logs/session.jsonl': '{"type":"assistant","session_id":"tail","message":{"id":"msg-1","model":"gpt-5.6-sol","usage":{"input_tokens":10,"output_tokens":1}}\n',
  });
  const collector = createCollector(fs);
  await collector.start('/logs');
  assert.equal(collector.snapshot().analysis?.errors.length ?? 0, 0);
  assert.equal(collector.snapshot().analysis?.calls.length ?? 0, 0);

  fs.write(
    '/logs/session.jsonl',
    '{"type":"assistant","session_id":"tail","message":{"id":"msg-1","model":"gpt-5.6-sol","usage":{"input_tokens":10,"output_tokens":1}}}\n',
  );
  await collector.poll();
  assert.equal(collector.snapshot().analysis?.calls.length, 1);
  assert.equal(collector.snapshot().analysis?.errors.length ?? 0, 0);
});

test('keeps Codex desktop model snapshots distinct with stable file session ownership', async () => {
  const file = [
    JSON.stringify({
      type: 'session_meta',
      payload: {
        session_id: 'parent-session',
        id: 'child-session',
        parent_thread_id: 'parent-session',
      },
    }),
    JSON.stringify({
      type: 'turn_context',
      payload: { model: 'gpt-5.6-sol' },
    }),
    JSON.stringify({
      type: 'event_msg',
      payload: {
        type: 'token_count',
        info: { total_token_usage: { input_tokens: 10, cached_input_tokens: 4, output_tokens: 1 } },
      },
    }),
    JSON.stringify({
      type: 'event_msg',
      payload: {
        type: 'token_count',
        info: { total_token_usage: { input_tokens: 25, cached_input_tokens: 12, output_tokens: 2 } },
      },
    }),
  ].join('\n') + '\n';
  const fs = memoryFs({ '/logs/rollout-2026-08-28T12-00-00-child-session.jsonl': file });
  const collector = createCollector(fs);

  await collector.start('/logs');
  const analysis = collector.snapshot().analysis;
  assert.equal(analysis?.calls.length, 2);
  assert.equal(analysis?.sessions.length, 1);
  assert.equal(analysis?.sessions[0]?.id, 'child-session');
  assert.equal(analysis?.sessions[0]?.parentSessionId, 'parent-session');
  assert.equal(analysis?.calls[0]?.sourceLine, 3);
  assert.equal(analysis?.calls[1]?.sourceLine, 4);
  assert.equal(analysis?.calls[0]?.model, 'gpt-5.6-sol');
  assert.equal(analysis?.usage.totalTokens, 27);
});

test('scans Codex root sessions without ingesting unrelated JSON files', async () => {
  const usage = (sessionId: string, input: number) => JSON.stringify({
    type: 'assistant',
    session_id: sessionId,
    message: { id: 'message-' + input, model: 'gpt-5.6-sol', usage: { input_tokens: input, output_tokens: 1 } },
  }) + '\n';
  const fs = memoryFs({
    '/home/dev/.codex/.chatgpt-projects/metadata.json': '{not a session log}',
    '/home/dev/.codex/sessions/active.jsonl': usage('active', 10),
    '/home/dev/.codex/archived_sessions/archived.jsonl': usage('archived', 20),
  });
  const collector = createCollector(fs);

  await collector.start('/home/dev/.codex');
  const analysis = collector.snapshot().analysis;
  assert.equal(analysis?.errors.length ?? 0, 0);
  assert.equal(analysis?.calls.length, 2);
  assert.deepEqual(
    analysis?.sessions.map((session) => session.id).sort(),
    ['active', 'archived'],
  );
});

test('exposes a lightweight status snapshot without forcing analysis rebuilds', async () => {
  const fs = memoryFs({
    '/logs/session.jsonl': JSON.stringify({
      type: 'assistant',
      session_id: 'status-1',
      message: { id: 'status-msg', model: 'gpt-5.6-sol', usage: { input_tokens: 10, output_tokens: 1 } },
    }) + '\n',
  });
  const collector = createCollector(fs);
  await collector.start('/logs');
  const status = collector.statusSnapshot();
  assert.equal(status.status, 'collecting');
  assert.equal(status.path, '/logs');
  assert.equal(status.analysis, undefined);
});
