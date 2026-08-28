import assert from 'node:assert/strict';
import test from 'node:test';
import {
  aggregateTokenComposition,
  behaviorShares,
  callContentIndex,
  candidateShare,
  costCaption,
  displayCost,
  formatCallAmount,
  formatGrowthRate,
  formatSharePercent,
  paginate,
  SESSION_TIME_RANGES,
  sessionDisplayName,
  sessionEntryCounts,
  sessionGrowthRate,
  sessionIsActive,
  sessionRoleLabel,
  sessionRoots,
  sessionsUnderRoots,
  sessionTreeRows,
  sessionsInTimeRange,
  sharePercents,
  shouldHandleEscape,
  tokenComposition,
  trendChartMode,
} from '../lib/session-view';
import { buildAnalysis, formatExactTokenCount, formatTokenCount, parseJsonl, usageTokenCount, type AnalysisEvent, type CostSummary } from '../lib/analysis';

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

test('share percents use largest remainder so mutually exclusive slices sum to 100', () => {
  assert.deepEqual(sharePercents([1, 1, 1]), [34, 33, 33]);
  assert.equal(sharePercents([1, 1, 1]).reduce((sum, value) => sum + value, 0), 100);
  assert.deepEqual(sharePercents([0, 0, 0]), [0, 0, 0]);
  assert.deepEqual(sharePercents([10, 0]), [100, 0]);
});

test('share percents leave uncovered remainder when the given total is larger than the parts', () => {
  assert.deepEqual(sharePercents([10, 10], 100), [10, 10]);
  assert.equal(sharePercents([10, 10], 100).reduce((sum, value) => sum + value, 0), 20);
  assert.deepEqual(sharePercents([1, 1], 3), [34, 33]);
  assert.equal(formatSharePercent(0, 12), '<1%');
  assert.equal(formatSharePercent(0, 0), '0%');
  assert.equal(formatSharePercent(12, 40), '12%');
});

test('behavior shares keep mixed and unknown out of the other bucket', () => {
  const shares = behaviorShares([
    { behavior: 'code', usage: { inputTokens: 60, outputTokens: 0 } },
    { behavior: 'mixed', usage: { inputTokens: 30, outputTokens: 0 } },
    { behavior: 'unknown', usage: { inputTokens: 10, outputTokens: 0 } },
  ] as AnalysisEvent[]);
  assert.equal(shares.find((item) => item.key === 'code')?.tokens, 60);
  assert.equal(shares.find((item) => item.key === 'mixed')?.tokens, 30);
  assert.equal(shares.find((item) => item.key === 'unknown')?.tokens, 10);
  assert.equal(shares.find((item) => item.key === 'other')?.tokens, 0);
  assert.equal(shares.reduce((sum, item) => sum + item.percent, 0), 100);
});

test('token composition aggregates calls without treating cached input as extra uncached tokens', () => {
  const composition = aggregateTokenComposition([
    { usage: { inputTokens: 100, cachedInputTokens: 80, inputIncludesCached: true, outputTokens: 20, reasoningTokens: 5, outputIncludesReasoning: true } },
    { usage: { inputTokens: 50, cachedInputTokens: 10, cacheCreationInputTokens: 5, outputTokens: 8 } },
  ] as AnalysisEvent[]);
  assert.equal(composition.uncached, 70);
  assert.equal(composition.cached, 90);
  assert.equal(composition.cacheWrite, 5);
  assert.equal(composition.output, 28);
  assert.equal(composition.total, 193);
  assert.equal(composition.parts.reduce((sum, part) => sum + part.percent, 0), 100);
});

test('session growth uses a recent window instead of the last two noisy calls', () => {
  const iso = (minutes: number) => new Date(Date.UTC(2026, 7, 28, 12, minutes)).toISOString();
  const session = {
    lastDataAt: iso(20),
    ownCalls: [
      { timestamp: iso(0), usage: { inputTokens: 1_000_000, outputTokens: 0 } },
      { timestamp: iso(1), usage: { inputTokens: 1, outputTokens: 0 } },
      { timestamp: iso(20), usage: { inputTokens: 15_000, outputTokens: 0 } },
    ] as AnalysisEvent[],
  };
  const rate = sessionGrowthRate(session);
  assert.ok(rate !== undefined);
  assert.ok(Math.abs((rate ?? 0) - 1000) < 1e-6);
  assert.equal(formatGrowthRate(undefined), '—');
  assert.equal(formatGrowthRate(0.4), '<1 / 分钟');
});

