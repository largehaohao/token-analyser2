import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildAnalysis,
  costForCalls,
  scopeAnalysis,
  defaultRateSnapshots,
  formatRelativeTime,
  parseJsonl,
  usageTokenCount,
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

test('parses Codex desktop cumulative snapshots as distinct model calls with metadata', () => {
  const jsonl = [
    JSON.stringify({
      timestamp: iso(0),
      type: 'session_meta',
      payload: {
        session_id: 'desktop-main',
        id: 'desktop-main',
        base_instructions: { provenance: { type: 'model', model: 'gpt-5.6-sol' } },
      },
    }),
    JSON.stringify({
      timestamp: iso(1),
      type: 'turn_context',
      payload: { model: 'gpt-5.6-sol' },
    }),
    JSON.stringify({
      timestamp: iso(2),
      type: 'event_msg',
      payload: {
        type: 'token_count',
        info: {
          total_token_usage: { input_tokens: 80, cached_input_tokens: 60, output_tokens: 5, reasoning_output_tokens: 2 },
          last_token_usage: { input_tokens: 80, cached_input_tokens: 60, output_tokens: 5, reasoning_output_tokens: 2 },
        },
      },
    }),
    JSON.stringify({
      timestamp: iso(3),
      type: 'event_msg',
      payload: {
        type: 'token_count',
        info: {
          total_token_usage: { input_tokens: 160, cached_input_tokens: 120, output_tokens: 11, reasoning_output_tokens: 4 },
          last_token_usage: { input_tokens: 80, cached_input_tokens: 60, output_tokens: 6, reasoning_output_tokens: 2 },
        },
      },
    }),
  ].join('\n');

  const parsed = parseJsonl(jsonl, { provider: 'codex', sourceFile: 'desktop.jsonl' });
  const snapshots = parsed.events.filter((item) => item.kind === 'model' && item.usage);
  assert.equal(snapshots.length, 2);
  assert.equal(snapshots[0]?.model, 'gpt-5.6-sol');
  assert.equal(snapshots[1]?.model, 'gpt-5.6-sol');
  assert.equal(snapshots[0]?.sourceLine, 3);
  assert.equal(snapshots[1]?.sourceLine, 4);

  const analysis = buildAnalysis(parsed.events, defaultRateSnapshots);
  assert.equal(analysis.calls.length, 2);
  assert.equal(analysis.usage.totalTokens, 171);
  assert.equal(analysis.sessions[0]?.id, 'desktop-main');
});

