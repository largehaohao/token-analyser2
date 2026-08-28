import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildAnalysis,
  defaultRateSnapshots,
  parseJsonl,
  type AnalysisEvent,
  type RateSnapshot,
} from '../lib/analysis';
import { readHandleDocuments } from '../lib/collector';

const rate: RateSnapshot = {
  id: 'test-codex',
  provider: 'codex',
  modelPattern: '*',
  inputUsdPerMillion: 1,
  cachedInputUsdPerMillion: 0.1,
  outputUsdPerMillion: 5,
  source: 'test fixture',
  checkedDate: '2026-08-28',
  applicability: 'synthetic only',
  kind: 'custom',
};

const iso = (seconds: number) =>
  new Date(Date.UTC(2026, 7, 28, 12, 0, seconds)).toISOString();

function event(overrides: Partial<AnalysisEvent>): AnalysisEvent {
  return {
    id: overrides.id ?? `event-${Math.random()}`,
    provider: overrides.provider ?? 'codex',
    sourceFile: overrides.sourceFile ?? 'fixture.jsonl',
    sourceLine: overrides.sourceLine ?? 1,
    timestamp: overrides.timestamp ?? iso(0),
    kind: overrides.kind ?? 'model',
    sessionId: overrides.sessionId ?? 'main',
    actorId: overrides.actorId ?? 'main',
    model: overrides.model ?? 'gpt-5.6-sol',
    ...overrides,
  };
}

test('parses Codex usage and read evidence from native JSONL', () => {
  const jsonl = [
    JSON.stringify({
      timestamp: iso(0),
      type: 'session_meta',
      payload: { id: 'codex-main' },
    }),
    JSON.stringify({
      timestamp: iso(1),
      type: 'event_msg',
      payload: {
        type: 'token_count',
        info: {
          total_token_usage: {
            input_tokens: 100,
            cached_input_tokens: 20,
            output_tokens: 10,
          },
        },
      },
    }),
    JSON.stringify({
      timestamp: iso(2),
      type: 'response_item',
      payload: {
        type: 'function_call',
        call_id: 'read-1',
        name: 'read_file',
        arguments: JSON.stringify({ path: 'src/app.ts', start_line: 1, end_line: 3 }),
      },
    }),
    JSON.stringify({
      timestamp: iso(3),
      type: 'response_item',
      payload: {
        type: 'function_call_output',
        call_id: 'read-1',
        output: 'const answer = 42;\n',
      },
    }),
  ].join('\n');

  const parsed = parseJsonl(jsonl, {
    provider: 'codex',
    sourceFile: 'codex.jsonl',
  });

  assert.equal(parsed.errors.length, 0);
  assert.ok(parsed.events.some((item) => item.kind === 'model' && item.usage));
  const read = parsed.events.find((item) => item.kind === 'tool');
  assert.equal(read?.toolName, 'read_file');
  assert.equal(read?.filePath, 'src/app.ts');
  assert.equal(read?.fileRange, '1-3');
  assert.ok(read?.contentHash);
});

test('does not double count Claude assistant usage and result tree summary', () => {
  const jsonl = [
    JSON.stringify({
      type: 'assistant',
      session_id: 'claude-main',
      message: {
        id: 'msg-1',
        model: 'claude-sonnet-4',
        usage: {
          input_tokens: 100,
          cache_read_input_tokens: 50,
          output_tokens: 20,
        },
        content: [
          {
            type: 'tool_use',
            id: 'tool-1',
            name: 'Read',
            input: { file_path: 'src/app.ts', start_line: 1, end_line: 3 },
          },
        ],
      },
    }),
    JSON.stringify({
      type: 'result',
      session_id: 'claude-main',
      usage: { input_tokens: 100, cache_read_input_tokens: 50, output_tokens: 20 },
      modelUsage: {
        'claude-sonnet-4': { inputTokens: 100, cacheReadInputTokens: 50, outputTokens: 20 },
      },
      total_cost_usd: 0.25,
    }),
  ].join('\n');

  const parsed = parseJsonl(jsonl, {
    provider: 'claude',
    sourceFile: 'claude.jsonl',
  });
  assert.equal(parsed.events.filter((item) => item.kind === 'tool').length, 1);
  const analysis = buildAnalysis(parsed.events, [{ ...rate, id: 'test-claude', provider: 'claude' }]);

  assert.equal(analysis.calls.filter((item) => item.usage).length, 1);
  assert.equal(analysis.usage.totalTokens, 170);
  assert.ok(Math.abs((analysis.cost.usd ?? 0) - 0.000205) < 1e-12);
});