test('ended sessions keep the historical rate but are not presented as current burn', () => {
  const endedAt = '2026-08-25T12:00:00.000Z';
  const now = Date.parse('2026-08-28T12:00:00.000Z');
  const session = {
    lastDataAt: endedAt,
    ownCalls: [
      { timestamp: '2026-08-25T11:50:00.000Z', usage: { inputTokens: 15_000, outputTokens: 0 } },
      { timestamp: endedAt, usage: { inputTokens: 15_000, outputTokens: 0 } },
    ] as AnalysisEvent[],
  };
  assert.equal(sessionIsActive(session, now), false);
  assert.equal(sessionIsActive({ lastDataAt: '2026-08-28T11:50:00.000Z' }, now), true);
  const rate = sessionGrowthRate(session);
  assert.ok(rate !== undefined);
  assert.match(formatGrowthRate(rate, { active: false }), /^当时 /);
  assert.equal(formatGrowthRate(rate, { active: true }).startsWith('当时'), false);
});

test('displayCost does not present a missing rate as a billed zero', () => {
  const empty: CostSummary = {
    usd: 0,
    credits: 0,
    complete: true,
    usdComplete: true,
    creditsComplete: true,
    hasKnownAmount: false,
    basis: '没有可计价调用',
    knownCalls: 0,
    unknownCalls: 0,
    breakdown: { inputTokens: 0, cachedInputTokens: 0, cacheCreationInputTokens: 0, outputTokens: 0 },
  };
  const missing: CostSummary = {
    complete: false,
    usdComplete: false,
    creditsComplete: false,
    hasKnownAmount: false,
    basis: '暂无适用费率',
    knownCalls: 0,
    unknownCalls: 2,
    breakdown: { inputTokens: 10, cachedInputTokens: 0, cacheCreationInputTokens: 0, outputTokens: 1 },
  };
  const partial: CostSummary = {
    usd: 1.23,
    complete: false,
    usdComplete: false,
    creditsComplete: false,
    hasKnownAmount: true,
    basis: '已知小计',
    knownCalls: 1,
    unknownCalls: 1,
    breakdown: { inputTokens: 10, cachedInputTokens: 0, cacheCreationInputTokens: 0, outputTokens: 1 },
  };
  assert.equal(displayCost(empty, 'usd').value, '$0.00');
  assert.equal(displayCost(empty, 'usd').note, '没有可计价调用');
  assert.equal(displayCost(missing, 'usd').value, '未知');
  assert.equal(displayCost(missing, 'usd').tone, 'unknown');
  assert.equal(displayCost(partial, 'usd').tone, 'partial');
  assert.equal(displayCost(partial, 'usd').note, 'USD 已知小计');
  assert.equal(displayCost({ ...partial, usdComplete: true, unknownCalls: 0 }, 'usd').tone, 'known');
  assert.equal(displayCost({ ...partial, usdComplete: true, unknownCalls: 0 }, 'usd').note, 'USD 估算');
});

test('candidate share never fills an unknown cost with zero to invent a percentage', () => {
  const known: CostSummary = {
    usd: 10,
    complete: true,
    usdComplete: true,
    creditsComplete: true,
    hasKnownAmount: true,
    basis: 'test',
    knownCalls: 2,
    unknownCalls: 0,
    breakdown: { inputTokens: 0, cachedInputTokens: 0, cacheCreationInputTokens: 0, outputTokens: 0 },
  };
  const unknown: CostSummary = {
    complete: false,
    usdComplete: false,
    creditsComplete: false,
    hasKnownAmount: false,
    basis: '暂无适用费率',
    knownCalls: 0,
    unknownCalls: 1,
    breakdown: { inputTokens: 0, cachedInputTokens: 0, cacheCreationInputTokens: 0, outputTokens: 0 },
  };
  assert.equal(candidateShare(known, { ...known, usd: 2.4 }, 'usd').percent, 24);
  assert.equal(candidateShare(known, unknown, 'usd').percent, undefined);
  assert.match(candidateShare(known, unknown, 'usd').note, /无法计算占比/);
  const creditsOnly: CostSummary = {
    credits: 50,
    complete: false,
    usdComplete: false,
    creditsComplete: true,
    hasKnownAmount: true,
    basis: 'credits',
    knownCalls: 2,
    unknownCalls: 0,
    breakdown: { inputTokens: 0, cachedInputTokens: 0, cacheCreationInputTokens: 0, outputTokens: 0 },
  };
  const creditsShare = candidateShare(creditsOnly, { ...creditsOnly, credits: 10 }, 'usd');
  assert.equal(creditsShare.percent, 20);
  assert.match(creditsShare.note, /credits/);
});