test('recognizes Codex desktop shell reads and object-shaped tool output', () => {
  const jsonl = [
    JSON.stringify({
      timestamp: iso(0),
      type: 'response_item',
      payload: {
        type: 'custom_tool_call',
        call_id: 'exec-read-1',
        name: 'exec',
        input: 'sed -n \'1,20p\' /workspace/src/app.ts',
      },
    }),
    JSON.stringify({
      timestamp: iso(1),
      type: 'response_item',
      payload: {
        type: 'custom_tool_call_output',
        call_id: 'exec-read-1',
        output: [{ type: 'text', text: 'const answer = 42;\n' }],
      },
    }),
    JSON.stringify({
      timestamp: iso(2),
      type: 'event_msg',
      payload: {
        type: 'token_count',
        info: { total_token_usage: { input_tokens: 100, output_tokens: 10 } },
      },
    }),
  ].join('\n');

  const parsed = parseJsonl(jsonl, { provider: 'codex', sourceFile: 'desktop.jsonl' });
  const read = parsed.events.find((item) => item.kind === 'tool');
  assert.equal(parsed.errors.length, 0);
  assert.equal(read?.behavior, 'read');
  assert.equal(read?.filePath, '/workspace/src/app.ts');
  assert.ok(read?.contentHash);
  assert.equal(read?.complete, true);

  // The live collector strips raw tool payloads before sending them to the
  // browser. Behaviour metadata on the tool event must still be sufficient to
  // attribute the nearby model snapshot as a read.
  const compacted = parsed.events.map((item) => {
    const copy = { ...item };
    delete copy.toolInput;
    delete copy.toolOutput;
    return copy;
  });
  const compactedAnalysis = buildAnalysis(compacted, defaultRateSnapshots, { mode: 'live' });
  assert.equal(compactedAnalysis.calls[0]?.behavior, 'read');
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
  assert.ok(analysis.anomalies.every((item) => item.provider === 'codex'));
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

test('treats a reset cumulative snapshot as a new baseline instead of losing usage', () => {
  const analysis = buildAnalysis([
    event({ id: 'before-reset', sourceLine: 1, scope: 'tree', usage: { inputTokens: 100, outputTokens: 10, cumulative: true } }),
    event({ id: 'after-reset', sourceLine: 2, scope: 'tree', usage: { inputTokens: 20, outputTokens: 2, cumulative: true } }),
  ], [rate]);

  assert.equal(analysis.usage.totalTokens, 132);
  assert.equal(analysis.calls.length, 2);
});

test('excludes Codex subagent replay before an explicit child-turn boundary', () => {
  const parsed = parseJsonl([
    JSON.stringify({ type: 'session_meta', payload: { id: 'child', parent_session_id: 'parent' } }),
    JSON.stringify({ timestamp: iso(0), type: 'event_msg', payload: { type: 'token_count', info: { last_token_usage: { input_tokens: 100, output_tokens: 10 }, total_token_usage: { input_tokens: 100, output_tokens: 10 } } } }),
    JSON.stringify({ timestamp: iso(1), type: 'event_msg', payload: { type: 'task_started' } }),
    JSON.stringify({ timestamp: iso(2), type: 'event_msg', payload: { type: 'token_count', info: { last_token_usage: { input_tokens: 20, output_tokens: 2 }, total_token_usage: { input_tokens: 120, output_tokens: 12 } } } }),
  ].join('\n'), { provider: 'codex', sourceFile: 'child.jsonl' });
  const analysis = buildAnalysis(parsed.events, [rate]);

  assert.equal(parsed.events.filter((item) => item.replayed).length, 1);
  assert.equal(analysis.calls.length, 1);
  assert.equal(analysis.usage.totalTokens, 22);
});

test('prices Claude cache creation duration buckets independently from cache reads', () => {
  const claudeRate: RateSnapshot = {
    ...rate,
    id: 'claude-cache-rate',
    provider: 'claude',
    inputUsdPerMillion: 1,
    cachedInputUsdPerMillion: 0.1,
    cacheCreationUsdPerMillion: 1.25,
    cacheCreation1hUsdPerMillion: 2,
  };
  const parsed = parseJsonl(JSON.stringify({
    type: 'assistant', session_id: 'claude-cache', timestamp: iso(0),
    message: { id: 'cache-call', model: 'claude-sonnet-4', usage: {
      input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 100_000,
      cache_creation_input_tokens: 300_000,
      cache_creation: { ephemeral_5m_input_tokens: 100_000, ephemeral_1h_input_tokens: 200_000 },
    } },
  }), { provider: 'claude', sourceFile: 'cache.jsonl' });
  const analysis = buildAnalysis(parsed.events, [claudeRate]);

  assert.ok(Math.abs((analysis.cost.usd ?? 0) - 0.535) < 1e-12);
  assert.equal(analysis.cost.usdComplete, true);
});

test('does not apply standard Codex credit rates to a recorded Fast call', () => {
  const parsed = parseJsonl([
    JSON.stringify({ type: 'session_meta', payload: { id: 'fast-session' } }),
    JSON.stringify({ timestamp: iso(0), type: 'event_msg', payload: { type: 'thread_settings_applied', thread_settings: { service_tier: 'priority' } } }),
    JSON.stringify({ timestamp: iso(1), type: 'turn_context', payload: { model: 'gpt-5.6-sol' } }),
    JSON.stringify({ timestamp: iso(2), type: 'event_msg', payload: { type: 'token_count', info: { last_token_usage: { input_tokens: 100, output_tokens: 10 }, total_token_usage: { input_tokens: 100, output_tokens: 10 } } } }),
  ].join('\n'), { provider: 'codex', sourceFile: 'fast.jsonl' });
  const analysis = buildAnalysis(parsed.events, defaultRateSnapshots);

  assert.equal(analysis.calls[0]?.serviceTier, 'fast');
  assert.equal(analysis.cost.credits, undefined);
  assert.equal(analysis.cost.unknownCalls, 1);
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

test('keeps model calls that share an event id across providers', () => {
  const analysis = buildAnalysis([
    event({ id: 'call-1', provider: 'codex', sessionId: 'codex-s', usage: { inputTokens: 10, outputTokens: 1 } }),
    event({
      id: 'call-1',
      provider: 'claude',
      sessionId: 'claude-s',
      model: 'claude-sonnet-4',
      usage: { inputTokens: 20, outputTokens: 2 },
    }),
  ], [rate, { ...rate, id: 'claude-rate', provider: 'claude' }]);

  assert.equal(analysis.calls.length, 2);
  assert.equal(analysis.usage.totalTokens, 33);
  assert.equal(analysis.sessions.length, 2);
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
      cwd: '/projects/auth-app',
    }),
    JSON.stringify({
      type: 'assistant',
      session_id: 'titled-session',
      message: { id: 'titled-call', model: 'gpt-5.6-sol', usage: { input_tokens: 10, output_tokens: 2 } },
    }),
  ].join('\n'), { provider: 'codex', sourceFile: 'titled.jsonl' });

  assert.equal(parsed.events.find((item) => item.kind === 'model')?.sessionTitle, 'Refactor auth');
  const session = buildAnalysis(parsed.events, [rate]).sessions[0];
  assert.equal(session.cwd, '/projects/auth-app');
  assert.equal(session.title, 'Refactor auth');
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
  assert.ok((analysis.cost.usd ?? 0) > 0);
  assert.equal(analysis.cost.unknownCalls, 0);
  assert.match(analysis.cost.basis, /Anthropic/);
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
  assert.match(analysis.cost.basis, /test fixture/);
});