test('detects rereads, polling, and compaction loops with evidence', () => {
  const events: AnalysisEvent[] = [];
  for (const [index, seconds] of [0, 60, 120].entries()) {
    events.push(
      event({
        id: `read-call-${index}`,
        timestamp: iso(seconds),
        kind: 'model',
        usage: { inputTokens: 100, outputTokens: 10 },
      }),
      event({
        id: `read-${index}`,
        timestamp: iso(seconds),
        kind: 'tool',
        callId: `read-call-${index}`,
        toolName: 'Read',
        filePath: 'src/app.ts',
        fileRange: '1-3',
        contentHash: 'same-content',
      }),
    );
  }

  for (const [index, seconds] of [180, 210, 240].entries()) {
    events.push(
      event({
        id: `poll-call-${index}`,
        timestamp: iso(seconds),
        kind: 'model',
        usage: { inputTokens: 50, outputTokens: 5 },
      }),
      event({
        id: `poll-${index}`,
        timestamp: iso(seconds),
        kind: 'wait',
        callId: `poll-call-${index}`,
        target: 'child-1',
        stateHash: 'unchanged',
        pureWait: true,
      }),
    );
  }

  for (const [index, seconds] of [300, 360].entries()) {
    events.push(
      event({ id: `compact-${index}`, timestamp: iso(seconds), kind: 'compaction' }),
      event({
        id: `recovery-read-${index}`,
        timestamp: iso(seconds + 1),
        kind: 'tool',
        toolName: 'Read',
        filePath: 'src/app.ts',
        fileRange: '1-3',
        contentHash: 'same-content',
      }),
    );
  }

  const analysis = buildAnalysis(events, [rate]);
  assert.ok(analysis.anomalies.some((item) => item.type === 'reread'));
  assert.ok(analysis.anomalies.some((item) => item.type === 'poll'));
  assert.ok(analysis.anomalies.some((item) => item.type === 'compaction'));
  assert.ok(analysis.anomalies.every((item) => item.evidence.length > 0));
  assert.ok(analysis.anomalies.every((item) => item.recommendation));
});

test('keeps parent and child costs separate while exposing an inclusive total', () => {
  const analysis = buildAnalysis([
    event({
      id: 'parent-call',
      sessionId: 'main',
      actorId: 'main',
      usage: { inputTokens: 100, outputTokens: 10 },
    }),
    event({
      id: 'child-call',
      sessionId: 'child',
      actorId: 'child',
      parentSessionId: 'main',
      usage: { inputTokens: 200, outputTokens: 20 },
    }),
  ], [rate]);

  const main = analysis.sessions.find((item) => item.id === 'main');
  const child = analysis.sessions.find((item) => item.id === 'child');
  assert.equal(main?.ownUsage.totalTokens, 110);
  assert.equal(child?.ownUsage.totalTokens, 220);
  assert.equal(main?.inclusiveUsage.totalTokens, 330);
  assert.equal(analysis.usage.totalTokens, 330);
});

