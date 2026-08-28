import {
  formatMoney,
  formatTokenCount,
  usageTokenCount,
  type AnalysisEvent,
  type AnalysisSession,
  type Behavior,
  type CostSummary,
  type Usage,
} from './analysis';

export const SESSION_TIME_RANGES = [
  { value: 'all', label: '全部', hours: undefined },
  { value: '5h', label: '最近 5 小时', hours: 5 },
  { value: '1d', label: '1 天', hours: 24 },
  { value: '7d', label: '7 天', hours: 168 },
  { value: '30d', label: '30 天', hours: 720 },
] as const;
export type SessionTimeRange = typeof SESSION_TIME_RANGES[number]['value'];

export function sessionsInTimeRange<T extends { lastDataAt?: string }>(sessions: readonly T[], range: SessionTimeRange, now: number): T[] {
  const hours = SESSION_TIME_RANGES.find((item) => item.value === range)?.hours;
  if (hours === undefined) return [...sessions];
  const since = now - hours * 60 * 60 * 1000;
  return sessions.filter((session) => {
    const timestamp = session.lastDataAt ? Date.parse(session.lastDataAt) : NaN;
    return Number.isFinite(timestamp) && timestamp >= since && timestamp <= now;
  });
}

/** Mutually exclusive buckets: cached input and reasoning must not be added twice. */
export function tokenComposition(usage?: Usage) {
  if (!usage) return undefined;
  const cached = usage.cachedInputTokens ?? 0;
  const uncached = usage.inputIncludesCached ? Math.max(0, usage.inputTokens - cached) : usage.inputTokens;
  const cacheWrite = usage.cacheCreationInputTokens ?? 0;
  const output = usage.outputTokens + (usage.outputIncludesReasoning ? 0 : usage.reasoningTokens ?? 0);
  return { uncached, cached, cacheWrite, output, total: uncached + cached + cacheWrite + output };
}

export function formatCallAmount(amount: number | undefined, currency: 'usd' | 'credits'): string {
  if (amount === undefined || !Number.isFinite(amount)) return '—';
  const value = amount === 0 ? '0' : amount < 0.000001 ? '<0.000001'
    : amount.toLocaleString('en-US', { maximumFractionDigits: amount < 0.01 ? 6 : amount < 1 ? 4 : 2 });
  return currency === 'usd' ? '$' + value : value;
}

export interface CallContent {
  prompt?: string;
  reply?: string;
  operations: string[];
}