test('custom wildcard rates override official USD and keep the custom basis', () => {
  const customStar: RateSnapshot = {
    id: 'custom-star',
    provider: 'codex',
    modelPattern: '*',
    inputUsdPerMillion: 999,
    outputUsdPerMillion: 999,
    source: 'user custom wildcard',
    checkedDate: '2026-08-29',
    applicability: 'override attempt',
    kind: 'custom',
  };
  const call = event({
    id: 'priced',
    model: 'gpt-5.6-sol',
    usage: { inputTokens: 1_000_000, outputTokens: 0 },
  });
  const analysis = buildAnalysis([call], [customStar, ...defaultRateSnapshots]);

  assert.equal(analysis.cost.usd, 999);
  assert.match(analysis.cost.basis, /user custom wildcard/);
  assert.doesNotMatch(analysis.cost.basis, /Help Center/);
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
  const parsed = parseJsonl('{"type":"user","text":"ok"}\nnot-json\n', {
    provider: 'codex',
    sourceFile: 'broken.jsonl',
  });

  assert.equal(parsed.events.length, 1);
  assert.equal(parsed.errors[0]?.sourceFile, 'broken.jsonl');
  assert.equal(parsed.errors[0]?.line, 2);
});

test('waits for an incomplete trailing line instead of recording a parse error', () => {
  const parsed = parseJsonl('{"type":"user","text":"ok"}\n{"type":"assistant","session_id":"s"', {
    provider: 'codex',
    sourceFile: 'growing.jsonl',
  });

  assert.equal(parsed.errors.length, 0);
  assert.equal(parsed.events.some((item) => item.kind === 'user'), true);
});