test('session tree expands children under the matching provider parent', () => {
  const parent = { id: 'main', provider: 'codex' as const, parentSessionId: undefined };
  const child = { id: 'child', provider: 'codex' as const, parentSessionId: 'main' };
  const other = { id: 'main', provider: 'claude' as const, parentSessionId: undefined };
  const expanded = sessionTreeRows([parent, child, other], new Set());
  assert.deepEqual(expanded.map((row) => [row.session.provider, row.session.id, row.depth, row.childCount]), [
    ['codex', 'main', 0, 1],
    ['codex', 'child', 1, 0],
    ['claude', 'main', 0, 0],
  ]);
  const collapsed = sessionTreeRows([parent, child], new Set(['codex\0main']));
  assert.equal(collapsed.length, 1);
  assert.deepEqual(sessionRoots([parent, child, other]).map((session) => session.provider + ':' + session.id), ['codex:main', 'claude:main']);
  const grandchild = { id: 'grandchild', provider: 'codex' as const, parentSessionId: 'child' };
  assert.deepEqual(
    sessionsUnderRoots([parent, child, grandchild, other], [parent]).map((session) => session.id),
    ['main', 'child', 'grandchild'],
  );
});

test('session tree keeps cyclic and self-parent sessions visible as entries', () => {
  const left = { id: 'a', provider: 'codex' as const, parentSessionId: 'b' };
  const right = { id: 'b', provider: 'codex' as const, parentSessionId: 'a' };
  const self = { id: 'loop', provider: 'claude' as const, parentSessionId: 'loop' };
  const cycleRows = sessionTreeRows([left, right], new Set());
  assert.equal(cycleRows.length, 2);
  assert.equal(cycleRows.filter((row) => row.depth === 0).length, 1);
  assert.equal(sessionTreeRows([self], new Set()).length, 1);
  assert.equal(sessionRoleLabel(left, 0), '子会话（父会话不在当前范围）');
  assert.equal(sessionRoleLabel(left, 0, { parentPresent: true }), '子会话（循环归属）');
  assert.equal(sessionRoleLabel(left, 1), '子会话');
  assert.equal(sessionRoleLabel({ parentSessionId: undefined }, 0), '主会话');
  const mixed = [
    { id: 'root', provider: 'codex' as const, parentSessionId: undefined },
    { id: 'child', provider: 'codex' as const, parentSessionId: 'root' },
    { id: 'orphan', provider: 'codex' as const, parentSessionId: 'missing' },
  ];
  const counts = sessionEntryCounts(mixed);
  assert.equal(counts.total, 3);
  assert.equal(counts.primary, 1);
  assert.equal(counts.detached, 1);
  assert.equal(counts.children, 2);
  assert.equal(counts.entries, 2);
});

test('token count formatting distinguishes unknown, zero, and sub-one values', () => {
  assert.equal(formatTokenCount(0), '0');
  assert.equal(formatTokenCount(0.4), '<1');
  assert.equal(formatTokenCount(Number.NaN), '未知');
  assert.equal(formatExactTokenCount(12345).replace(/\D/g, ''), '12345');
});

test('token composition total matches usageTokenCount when cached input exceeds the input snapshot', () => {
  const usage = { inputTokens: 0, cachedInputTokens: 30, outputTokens: 4, inputIncludesCached: true };
  const composition = tokenComposition(usage)!;
  assert.equal(composition.uncached, 0);
  assert.equal(composition.cached, 30);
  assert.equal(composition.total, usageTokenCount(usage));
  assert.equal(aggregateTokenComposition([{ usage } as AnalysisEvent]).total, usageTokenCount(usage));
});

test('cost captions do not repeat the completeness note', () => {
  const partial: CostSummary = {
    usd: 1.23,
    complete: false,
    usdComplete: false,
    creditsComplete: false,
    hasKnownAmount: true,
    basis: '已知小计',
    knownCalls: 1,
    unknownCalls: 1,
    breakdown: { inputTokens: 10, cachedInputTokens: 0, cacheCreationInputTokens: 0, outputTokens: 1 },
  };
  const caption = costCaption(partial, 'usd');
  assert.equal(caption.includes('已知小计') && caption.includes('可追溯'), false);
  assert.match(caption, /已知小计/);
  assert.equal((caption.match(/已知小计/g) ?? []).length, 1);
});

test('escape closing ignores typing targets and trend unknown-only ranges stay empty', () => {
  assert.equal(shouldHandleEscape(null), true);
  const input = { closest: (selector: string) => (selector.includes('input') ? {} : null) };
  assert.equal(shouldHandleEscape(input), false);
  assert.equal(trendChartMode([]), 'empty');
  assert.equal(trendChartMode([{ known: false }, { known: false }]), 'unknown-only');
  assert.equal(trendChartMode([{ known: true }, { known: false }]), 'chart');
});

