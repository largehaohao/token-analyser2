import type { AnalysisEvent, AnalysisSession, Usage } from './analysis';

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