test('attributes reread candidate cost to model calls parsed from native Claude JSONL', () => {
  const jsonl = [0, 1, 2].map((index) =>
    JSON.stringify({
      type: 'assistant',
      session_id: 'reread-session',
      timestamp: iso(index * 30),
      message: {
        id: 'msg-' + String(index),
        model: 'claude-sonnet-4',
        usage: { input_tokens: 1_000_000, output_tokens: 0 },
        content: [
          {
            type: 'tool_use',
            id: 'read-' + String(index),
            name: 'Read',
            input: { file_path: 'src/app.ts', start_line: 1, end_line: 3 },
          },
        ],
      },
    }),
  ).join('\n');
  const outputs = [0, 1, 2].map((index) =>
    JSON.stringify({
      type: 'user',
      session_id: 'reread-session',
      timestamp: iso(index * 30 + 1),
      message: {
        content: [{ type: 'tool_result', tool_use_id: 'read-' + String(index), content: 'same-file-body' }],
      },
    }),
  ).join('\n');
  const parsed = parseJsonl([jsonl, outputs].join('\n'), {
    provider: 'claude',
    sourceFile: 'reread.jsonl',
  });
  const analysis = buildAnalysis(parsed.events, [{ ...rate, id: 'claude-rate', provider: 'claude' }]);
  const reread = analysis.anomalies.find((item) => item.type === 'reread');

  assert.equal(parsed.events.filter((item) => item.kind === 'model' && item.usage).length, 3);
  assert.ok(reread);
  assert.equal(reread?.candidateCallIds.length, 2);
  assert.equal(analysis.candidateCost.usd, 2);
  assert.ok(reread?.candidateCallIds.every((id) => analysis.calls.some((call) => call.id === id)));
});

test('does not treat a Claude Task tool as a wait', () => {
  const parsed = parseJsonl(JSON.stringify({
    type: 'assistant',
    session_id: 'task-session',
    message: {
      id: 'msg-task',
      model: 'claude-sonnet-4',
      usage: { input_tokens: 10, output_tokens: 2 },
      content: [{ type: 'tool_use', id: 'task-1', name: 'Task', input: { prompt: 'review' } }],
    },
  }), { provider: 'claude', sourceFile: 'task.jsonl' });
  const tool = parsed.events.find((item) => item.kind === 'tool' || item.kind === 'wait');

  assert.equal(tool?.kind, 'tool');
  assert.equal(tool?.behavior, 'subagent');
  assert.notEqual(tool?.pureWait, true);
});

test('leaves model calls without tools as unknown behavior instead of planning', () => {
  const parsed = parseJsonl(JSON.stringify({
    type: 'assistant',
    session_id: 'plain',
    message: { id: 'msg-plain', model: 'claude-sonnet-4', usage: { input_tokens: 10, output_tokens: 2 } },
  }), { provider: 'claude', sourceFile: 'plain.jsonl' });

  assert.equal(parsed.events.find((item) => item.kind === 'model')?.behavior, 'unknown');
});

test('does not mark a wait tool as pure wait when its result is missing', () => {
  const parsed = parseJsonl(JSON.stringify({
    timestamp: iso(0),
    type: 'response_item',
    payload: { type: 'function_call', call_id: 'wait-1', name: 'wait_for_agent', arguments: '{"target":"child"}' },
  }), { provider: 'codex', sourceFile: 'wait.jsonl' });
  const wait = parsed.events.find((item) => item.toolName === 'wait_for_agent');

  assert.equal(wait?.pureWait, false);
  assert.equal(wait?.complete, false);
  assert.equal(buildAnalysis(parsed.events, [rate]).completeness, 'partial');
});

