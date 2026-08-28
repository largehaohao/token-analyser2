import assert from 'node:assert/strict';
import test from 'node:test';
import { callContentIndex, formatCallAmount, paginate, SESSION_TIME_RANGES, sessionDisplayName, sessionsInTimeRange, tokenComposition } from '../lib/session-view';
import { buildAnalysis, parseJsonl } from '../lib/analysis';

test('session labels use directory basename and explicit title with honest fallbacks', () => {
  assert.equal(sessionDisplayName({ id: 'abc', title: '优化 UI', cwd: '/projects/token-analyser2/' }), 'token-analyser2 - 优化 UI');
  assert.equal(sessionDisplayName({ id: 'abcdefgh-123', title: 'abcdefgh-123', cwd: 'C:\\work\\app' }), 'app - 未命名会话 · abcdefgh');
  assert.equal(sessionDisplayName({ id: 'abc', title: '  ' }), '未知目录 - 未命名会话 · abc');
});

test('relative session dates include exact boundaries and exclude invalid or future timestamps', () => {
  const now = Date.parse('2026-08-28T19:00:00+08:00');
  for (const range of SESSION_TIME_RANGES) {
    if (!range.hours) continue;
    const cutoff = now - range.hours * 3_600_000;
    const sessions = [
      { id: 'now', lastDataAt: new Date(now).toISOString() },
      { id: 'boundary', lastDataAt: new Date(cutoff).toISOString() },
      { id: 'old', lastDataAt: new Date(cutoff - 1).toISOString() },
      { id: 'future', lastDataAt: new Date(now + 1).toISOString() },
      { id: 'missing' }, { id: 'invalid', lastDataAt: 'invalid' },
    ];
    assert.deepEqual(sessionsInTimeRange(sessions, range.value, now).map((session) => session.id), ['now', 'boundary']);
    assert.deepEqual(sessionsInTimeRange(sessions, 'all', now), sessions);
    assert.deepEqual(sessionsInTimeRange(sessions, range.value, now + 60_000).map((session) => session.id), ['now', 'future']);
  }
});

test('one day is a rolling 24-hour window and filtering leaves full session amounts intact', () => {
  const now = Date.parse('2026-08-28T01:00:00+08:00');
  const sessions = [{ lastDataAt: '2026-08-26T17:00:00Z', totalTokens: 999 }, { lastDataAt: '2026-08-26T16:59:59Z', totalTokens: 123 }];
  assert.deepEqual(sessionsInTimeRange(sessions, '1d', now), [sessions[0]]);
  assert.equal(sessions[1].totalTokens, 123);
});

test('call table buckets exclude cached input and reasoning double counting', () => {
  assert.deepEqual(tokenComposition({ inputTokens: 100, cachedInputTokens: 80, inputIncludesCached: true, outputTokens: 20, reasoningTokens: 15, outputIncludesReasoning: true }), { uncached: 20, cached: 80, cacheWrite: 0, output: 20, total: 120 });
  assert.deepEqual(tokenComposition({ inputTokens: 100, cachedInputTokens: 80, cacheCreationInputTokens: 10, outputTokens: 20, reasoningTokens: 5 }), { uncached: 100, cached: 80, cacheWrite: 10, output: 25, total: 215 });
  assert.equal(tokenComposition(undefined), undefined);
  assert.equal(tokenComposition({ inputTokens: 0, outputTokens: 0 })?.total, 0);
});

test('table amounts distinguish unknown and tiny costs from a recorded zero', () => {
  assert.equal(formatCallAmount(undefined, 'usd'), '—');
  assert.equal(formatCallAmount(0, 'usd'), '$0');
  assert.equal(formatCallAmount(0.000013, 'usd'), '$0.000013');
  assert.equal(formatCallAmount(0.0000001, 'usd'), '$<0.000001');
  assert.equal(formatCallAmount(0.1, 'credits'), '0.1');
});

test('pagination visits every row exactly once and clamps empty or shortened lists', () => {
  const rows = Array.from({ length: 198 }, (_, index) => index);
  const pages = Array.from({ length: 14 }, (_, index) => paginate(rows, index + 1, 15));
  assert.deepEqual(pages.flatMap((page) => page.items), rows);
  assert.equal(pages[13].items.length, 3);
  assert.equal(paginate(rows, 999, 15).page, 14);
  assert.deepEqual(paginate([], 8, 15), { items: [], page: 1, pageCount: 1, total: 0, start: 0, end: 0 });
  assert.equal(paginate(rows.slice(0, 16), 14, 15).start, 16);
  assert.equal(paginate(rows, 0, 20).items.length, 20);
});

test('Codex call excerpts include user context, visible replies and operations without changing usage', () => {
  const records = [
    { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '修复分页问题' }] } },
    { type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '我会检查翻页状态。' }] } },
    { type: 'response_item', payload: { type: 'function_call', name: 'exec_command', call_id: 'tool-1', arguments: '{"cmd":"cat app/page.tsx"}' } },
    { type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 100, output_tokens: 10 } } } },
    { type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 120, output_tokens: 12 } } } },
  ];
  const parsed = parseJsonl(records.map((row) => JSON.stringify(row)).join('\n'), { provider: 'codex', sourceFile: 'content.jsonl', sessionId: 's' });
  const result = buildAnalysis(parsed.events);
  const index = callContentIndex(result.events);
  const first = index.get(result.calls[0].id)!;
  assert.equal(first.prompt, '修复分页问题');
  const wrapped = result.events.map((event) => event.kind === 'user' ? { ...event, text: '# Files mentioned by the user:\n\nscreenshot.png\n<in-app-browser-context>browser metadata</in-app-browser-context>\n\n## My request:\n修复分页问题' } : event);
  assert.equal(callContentIndex(wrapped).get(result.calls[0].id)?.prompt, '修复分页问题');
  assert.equal(first.reply, '我会检查翻页状态。');
  assert.match(first.operations[0], /cat app\/page.tsx/);
  assert.deepEqual(index.get(result.calls[1].id), { prompt: '修复分页问题', reply: undefined, operations: [] });
  assert.equal(result.calls.length, 2);
  assert.equal(result.usage.totalTokens, 132);
  assert.deepEqual(result.usage, buildAnalysis(parsed.events.filter((event) => event.kind !== 'assistant')).usage);
  const isolated = result.events.map((event) => event.kind === 'user' || event.kind === 'assistant' ? { ...event, sessionId: 'other' } : event);
  assert.equal(callContentIndex(isolated).get(result.calls[0].id)?.prompt, undefined);
  assert.equal(callContentIndex(isolated).get(result.calls[0].id)?.reply, undefined);
});

test('Claude reply content is extracted from message.content and bounded without including thinking', () => {
  const parsed = parseJsonl(JSON.stringify({
    type: 'assistant', session_id: 'claude', message: {
      id: 'reply', role: 'assistant', model: 'claude-sonnet-4',
      content: [{ type: 'thinking', thinking: 'private reasoning' }, { type: 'text', text: '完成修复。' + '细节'.repeat(1500) }],
      usage: { input_tokens: 10, output_tokens: 20 },
    },
  }), { sourceFile: 'claude.jsonl', provider: 'claude' });
  const result = buildAnalysis(parsed.events);
  const content = callContentIndex(result.events).get('reply')!;
  assert.match(content.reply!, /^完成修复/);
  assert.ok(content.reply!.length < 1300);
  assert.ok(!content.reply!.includes('private reasoning'));
  assert.equal(result.calls.length, 1);
  assert.equal(result.usage.totalTokens, 30);
});