test('candidate cost is deduplicated and a necessary call leaves original usage intact', () => {
  const events = [
    event({
      id: 'candidate',
      timestamp: iso(60),
      usage: { inputTokens: 1_000_000, outputTokens: 0 },
    }),
    event({
      id: 'candidate-read',
      timestamp: iso(60),
      kind: 'tool',
      callId: 'candidate',
      toolName: 'Read',
      filePath: 'src/app.ts',
      fileRange: '1-3',
      contentHash: 'same-content',
    }),
    event({
      id: 'candidate-read-2',
      timestamp: iso(61),
      kind: 'tool',
      callId: 'candidate',
      toolName: 'Read',
      filePath: 'src/app.ts',
      fileRange: '1-3',
      contentHash: 'same-content',
    }),
    event({
      id: 'candidate-read-3',
      timestamp: iso(62),
      kind: 'tool',
      callId: 'candidate',
      toolName: 'Read',
      filePath: 'src/app.ts',
      fileRange: '1-3',
      contentHash: 'same-content',
    }),
  ];
  const analysis = buildAnalysis(events, [rate], { necessaryCallIds: new Set(['candidate']) });

  assert.equal(analysis.usage.totalTokens, 1_000_000);
  assert.equal(analysis.cost.usd, 1);
  assert.equal(analysis.candidateCost.usd, 0);
  assert.equal(analysis.necessaryCallIds.has('candidate'), true);
});

test('converts cumulative snapshots to deltas without inflating a long session', () => {
  const analysis = buildAnalysis([
    event({
      id: 'snapshot-1',
      sourceLine: 1,
      scope: 'tree',
      usage: { inputTokens: 100, outputTokens: 10, cumulative: true },
    }),
    event({
      id: 'snapshot-2',
      sourceLine: 2,
      scope: 'tree',
      usage: { inputTokens: 150, outputTokens: 15, cumulative: true },
    }),
    event({
      id: 'snapshot-3',
      sourceLine: 3,
      scope: 'tree',
      usage: { inputTokens: 200, outputTokens: 20, cumulative: true },
    }),
  ], [rate]);

  assert.equal(analysis.usage.totalTokens, 220);
  assert.equal(analysis.calls.length, 3);
});

test('shows a known cost subtotal when another model has no matching rate', () => {
  const knownRate = { ...rate, modelPattern: 'gpt-5.6-sol' };
  const analysis = buildAnalysis([
    event({ id: 'known', model: 'gpt-5.6-sol', usage: { inputTokens: 1_000_000, outputTokens: 0 } }),
    event({ id: 'unknown', model: 'unpriced-model', usage: { inputTokens: 500_000, outputTokens: 0 } }),
  ], [knownRate]);

  assert.equal(analysis.cost.usd, 1);
  assert.equal(analysis.cost.complete, false);
  assert.equal(analysis.cost.hasKnownAmount, true);
  assert.equal(analysis.cost.unknownCalls, 1);
});

test('recursively includes grandchild usage in the parent session total', () => {
  const analysis = buildAnalysis([
    event({ id: 'root-call', sessionId: 'root', usage: { inputTokens: 10, outputTokens: 1 } }),
    event({ id: 'child-call', sessionId: 'child', parentSessionId: 'root', usage: { inputTokens: 20, outputTokens: 2 } }),
    event({ id: 'grandchild-call', sessionId: 'grandchild', parentSessionId: 'child', usage: { inputTokens: 30, outputTokens: 3 } }),
  ], [rate]);

  assert.equal(analysis.sessions.find((item) => item.id === 'root')?.inclusiveUsage.totalTokens, 66);
  assert.equal(analysis.sessions.find((item) => item.id === 'child')?.inclusiveUsage.totalTokens, 55);
});

test('keeps a child with a missing parent visible as partial coverage', () => {
  const analysis = buildAnalysis([
    event({ id: 'orphan-call', sessionId: 'child-only', parentSessionId: 'missing-parent', usage: { inputTokens: 20, outputTokens: 2 } }),
  ], [rate]);
  const orphan = analysis.sessions.find((item) => item.id === 'child-only');

  assert.ok(orphan);
  assert.equal(orphan?.parentSessionId, 'missing-parent');
  assert.equal(orphan?.completeness, 'partial');
  assert.equal(orphan?.inclusiveUsage.totalTokens, 22);
});

test('does not merge same session ids across providers', () => {
  const analysis = buildAnalysis([
    event({ id: 'codex-same-id', provider: 'codex', sessionId: 'shared-id', usage: { inputTokens: 10, outputTokens: 1 } }),
    event({ id: 'claude-same-id', provider: 'claude', sessionId: 'shared-id', model: 'claude-sonnet-4', usage: { inputTokens: 20, outputTokens: 2 } }),
  ], [rate, { ...rate, id: 'claude-rate', provider: 'claude' }]);

  assert.equal(analysis.sessions.length, 2);
  assert.equal(analysis.sessions.filter((item) => item.id === 'shared-id').length, 2);
});