test('records parentUuid from session metadata onto the child analysis unit', () => {
  const parsed = parseJsonl([
    JSON.stringify({ type: 'system', subtype: 'init', sessionId: 'child-1', parentUuid: 'parent-1' }),
    JSON.stringify({
      type: 'assistant',
      session_id: 'child-1',
      message: { id: 'child-msg', model: 'claude-sonnet-4', usage: { input_tokens: 10, output_tokens: 2 } },
    }),
    JSON.stringify({
      type: 'assistant',
      session_id: 'parent-1',
      message: { id: 'parent-msg', model: 'claude-sonnet-4', usage: { input_tokens: 20, output_tokens: 2 } },
    }),
  ].join('\n'), { provider: 'claude', sourceFile: 'tree.jsonl' });
  const analysis = buildAnalysis(parsed.events, [{ ...rate, id: 'claude-rate', provider: 'claude' }]);
  const child = analysis.sessions.find((item) => item.id === 'child-1');

  assert.equal(child?.parentSessionId, 'parent-1');
  assert.equal(analysis.sessions.find((item) => item.id === 'parent-1')?.childSessionIds.includes('child-1'), true);
});

test('matches a dated Claude model name to the official snapshot', () => {
  const analysis = buildAnalysis([
    event({
      provider: 'claude',
      model: 'claude-sonnet-4-20250514',
      usage: { inputTokens: 1_000_000, outputTokens: 0 },
    }),
  ], defaultRateSnapshots);

  assert.equal(analysis.cost.hasKnownAmount, true);
  assert.ok((analysis.cost.usd ?? 0) > 0);
  assert.equal(analysis.cost.unknownCalls, 0);
});

test('does not flag compaction recovery of a file that was never read before the compact', () => {
  const events = [0, 1].flatMap((index) => [
    event({ id: 'compact-' + String(index), timestamp: iso(index * 60), kind: 'compaction' }),
    event({
      id: 'new-read-' + String(index),
      timestamp: iso(index * 60 + 1),
      kind: 'tool',
      toolName: 'Read',
      filePath: 'src/new.ts',
      fileRange: '1-3',
      contentHash: 'brand-new',
    }),
  ]);
  const analysis = buildAnalysis(events, [rate]);

  assert.equal(analysis.anomalies.some((item) => item.type === 'compaction'), false);
});