function excerpt(text?: string, userPrompt = false): string | undefined {
  let value = text?.replace(/<in-app-browser-context\b[^>]*>[\s\S]*?<\/in-app-browser-context>/g, '').trim();
  if (userPrompt && value) {
    // Codex can wrap the actual request with attachment/browser metadata.
    const request = value.match(/(?:^|\n)## My request:\s*([\s\S]*)/i);
    if (request) value = request[1].trim();
  }
  return value ? value.slice(0, 1200) + (value.length > 1200 ? '\n… [摘录已截断]' : '') : undefined;
}

/** Content is adjacent log evidence, never an invented summary or a billing attribution. */
export function callContentIndex(events: readonly AnalysisEvent[]): Map<string, CallContent> {
  const groups = new Map<string, AnalysisEvent[]>();
  for (const event of events) {
    const key = JSON.stringify([event.provider, event.sessionId, event.actorId, event.sourceFile]);
    const group = groups.get(key) ?? [];
    group.push(event);
    groups.set(key, group);
  }
  const result = new Map<string, CallContent>();
  for (const group of groups.values()) {
    group.sort((a, b) => a.sourceLine - b.sourceLine);
    let prompt: string | undefined;
    let replies: string[] = [];
    let operations: string[] = [];
    for (const event of group) {
      if (event.kind === 'user') {
        prompt = excerpt(event.text, true);
        replies = [];
        operations = [];
      } else if (event.kind === 'assistant' && event.text) {
        replies.push(event.text);
      } else if (event.kind === 'tool' || event.kind === 'wait') {
        operations.push([event.toolName, event.toolInput || event.filePath || event.target].filter(Boolean).join(' · '));
      } else if (event.kind === 'model') {
        result.set(event.id, {
          prompt,
          reply: excerpt(event.text || [...new Set(replies)].join('\n')),
          operations: [...new Set(operations)].slice(0, 8),
        });
        replies = [];
        operations = [];
      }
    }
  }
  return result;
}

export function sessionDisplayName(session: Pick<AnalysisSession, 'id' | 'title' | 'cwd'>): string {
  const directory = session.cwd?.replace(/\\/g, '/').split('/').filter(Boolean).at(-1) || '未知目录';
  const title = session.title.trim();
  return directory + ' - ' + (title && title !== session.id ? title : '未命名会话 · ' + session.id.slice(0, 8));
}

export function paginate<T>(items: readonly T[], requestedPage: number, pageSize: number) {
  const size = Math.max(1, Math.floor(pageSize) || 1);
  const pageCount = Math.max(1, Math.ceil(items.length / size));
  const page = Math.max(1, Math.min(Math.floor(requestedPage) || 1, pageCount));
  const start = (page - 1) * size;
  return { items: items.slice(start, start + size), page, pageCount, total: items.length, start: items.length ? start + 1 : 0, end: Math.min(start + size, items.length) };
}

export const BEHAVIOR_KEYS: Array<{ key: Behavior; label: string }> = [
  { key: 'code', label: '代码与执行' },
  { key: 'subagent', label: '子 Agent' },
  { key: 'read', label: '读取' },
  { key: 'wait', label: '等待 / 轮询' },
  { key: 'planning', label: '规划与思考' },
  { key: 'mixed', label: '混合' },
  { key: 'other', label: '其他' },
  { key: 'unknown', label: '未知归因' },
];

export const TOKEN_PARTS = [
  { key: 'uncached', label: '未缓存输入' },
  { key: 'cached', label: '缓存读取' },
  { key: 'cacheWrite', label: '缓存写入' },
  { key: 'output', label: '输出' },
] as const;

export function sessionCollapseKey(session: Pick<AnalysisSession, 'id' | 'provider'>): string {
  return session.provider + '\0' + session.id;
}

/** Largest-remainder percents so a mutually exclusive set always sums to 100, never 99 or 101. */
export function sharePercents(values: readonly number[], total = values.reduce((sum, value) => sum + value, 0)): number[] {
  if (total <= 0) return values.map(() => 0);
  const raw = values.map((value) => (value / total) * 100);
  const floored = raw.map((value) => Math.floor(value));
  let remain = 100 - floored.reduce((sum, value) => sum + value, 0);
  const order = raw
    .map((value, index) => ({ index, frac: value - Math.floor(value) }))
    .sort((left, right) => right.frac - left.frac || left.index - right.index);
  const result = [...floored];
  for (let offset = 0; remain > 0 && order.length; offset += 1, remain -= 1) {
    result[order[offset % order.length]!.index] += 1;
  }
  return result;
}

export function behaviorKey(behavior?: Behavior): Behavior {
  if (
    behavior === 'code' ||
    behavior === 'subagent' ||
    behavior === 'read' ||
    behavior === 'wait' ||
    behavior === 'planning' ||
    behavior === 'mixed' ||
    behavior === 'other'
  ) {
    return behavior;
  }
  return 'unknown';
}

export function behaviorShares(calls: readonly AnalysisEvent[]) {
  const totals = new Map<Behavior, number>();
  for (const call of calls) {
    const key = behaviorKey(call.behavior);
    totals.set(key, (totals.get(key) ?? 0) + usageTokenCount(call.usage));
  }
  const values = BEHAVIOR_KEYS.map((item) => totals.get(item.key) ?? 0);
  const percents = sharePercents(values);
  return BEHAVIOR_KEYS.map((item, index) => ({
    ...item,
    tokens: values[index] ?? 0,
    percent: percents[index] ?? 0,
  }));
}

export function aggregateTokenComposition(calls: readonly AnalysisEvent[]) {
  const totals = { uncached: 0, cached: 0, cacheWrite: 0, output: 0, total: 0 };
  for (const call of calls) {
    const part = tokenComposition(call.usage);
    if (!part) continue;
    totals.uncached += part.uncached;
    totals.cached += part.cached;
    totals.cacheWrite += part.cacheWrite;
    totals.output += part.output;
    totals.total += part.total;
  }
  const percents = sharePercents([totals.uncached, totals.cached, totals.cacheWrite, totals.output], totals.total);
  return {
    ...totals,
    parts: TOKEN_PARTS.map((part, index) => ({
      ...part,
      tokens: totals[part.key],
      percent: percents[index] ?? 0,
    })),
  };
}

/**
 * Tokens per minute over the last 15 minutes of recorded activity (or the
 * whole session if shorter). Last-two-call deltas are too noisy to sort on.
 */
export function sessionGrowthRate(session: Pick<AnalysisSession, 'ownCalls' | 'lastDataAt'>): number | undefined {
  const calls = session.ownCalls
    .filter((call) => call.timestamp && call.usage)
    .sort((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp));
  if (calls.length < 2) return undefined;
  const end = Date.parse(session.lastDataAt || calls.at(-1)!.timestamp);
  const start = Date.parse(calls[0]!.timestamp);
  if (!Number.isFinite(end) || !Number.isFinite(start) || end <= start) return undefined;
  const windowMs = Math.min(15 * 60_000, end - start);
  const since = end - windowMs;
  const tokens = calls
    .filter((call) => Date.parse(call.timestamp) >= since)
    .reduce((sum, call) => sum + usageTokenCount(call.usage), 0);
  return tokens / (windowMs / 60_000);
}

export function formatGrowthRate(rate: number | undefined): string {
  if (rate === undefined || !Number.isFinite(rate)) return '—';
  if (rate === 0) return '0 / 分钟';
  if (rate > 0 && rate < 1) return '<1 / 分钟';
  return formatTokenCount(rate) + ' / 分钟';
}

export function displayCost(
  summary: CostSummary,
  currency: 'usd' | 'credits',
): { value: string; note: string; tone: 'known' | 'partial' | 'unknown' } {
  if (!summary.hasKnownAmount) {
    if (summary.knownCalls === 0 && summary.unknownCalls === 0) {
      return {
        value: formatMoney(0, currency === 'usd' ? 'USD' : 'credits'),
        note: '没有可计价调用',
        tone: 'known',
      };
    }
    return {
      value: '未知',
      note: summary.basis || '暂无适用费率',
      tone: 'unknown',
    };
  }
  if (currency === 'usd' && summary.usd !== undefined) {
    return {
      value: formatMoney(summary.usd, 'USD'),
      note: summary.usdComplete ? 'USD 估算' : 'USD 已知小计',
      tone: summary.usdComplete ? 'known' : 'partial',
    };
  }
  if (currency === 'credits' && summary.credits !== undefined) {
    return {
      value: formatMoney(summary.credits, 'credits'),
      note: summary.creditsComplete ? 'credits 估算' : 'credits 已知小计',
      tone: summary.creditsComplete ? 'known' : 'partial',
    };
  }
  if (currency === 'usd' && summary.credits !== undefined) {
    return {
      value: formatMoney(summary.credits, 'credits'),
      note: 'USD 费率未知 · credits 估算',
      tone: 'partial',
    };
  }
  if (currency === 'credits' && summary.usd !== undefined) {
    return {
      value: formatMoney(summary.usd, 'USD'),
      note: 'credits 费率未知 · USD 估算',
      tone: 'partial',
    };
  }
  return {
    value: '未知',
    note: summary.basis || '暂无适用费率',
    tone: 'unknown',
  };
}

export function candidateShare(
  cost: CostSummary,
  candidate: CostSummary,
  currency: 'usd' | 'credits',
): { percent: number | undefined; note: string } {
  const total = cost[currency];
  const part = candidate[currency];
  if (total === undefined || part === undefined) {
    return { percent: undefined, note: '缺少可比较的已知费用，无法计算占比' };
  }
  if (total <= 0) {
    return {
      percent: part === 0 ? 0 : undefined,
      note: part === 0 ? '没有可计价调用' : '分母为零，无法计算占比',
    };
  }
  return {
    percent: Math.round((part / total) * 100),
    note: (currency === 'usd' ? cost.usdComplete && candidate.usdComplete : cost.creditsComplete && candidate.creditsComplete)
      ? '占已知费用'
      : '占已知小计',
  };
}

export function confidenceLabel(confidence: 'high' | 'medium' | 'low'): string {
  if (confidence === 'high') return '高';
  if (confidence === 'medium') return '中';
  return '低';
}

export function sessionRoots<T extends Pick<AnalysisSession, 'id' | 'provider' | 'parentSessionId'>>(sessions: readonly T[]): T[] {
  const keys = new Set(sessions.map(sessionCollapseKey));
  return sessions.filter((session) => {
    if (!session.parentSessionId) return true;
    return !keys.has(session.provider + '\0' + session.parentSessionId);
  });
}

export function sessionTreeRows<T extends Pick<AnalysisSession, 'id' | 'provider' | 'parentSessionId'>>(
  sessions: readonly T[],
  collapsedIds: ReadonlySet<string>,
): Array<{ session: T; depth: number; childCount: number }> {
  const children = new Map<string, T[]>();
  const keys = new Set(sessions.map(sessionCollapseKey));
  for (const session of sessions) {
    if (!session.parentSessionId) continue;
    const parentKey = session.provider + '\0' + session.parentSessionId;
    if (!keys.has(parentKey)) continue;
    const list = children.get(parentKey) ?? [];
    list.push(session);
    children.set(parentKey, list);
  }
  const rows: Array<{ session: T; depth: number; childCount: number }> = [];
  const walk = (session: T, depth: number) => {
    const kids = children.get(sessionCollapseKey(session)) ?? [];
    rows.push({ session, depth, childCount: kids.length });
    if (kids.length && !collapsedIds.has(sessionCollapseKey(session))) {
      for (const child of kids) walk(child, depth + 1);
    }
  };
  for (const root of sessionRoots(sessions)) walk(root, 0);
  return rows;
}

export function sessionsUnderRoots<T extends Pick<AnalysisSession, 'id' | 'provider' | 'parentSessionId'>>(
  sessions: readonly T[],
  roots: readonly T[],
): T[] {
  const allowed = new Set(roots.map(sessionCollapseKey));
  let changed = true;
  while (changed) {
    changed = false;
    for (const session of sessions) {
      const key = sessionCollapseKey(session);
      if (allowed.has(key)) continue;
      if (session.parentSessionId && allowed.has(session.provider + '\0' + session.parentSessionId)) {
        allowed.add(key);
        changed = true;
      }
    }
  }
  return sessions.filter((session) => allowed.has(sessionCollapseKey(session)));
}