test('deduplicates the same session exported into multiple source files', () => {
  const jsonl = [
    JSON.stringify({ type: 'session_meta', payload: { id: 'shared-session' } }),
    JSON.stringify({
      type: 'assistant',
      session_id: 'shared-session',
      message: { id: 'message-1', model: 'gpt-5.6-sol', usage: { input_tokens: 100, output_tokens: 10 } },
    }),
  ].join('\n');
  const first = parseJsonl(jsonl, { provider: 'codex', sourceFile: 'part-a.jsonl' });
  const second = parseJsonl(jsonl, { provider: 'codex', sourceFile: 'part-b.jsonl' });
  const analysis = buildAnalysis([...first.events, ...second.events], [rate]);

  assert.equal(analysis.calls.length, 1);
  assert.equal(analysis.usage.totalTokens, 110);
});

test('preserves a source supplied session title without using prompt text as a title', () => {
  const parsed = parseJsonl([
    JSON.stringify({
      type: 'session_meta',
      session_id: 'titled-session',
      title: 'Refactor auth',
    }),
    JSON.stringify({
      type: 'assistant',
      session_id: 'titled-session',
      message: { id: 'titled-call', model: 'gpt-5.6-sol', usage: { input_tokens: 10, output_tokens: 2 } },
    }),
  ].join('\n'), { provider: 'codex', sourceFile: 'titled.jsonl' });

  assert.equal(parsed.events.find((item) => item.kind === 'model')?.sessionTitle, 'Refactor auth');
});

test('infers Claude Code from native cache fields when the filename is generic', () => {
  const parsed = parseJsonl(JSON.stringify({
    type: 'assistant',
    session_id: 'generic-session',
    message: {
      id: 'generic-call',
      model: 'claude-sonnet-4',
      usage: { input_tokens: 10, cache_read_input_tokens: 4, output_tokens: 2 },
    },
  }), { sourceFile: 'session.jsonl' });

  assert.equal(parsed.provider, 'claude');
  assert.equal(parsed.events.find((item) => item.kind === 'model')?.provider, 'claude');
});

test('parses the checked-in Claude fixture with cached and tool evidence', async () => {
  const { readFile } = await import('node:fs/promises');
  const parsed = parseJsonl(await readFile(new URL('./fixtures/claude-session.jsonl', import.meta.url), 'utf8'), {
    sourceFile: 'claude-session.jsonl',
  });

  assert.equal(parsed.provider, 'claude');
  assert.equal(parsed.errors.length, 0);
  assert.equal(parsed.events.filter((item) => item.kind === 'tool').length, 1);
  assert.equal(parsed.events.find((item) => item.kind === 'model')?.usage?.cachedInputTokens, 40);
  const analysis = buildAnalysis(parsed.events, defaultRateSnapshots);
  assert.equal(analysis.calls.length, 1);
  assert.equal(analysis.cost.usd, 0.25);
  assert.equal(analysis.cost.complete, false);
});

test('keeps mixed model calls out of the optimizable cost subtotal', () => {
  const mixedCall = event({
    id: 'mixed-call',
    behavior: 'mixed',
    usage: { inputTokens: 1_000_000, outputTokens: 0 },
  });
  const reads = [0, 1, 2].map((seconds, index) => event({
    id: 'mixed-read-' + String(index),
    sourceLine: index + 2,
    timestamp: iso(seconds),
    kind: 'tool',
    callId: mixedCall.id,
    toolName: 'Read',
    behavior: 'read',
    filePath: 'src/app.ts',
    fileRange: '1-3',
    contentHash: 'same-content',
  }));
  const analysis = buildAnalysis([mixedCall, ...reads], [rate]);

  assert.equal(analysis.anomalies.find((item) => item.type === 'reread')?.mixed, true);
  assert.equal(analysis.candidateCost.usd, 0);
});