test('formats relative times older than a day in days', () => {
  const stamp = new Date(Date.now() - 50 * 60 * 60 * 1000).toISOString();
  assert.match(formatRelativeTime(stamp), /天前/);
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

test('skips rereading a directory file when lastModified is unchanged', async () => {
  let reads = 0;
  const goodFile = {
    name: 'cached.jsonl',
    lastModified: 42,
    text: async () => {
      reads += 1;
      return '{"type":"assistant"}';
    },
  } as unknown as File;
  const handle = { name: 'cached.jsonl', getFile: async () => goodFile };
  const first = await readHandleDocuments([{ handle, relativePath: 'cached.jsonl' }]);
  const second = await readHandleDocuments([{ handle, relativePath: 'cached.jsonl' }], first);

  assert.equal(first[0]?.content, '{"type":"assistant"}');
  assert.equal(second[0]?.content, '{"type":"assistant"}');
  assert.equal(reads, 1);
});

test('overview scopes normalized deltas and keeps all-time analysis unchanged', () => {
  const full = buildAnalysis([100, 150, 200].map((inputTokens, index) => event({
    id: `window-snapshot-${index}`, sourceLine: index + 1, timestamp: iso(index * 60),
    scope: 'tree', usage: { inputTokens, outputTokens: 0, cumulative: true },
  })), [rate]);
  const scoped = scopeAnalysis(full, { since: Date.parse(iso(60)), until: Date.parse(iso(120)) });
  assert.equal(scoped.usage.totalTokens, 100);
  assert.equal(scoped.calls.length, 2);
  assert.equal(scoped.cost.usd, 0.0001);
  assert.equal(scoped.sessions[0].ownUsage.totalTokens, 100);
  assert.equal(full.usage.totalTokens, 200);
  assert.equal(scopeAnalysis(full), full);
});

test('overview includes exact time boundaries but excludes invalid, future and other providers', () => {
  const full = buildAnalysis([
    event({ id: 'before', timestamp: iso(-1) }),
    event({ id: 'start', timestamp: iso(0) }),
    event({ id: 'end', timestamp: iso(60) }),
    event({ id: 'future', timestamp: iso(61) }),
    event({ id: 'invalid', timestamp: 'not-a-date' }),
    event({ id: 'other', timestamp: iso(30), provider: 'claude' }),
  ].map((call) => ({ ...call, usage: { inputTokens: 100, outputTokens: 0 } })), [rate]);
  const scoped = scopeAnalysis(full, { since: Date.parse(iso(0)), until: Date.parse(iso(60)), provider: 'codex' });
  assert.deepEqual(scoped.calls.map((call) => call.id), ['start', 'end']);
  assert.equal(scoped.lastDataAt, iso(60));
  assert.equal(scoped.usage.totalTokens, 200);
  assert.equal(scopeAnalysis(full, { provider: 'codex' }).calls.length, 5);
  assert.equal(scopeAnalysis(full, { since: Date.parse(iso(120)) }).sessions.length, 0);
});

test('scoped windows keep priced subtotals without filling unknown rates as zero', () => {
  const full = buildAnalysis([
    event({ id: 'priced', timestamp: iso(0), model: 'gpt-5.6-sol', usage: { inputTokens: 1_000_000, outputTokens: 0 } }),
    event({ id: 'unpriced', timestamp: iso(60), model: 'unpriced-model', usage: { inputTokens: 1_000_000, outputTokens: 0 } }),
  ], [{ ...rate, modelPattern: 'gpt-5.6-sol' }]);
  assert.equal(full.cost.usdComplete, false);
  assert.equal(full.cost.unknownCalls, 1);
  const pricedWindow = scopeAnalysis(full, { since: Date.parse(iso(0)), until: Date.parse(iso(1)) });
  assert.equal(pricedWindow.cost.usd, 1);
  assert.equal(pricedWindow.cost.usdComplete, true);
  assert.equal(pricedWindow.cost.unknownCalls, 0);
  const unpricedWindow = scopeAnalysis(full, { since: Date.parse(iso(60)), until: Date.parse(iso(61)) });
  assert.equal(unpricedWindow.cost.usd, undefined);
  assert.equal(unpricedWindow.cost.hasKnownAmount, false);
  assert.equal(unpricedWindow.cost.unknownCalls, 1);
});

test('overview preserves historical anomaly evidence but only prices in-window candidates', () => {
  const full = buildAnalysis([0, 60, 120].flatMap((seconds, index) => [
    event({ id: `window-call-${index}`, timestamp: iso(seconds), usage: { inputTokens: 1_000_000, outputTokens: 0 } }),
    event({ id: `window-read-${index}`, timestamp: iso(seconds), kind: 'tool', callId: `window-call-${index}`,
      toolName: 'Read', filePath: 'src/app.ts', fileRange: '1-3', contentHash: 'same' }),
  ]), [rate]);
  const scoped = scopeAnalysis(full, { since: Date.parse(iso(120)), until: Date.parse(iso(121)) });
  assert.equal(scoped.anomalies.length, 1);
  assert.deepEqual(scoped.anomalies[0].callIds, ['window-call-2']);
  assert.equal(scoped.anomalies[0].evidence.length, full.anomalies[0].evidence.length);
  assert.equal(scoped.anomalies[0].associatedCost?.usd, 1);
  assert.equal(scoped.candidateCost.usd, 1);
  assert.equal(full.cost.usd, 3);
  assert.equal(scopeAnalysis({ ...full, necessaryCallIds: new Set(['window-call-2']) }, {
    since: Date.parse(iso(120)), until: Date.parse(iso(121)),
  }).candidateCost.usd, 0);
});

test('overview never allocates a whole-session reported bill into a time window', () => {
  const full = buildAnalysis([
    event({ id: 'window-summary', scope: 'summary', reportedCostUsd: 99 }),
  ], [rate]);
  assert.equal(scopeAnalysis(full, { provider: 'codex' }).cost.usd, 99);
  const scoped = scopeAnalysis(full, { since: Date.parse(iso(0)), until: Date.parse(iso(60)) });
  assert.equal(scoped.cost.usd, 0);
  assert.equal(scoped.calls.length, 0);
});

test('scoped windows do not inherit parse errors from events outside the range', () => {
  const full = buildAnalysis(
    [event({ id: 'old', timestamp: iso(0), usage: { inputTokens: 1, outputTokens: 0 } })],
    [rate],
    { errors: [{ sourceFile: 'x.jsonl', line: 1, message: 'bad' }] },
  );
  assert.equal(full.completeness, 'partial');
  const scoped = scopeAnalysis(full, { since: Date.parse(iso(60)), until: Date.parse(iso(120)) });
  assert.equal(scoped.calls.length, 0);
  assert.equal(scoped.errors.length, 0);
  assert.equal(scoped.completeness, 'complete');
});

test('session lastDataAt follows parsed time, not string order', () => {
  const analysis = buildAnalysis([
    event({
      id: 'offset',
      timestamp: '2026-08-28T10:00:00-07:00',
      usage: { inputTokens: 1, outputTokens: 0 },
    }),
    event({
      id: 'utc',
      timestamp: '2026-08-28T16:00:00.000Z',
      usage: { inputTokens: 2, outputTokens: 0 },
    }),
  ], [rate]);
  assert.equal(analysis.sessions[0]?.lastDataAt, '2026-08-28T10:00:00-07:00');
  assert.equal(analysis.lastDataAt, '2026-08-28T10:00:00-07:00');
});

test('overview retains a child active in the window without importing parent usage', () => {
  const full = buildAnalysis([
    event({ id: 'old-parent', timestamp: iso(0), usage: { inputTokens: 1000, outputTokens: 0 } }),
    event({ id: 'recent-child', sessionId: 'child', actorId: 'child', parentSessionId: 'main',
      timestamp: iso(60), usage: { inputTokens: 200, outputTokens: 0 } }),
  ], [rate]);
  const scoped = scopeAnalysis(full, { since: Date.parse(iso(60)), until: Date.parse(iso(120)) });
  assert.equal(scoped.sessions.length, 1);
  assert.equal(scoped.sessions[0].id, 'child');
  assert.equal(scoped.sessions[0].inclusiveUsage.totalTokens, scoped.usage.totalTokens);
  assert.equal(scoped.usage.totalTokens, 200);
});

test('Codex usage and cost do not invent tokens when cached input exceeds the input snapshot', () => {
  const usage = { inputTokens: 0, cachedInputTokens: 30, outputTokens: 4, inputIncludesCached: true };
  assert.equal(usageTokenCount(usage), 4);
  const call = event({ usage, model: 'gpt-5.6-sol' });
  const cost = costForCalls([call], [rate]);
  assert.equal(cost.breakdown.cachedInputTokens, 0);
  assert.equal(cost.breakdown.inputTokens, 0);
  assert.equal(cost.breakdown.outputTokens, 4);
  assert.ok(cost.usd !== undefined);
  assert.equal(Number((cost.usd ?? 0).toFixed(10)), 4 * 5 / 1_000_000);
  const analysis = buildAnalysis([call], [rate]);
  assert.equal(analysis.usage.totalTokens, 4);
  assert.equal(analysis.usage.cachedInputTokens, 0);
  assert.equal(analysis.sessions[0]?.ownUsage.cachedInputTokens, 0);
  assert.equal(analysis.completeness, 'partial');
  assert.equal(analysis.sessions[0]?.completeness, 'partial');
});

test('cyclic session graphs keep consistent incomplete inclusive totals', () => {
  const pair = (first: 'a' | 'b', second: 'a' | 'b') => [
    event({
      id: first + '-call',
      sessionId: first,
      actorId: first,
      parentSessionId: second,
      usage: { inputTokens: 10, outputTokens: 0 },
    }),
    event({
      id: second + '-call',
      sessionId: second,
      actorId: second,
      parentSessionId: first,
      usage: { inputTokens: 10, outputTokens: 0 },
    }),
  ];
  const child = event({
    id: 'leaf-call',
    sessionId: 'leaf',
    actorId: 'leaf',
    parentSessionId: 'a',
    usage: { inputTokens: 5, outputTokens: 0 },
  });
  for (const events of [pair('a', 'b'), pair('b', 'a')]) {
    const analysis = buildAnalysis([...events, child], [rate]);
    const a = analysis.sessions.find((session) => session.id === 'a')!;
    const b = analysis.sessions.find((session) => session.id === 'b')!;
    const leaf = analysis.sessions.find((session) => session.id === 'leaf')!;
    assert.equal(a.completeness, 'partial');
    assert.equal(b.completeness, 'partial');
    assert.equal(leaf.completeness, 'complete');
    assert.equal(a.ownUsage.totalTokens, 10);
    assert.equal(b.ownUsage.totalTokens, 10);
    assert.equal(a.inclusiveUsage.totalTokens, 15);
    assert.equal(b.inclusiveUsage.totalTokens, 10);
    assert.equal(leaf.inclusiveUsage.totalTokens, 5);
    assert.equal(analysis.usage.totalTokens, 25);
  }
});

test('inclusive session totals stay iterative on a deep imported chain', () => {
  const events = Array.from({ length: 4000 }, (_, index) =>
    event({
      id: 'deep-call-' + String(index),
      sessionId: 's' + String(index),
      actorId: 's' + String(index),
      parentSessionId: index === 0 ? undefined : 's' + String(index - 1),
      usage: { inputTokens: 1, outputTokens: 0 },
    }),
  );
  const analysis = buildAnalysis(events, [rate]);
  assert.equal(analysis.sessions.length, 4000);
  assert.equal(analysis.sessions.find((session) => session.id === 's0')?.inclusiveUsage.totalTokens, 4000);
  assert.equal(analysis.sessions.find((session) => session.id === 's3999')?.inclusiveUsage.totalTokens, 1);
});

test('does not mix reread evidence across providers that share a session id', () => {
  const events: AnalysisEvent[] = [];
  for (const provider of ['codex', 'claude'] as const) {
    for (const [index, seconds] of [0, 60, 120].entries()) {
      events.push(
        event({
          id: provider + '-call-' + String(index),
          provider,
          sourceFile: provider + '.jsonl',
          sourceLine: index + 1,
          sessionId: 'shared',
          actorId: 'shared',
          timestamp: iso(seconds),
          kind: 'model',
          model: provider === 'claude' ? 'claude-sonnet-4' : 'gpt-5.6-sol',
          usage: { inputTokens: 10, outputTokens: 0 },
        }),
        event({
          id: provider + '-read-' + String(index),
          provider,
          sourceFile: provider + '.jsonl',
          sourceLine: index + 1,
          sessionId: 'shared',
          actorId: 'shared',
          timestamp: iso(seconds),
          kind: 'tool',
          callId: provider + '-call-' + String(index),
          toolName: 'Read',
          filePath: 'same.ts',
          fileRange: '1-3',
          contentHash: 'same',
        }),
      );
    }
  }
  const analysis = buildAnalysis(events, [rate, { ...rate, id: 'claude-rate', provider: 'claude' }]);
  const rereads = analysis.anomalies.filter((item) => item.type === 'reread');
  assert.equal(rereads.length, 2);
  for (const item of rereads) {
    assert.equal(item.callIds.length, 3);
    assert.ok(item.callIds.every((id) => id.startsWith(item.provider + '-')));
    assert.ok(item.evidence.every((evidence) => evidence.sourceFile === item.provider + '.jsonl'));
  }
});