test('does not price low-confidence rereads as optimizable cost', () => {
  const events = [
    event({ id: 'unknown-read-call', timestamp: iso(0), usage: { inputTokens: 1_000_000, outputTokens: 0 } }),
    event({ id: 'unknown-read-1', timestamp: iso(0), kind: 'tool', callId: 'unknown-read-call', toolName: 'Read', filePath: 'src/app.ts', fileRange: '1-3' }),
    event({ id: 'unknown-read-2', timestamp: iso(30), kind: 'tool', callId: 'unknown-read-call', toolName: 'Read', filePath: 'src/app.ts', fileRange: '1-3' }),
    event({ id: 'unknown-read-3', timestamp: iso(60), kind: 'tool', callId: 'unknown-read-call', toolName: 'Read', filePath: 'src/app.ts', fileRange: '1-3' }),
  ];
  const analysis = buildAnalysis(events, [rate]);

  assert.equal(analysis.anomalies.find((item) => item.type === 'reread')?.confidence, 'low');
  assert.equal(analysis.candidateCost.usd, 0);
});

test('resets reread counting after a new user request', () => {
  const reads = (prefix: string, seconds: number[]) => seconds.map((value, index) => event({
    id: prefix + String(index),
    timestamp: iso(value),
    kind: 'tool',
    toolName: 'Read',
    filePath: 'src/app.ts',
    fileRange: '1-3',
    contentHash: 'same-content',
  }));
  const analysis = buildAnalysis([
    ...reads('before-', [0, 30]),
    event({ id: 'new-request', timestamp: iso(45), kind: 'user', text: '继续检查' }),
    ...reads('after-', [60, 90]),
  ], [rate]);

  assert.equal(analysis.anomalies.some((item) => item.type === 'reread'), false);
});

test('fills a custom USD snapshot with the matching official credits fields', () => {
  const customUsd = { ...rate, id: 'custom-usd', modelPattern: '*' };
  const analysis = buildAnalysis([
    event({ model: 'gpt-5.6-sol', usage: { inputTokens: 1_000_000, outputTokens: 0 } }),
  ], [customUsd, defaultRateSnapshots[0]]);

  assert.equal(analysis.cost.usd, 1);
  assert.equal(analysis.cost.credits, 100);
  assert.equal(analysis.cost.complete, true);
});

test('keeps a source reported result cost as an estimate when token detail is absent', () => {
  const analysis = buildAnalysis([
    event({
      id: 'reported-summary',
      usage: undefined,
      reportedCostUsd: 0.25,
      scope: 'summary',
    }),
  ], [rate]);

  assert.equal(analysis.cost.usd, 0.25);
  assert.equal(analysis.cost.hasKnownAmount, true);
  assert.equal(analysis.cost.complete, false);
  assert.match(analysis.cost.basis, /total_cost_usd/);
});

test('isolates malformed lines with their source location', () => {
  const parsed = parseJsonl('{"type":"user","text":"ok"}\nnot-json', {
    provider: 'codex',
    sourceFile: 'broken.jsonl',
  });

  assert.equal(parsed.events.length, 1);
  assert.equal(parsed.errors[0]?.sourceFile, 'broken.jsonl');
  assert.equal(parsed.errors[0]?.line, 2);
});

test('isolates a file read failure while retaining other directory documents', async () => {
  const goodFile = {
    name: 'good.jsonl',
    lastModified: 1,
    text: async () => '{"type":"assistant"}',
  } as unknown as File;
  const documents = await readHandleDocuments([
    { handle: { name: 'good.jsonl', getFile: async () => goodFile }, relativePath: 'good.jsonl' },
    { handle: { name: 'locked.jsonl', getFile: async () => { throw new Error('permission denied'); } }, relativePath: 'locked.jsonl' },
  ]);

  assert.equal(documents.length, 2);
  assert.equal(documents.find((item) => item.name === 'good.jsonl')?.content, '{"type":"assistant"}');
  assert.match(documents.find((item) => item.name === 'locked.jsonl')?.error ?? '', /permission denied/);
});
