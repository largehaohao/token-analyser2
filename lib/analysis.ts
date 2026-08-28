import { extractContextSnapshots, type ContextSnapshot } from './context-inventory';

export type Provider = 'codex' | 'claude' | 'unknown';

export type EventKind =
  | 'model'
  | 'tool'
  | 'user'
  | 'assistant'
  | 'context'
  | 'compaction'
  | 'wait'
  | 'unknown';

export type Behavior =
  | 'planning'
  | 'code'
  | 'read'
  | 'wait'
  | 'subagent'
  | 'other'
  | 'mixed'
  | 'unknown';

export interface Usage {
  inputTokens: number;
  cachedInputTokens?: number;
  cacheCreationInputTokens?: number;
  outputTokens: number;
  reasoningTokens?: number;
  inputIncludesCached?: boolean;
  /**
   * Some providers expose reasoning_output_tokens as a child of output_tokens.
   * Keep the detail for display without adding it to the billable total twice.
   */
  outputIncludesReasoning?: boolean;
  cumulative?: boolean;
}

export interface AnalysisEvent {
  id: string;
  provider: Provider;
  sourceFile: string;
  sourceLine: number;
  timestamp: string;
  kind: EventKind;
  sessionId: string;
  parentSessionId?: string;
  sessionTitle?: string;
  cwd?: string;
  actorId: string;
  model?: string;
  callId?: string;
  modelCallId?: string;
  userRequestId?: string;
  toolName?: string;
  toolInput?: string;
  toolOutput?: string;
  filePath?: string;
  fileRange?: string;
  contentHash?: string;
  target?: string;
  stateHash?: string;
  pureWait?: boolean;
  behavior?: Behavior;
  usage?: Usage;
  reportedCostUsd?: number;
  scope?: 'call' | 'tree' | 'summary';
  complete?: boolean;
  text?: string;
  rawType?: string;
  contextSnapshot?: ContextSnapshot;
}

export interface ParsedJsonl {
  events: AnalysisEvent[];
  errors: ParseError[];
  provider: Provider;
  sourceFile: string;
  lineCount: number;
}

export interface ParseError {
  line: number;
  message: string;
  sourceFile?: string;
}

export interface RateSnapshot {
  id: string;
  provider: Provider;
  modelPattern: string;
  inputCreditsPerMillion?: number;
  cachedInputCreditsPerMillion?: number;
  cacheCreationCreditsPerMillion?: number;
  outputCreditsPerMillion?: number;
  inputUsdPerMillion?: number;
  cachedInputUsdPerMillion?: number;
  cacheCreationUsdPerMillion?: number;
  outputUsdPerMillion?: number;
  source: string;
  checkedDate: string;
  applicability: string;
  kind: 'official' | 'custom' | 'demo';
}

export interface CostBreakdown {
  inputTokens: number;
  cachedInputTokens: number;
  cacheCreationInputTokens: number;
  outputTokens: number;
  credits?: number;
  usd?: number;
}

export interface CostSummary {
  credits?: number;
  usd?: number;
  complete: boolean;
  hasKnownAmount: boolean;
  basis: string;
  knownCalls: number;
  unknownCalls: number;
  breakdown: CostBreakdown;
}

export interface UsageSummary {
  inputTokens: number;
  cachedInputTokens: number;
  cacheCreationInputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  totalTokens: number;
}

export interface Evidence {
  label: string;
  detail: string;
  sourceFile?: string;
  sourceLine?: number;
  eventId?: string;
}

export type AnomalyType = 'reread' | 'poll' | 'compaction';

export interface Anomaly {
  id: string;
  type: AnomalyType;
  title: string;
  description: string;
  confidence: 'high' | 'medium' | 'low';
  actorId: string;
  sessionId: string;
  startedAt?: string;
  endedAt?: string;
  callIds: string[];
  candidateCallIds: string[];
  baselineCallIds: string[];
  evidence: Evidence[];
  necessary?: boolean;
  mixed?: boolean;
  recommendation?: string;
  associatedCost?: CostSummary;
}

export interface AnalysisSession {
  id: string;
  provider: Provider;
  title: string;
  cwd?: string;
  parentSessionId?: string;
  childSessionIds: string[];
  ownCalls: AnalysisEvent[];
  ownUsage: UsageSummary;
  ownCost: CostSummary;
  inclusiveUsage: UsageSummary;
  inclusiveCost: CostSummary;
  completeness: 'complete' | 'partial' | 'unknown';
  lastDataAt?: string;
}

export interface AnalysisResult {
  mode: 'demo' | 'history' | 'live';
  sourceLabel: string;
  events: AnalysisEvent[];
  calls: AnalysisEvent[];
  sessions: AnalysisSession[];
  anomalies: Anomaly[];
  usage: UsageSummary;
  cost: CostSummary;
  candidateCost: CostSummary;
  necessaryCallIds: Set<string>;
  lastDataAt?: string;
  errors: ParseError[];
  rates: RateSnapshot[];
  completeness: 'complete' | 'partial' | 'unknown';
}

interface ParseOptions {
  provider?: Provider;
  sourceFile: string;
  sessionId?: string;
  model?: string;
  cwd?: string;
  sessionTitle?: string;
  lineOffset?: number;
}

type JsonRecord = Record<string, unknown>;

const MILLION = 1_000_000;

export const defaultRateSnapshots: RateSnapshot[] = [
  {
    id: 'codex-sol-2026-08',
    provider: 'codex',
    modelPattern: 'gpt-5.6-sol',
    inputCreditsPerMillion: 100,
    cachedInputCreditsPerMillion: 10,
    cacheCreationCreditsPerMillion: 0,
    outputCreditsPerMillion: 500,
    source: 'OpenAI Help Center Codex rate card · https://help.openai.com/en/articles/11481834',
    checkedDate: '2026-08-28',
    applicability: 'ChatGPT Work / Codex token-based credit pricing; plan, fast mode and long-context conditions must match',
    kind: 'official',
  },
  {
    id: 'codex-terra-2026-08',
    provider: 'codex',
    modelPattern: 'gpt-5.6-terra',
    inputCreditsPerMillion: 50,
    cachedInputCreditsPerMillion: 5,
    cacheCreationCreditsPerMillion: 0,
    outputCreditsPerMillion: 300,
    source: 'OpenAI Help Center Codex rate card · https://help.openai.com/en/articles/11481834',
    checkedDate: '2026-08-28',
    applicability: 'ChatGPT Work / Codex token-based credit pricing; plan, fast mode and long-context conditions must match',
    kind: 'official',
  },
  {
    id: 'codex-luna-2026-08',
    provider: 'codex',
    modelPattern: 'gpt-5.6-luna',
    inputCreditsPerMillion: 5,
    cachedInputCreditsPerMillion: 0.5,
    cacheCreationCreditsPerMillion: 0,
    outputCreditsPerMillion: 30,
    source: 'OpenAI Help Center Codex rate card · https://help.openai.com/en/articles/11481834',
    checkedDate: '2026-08-28',
    applicability: 'ChatGPT Work / Codex token-based credit pricing; plan, fast mode and long-context conditions must match',
    kind: 'official',
  },
  {
    id: 'codex-gpt54-2026-08',
    provider: 'codex',
    modelPattern: 'gpt-5.4',
    inputCreditsPerMillion: 62.5,
    cachedInputCreditsPerMillion: 6.25,
    cacheCreationCreditsPerMillion: 0,
    outputCreditsPerMillion: 375,
    source: 'OpenAI Help Center Codex rate card · https://help.openai.com/en/articles/11481834',
    checkedDate: '2026-08-28',
    applicability: 'ChatGPT Work / Codex token-based credit pricing; plan, fast mode and long-context conditions must match',
    kind: 'official',
  },
  {
    id: 'codex-gpt54-mini-2026-08',
    provider: 'codex',
    modelPattern: 'gpt-5.4-mini',
    inputCreditsPerMillion: 18.75,
    cachedInputCreditsPerMillion: 1.875,
    cacheCreationCreditsPerMillion: 0,
    outputCreditsPerMillion: 113,
    source: 'OpenAI Help Center Codex rate card · https://help.openai.com/en/articles/11481834',
    checkedDate: '2026-08-28',
    applicability: 'ChatGPT Work / Codex token-based credit pricing; plan, fast mode and long-context conditions must match',
    kind: 'official',
  },
  {
    id: 'codex-gpt55-2026-08',
    provider: 'codex',
    modelPattern: 'gpt-5.5',
    inputCreditsPerMillion: 125,
    cachedInputCreditsPerMillion: 12.5,
    cacheCreationCreditsPerMillion: 0,
    outputCreditsPerMillion: 750,
    source: 'OpenAI Help Center Codex rate card · https://help.openai.com/en/articles/11481834',
    checkedDate: '2026-08-28',
    applicability: 'ChatGPT Work / Codex token-based credit pricing; plan, fast mode and long-context conditions must match',
    kind: 'official',
  },
  {
    id: 'codex-gpt53-codex-2026-08',
    provider: 'codex',
    modelPattern: 'gpt-5.3-codex',
    inputCreditsPerMillion: 43.75,
    cachedInputCreditsPerMillion: 4.375,
    cacheCreationCreditsPerMillion: 0,
    outputCreditsPerMillion: 350,
    source: 'OpenAI Help Center Codex rate card · https://help.openai.com/en/articles/11481834',
    checkedDate: '2026-08-28',
    applicability: 'ChatGPT Work / Codex token-based credit pricing; plan, fast mode and long-context conditions must match',
    kind: 'official',
  },
  {
    id: 'claude-sonnet-4-2026-08',
    provider: 'claude',
    modelPattern: 'claude-sonnet-4',
    inputUsdPerMillion: 3,
    cachedInputUsdPerMillion: 0.3,
    cacheCreationUsdPerMillion: 3.75,
    outputUsdPerMillion: 15,
    source: 'Anthropic API pricing · https://docs.anthropic.com/en/about-claude/pricing',
    checkedDate: '2026-08-28',
    applicability: 'Anthropic API list prices; Claude Code subscription or included usage may differ',
    kind: 'official',
  },
  {
    id: 'claude-opus-4-2026-08',
    provider: 'claude',
    modelPattern: 'claude-opus-4',
    inputUsdPerMillion: 15,
    cachedInputUsdPerMillion: 1.5,
    cacheCreationUsdPerMillion: 18.75,
    outputUsdPerMillion: 75,
    source: 'Anthropic API pricing · https://docs.anthropic.com/en/about-claude/pricing',
    checkedDate: '2026-08-28',
    applicability: 'Anthropic API list prices; Claude Code subscription or included usage may differ',
    kind: 'official',
  },
  {
    id: 'claude-haiku-4-2026-08',
    provider: 'claude',
    modelPattern: 'claude-haiku',
    inputUsdPerMillion: 1,
    cachedInputUsdPerMillion: 0.1,
    cacheCreationUsdPerMillion: 1.25,
    outputUsdPerMillion: 5,
    source: 'Anthropic API pricing · https://docs.anthropic.com/en/about-claude/pricing',
    checkedDate: '2026-08-28',
    applicability: 'Anthropic API list prices; Claude Code subscription or included usage may differ',
    kind: 'official',
  },
];

export const demoRateSnapshots: RateSnapshot[] = [
  {
    id: 'demo-codex',
    provider: 'codex',
    modelPattern: '*',
    inputUsdPerMillion: 1.1,
    cachedInputUsdPerMillion: 0.11,
    outputUsdPerMillion: 5.2,
    source: 'TokenScope 合成演示费率',
    checkedDate: '2026-08-28',
    applicability: '仅用于演示，不代表服务商价格',
    kind: 'demo',
  },
  {
    id: 'demo-claude',
    provider: 'claude',
    modelPattern: '*',
    inputUsdPerMillion: 2.2,
    cachedInputUsdPerMillion: 0.22,
    outputUsdPerMillion: 11,
    source: 'TokenScope 合成演示费率',
    checkedDate: '2026-08-28',
    applicability: '仅用于演示，不代表服务商价格',
    kind: 'demo',
  },
];

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringValue(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return undefined;
}

function numberValue(...values: unknown[]): number | undefined {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) {
      return Number(value);
    }
  }
  return undefined;
}

function firstRecord(...values: unknown[]): JsonRecord | undefined {
  return values.find(isRecord);
}

function nestedRecord(value: unknown, ...keys: string[]): JsonRecord | undefined {
  if (!isRecord(value)) return undefined;
  for (const key of keys) {
    if (isRecord(value[key])) return value[key];
  }
  return undefined;
}

function normalizeProvider(value: unknown, sourceFile: string): Provider {
  const text = stringValue(value, sourceFile)?.toLowerCase() ?? '';
  if (text.includes('claude') || text.includes('anthropic')) return 'claude';
  if (text.includes('codex') || text.includes('openai') || text.includes('gpt')) {
    return 'codex';
  }
  if (isRecord(value)) {
    const type = stringValue(value.type, value.event, value.subtype)?.toLowerCase() ?? '';
    const serialized = JSON.stringify(value).toLowerCase();
    // Generic filenames are common for native logs. Use stable protocol
    // fields to infer the source without treating prompt text as metadata.
    if (
      serialized.includes('"cache_read_input_tokens"') ||
      serialized.includes('"cache_creation_input_tokens"') ||
      serialized.includes('"tool_use"') ||
      serialized.includes('"tool_result"') ||
      type.includes('tool_use') ||
      type.includes('tool_result')
    ) {
      return 'claude';
    }
    if (
      type.includes('response_item') ||
      type.includes('event_msg') ||
      type.includes('token_count') ||
      type.includes('function_call')
    ) {
      return 'codex';
    }
  }
  return 'unknown';
}

function timestampFor(value: unknown): string {
  const candidate = stringValue(value);
  if (candidate && !Number.isNaN(Date.parse(candidate))) return new Date(candidate).toISOString();
  const numeric = numberValue(value);
  if (numeric !== undefined) {
    const millis = numeric < 10_000_000_000 ? numeric * 1000 : numeric;
    const date = new Date(millis);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }
  return '';
}

function hashText(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function textFromContent(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    const parts = value
      .map((item) => {
        if (typeof item === 'string') return item;
        if (isRecord(item)) return stringValue(item.text, item.content, item.output);
        return undefined;
      })
      .filter((item): item is string => Boolean(item));
    return parts.length ? parts.join('\n') : undefined;
  }
  if (isRecord(value)) {
    const numericKeys = Object.keys(value)
      .filter((key) => /^\d+$/.test(key))
      .sort((left, right) => Number(left) - Number(right));
    if (numericKeys.length) {
      return textFromContent(numericKeys.map((key) => value[key]));
    }
    return stringValue(value.text, value.content, value.output, value.stdout, value.stderr, value.result);
  }
  return undefined;
}

function boundedText(value: string | undefined, limit = 4000): string | undefined {
  if (value === undefined || value.length <= limit) return value;
  const head = Math.ceil(limit * 0.75);
  const tail = Math.max(0, limit - head);
  return value.slice(0, head) + '\n… [output truncated] …\n' + value.slice(-tail);
}

function usageFromRecord(value: unknown): Usage | undefined {
  if (!isRecord(value)) return undefined;
  const input = numberValue(
    value.input_tokens,
    value.inputTokens,
    value.prompt_tokens,
    value.promptTokens,
  );
  const cached = numberValue(
    value.cached_input_tokens,
    value.cachedInputTokens,
    value.cache_read_input_tokens,
    value.cacheReadInputTokens,
    value.cache_read_tokens,
  );
  const cacheCreation = numberValue(
    value.cache_creation_input_tokens,
    value.cacheCreationInputTokens,
    value.cache_creation_tokens,
  );
  const output = numberValue(
    value.output_tokens,
    value.outputTokens,
    value.completion_tokens,
    value.completionTokens,
  );
  const reasoning = numberValue(
    value.reasoning_output_tokens,
    value.reasoningOutputTokens,
    value.reasoning_tokens,
    value.reasoningTokens,
  );
  if (input === undefined && cached === undefined && output === undefined && reasoning === undefined) {
    return undefined;
  }
  return {
    inputTokens: input ?? 0,
    cachedInputTokens: cached ?? 0,
    cacheCreationInputTokens: cacheCreation ?? 0,
    outputTokens: output ?? 0,
    reasoningTokens: reasoning ?? 0,
  };
}

function findUsage(value: unknown, depth = 0): Usage | undefined {
  if (depth > 4 || !isRecord(value)) return undefined;
  const direct = usageFromRecord(value);
  if (direct) return direct;
  const preferredKeys = [
    'usage',
    'token_usage',
    'tokenUsage',
    'total_token_usage',
    'totalTokenUsage',
    'info',
    'message',
    'result',
  ];
  for (const key of preferredKeys) {
    const found = findUsage(value[key], depth + 1);
    if (found) return found;
  }
  for (const nested of Object.values(value)) {
    const found = findUsage(nested, depth + 1);
    if (found) return found;
  }
  return undefined;
}

function extractArguments(value: unknown): JsonRecord {
  if (isRecord(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed: unknown = JSON.parse(value);
      if (isRecord(parsed)) return parsed;
    } catch {
      // Codex desktop stores custom_tool_call.input as the source text that
      // was sent to the tool (for example a shell wrapper around `sed` or
      // `rg`), rather than as a JSON argument object. Preserve a bounded
      // prefix so classification can distinguish code from file reads while
      // keeping the browser payload small.
      return value.trim() ? { __raw: value.slice(0, 320) } : {};
    }
  }
  return {};
}

function rawToolInput(input: JsonRecord): string | undefined {
  return stringValue(input.__raw, input.command, input.cmd, input.script, input.query, input.code);
}

function shellReadPath(input: JsonRecord): string | undefined {
  const raw = rawToolInput(input);
  if (!raw) return undefined;
  const command = raw.replace(/\\"/g, '"').replace(/\\n/g, '\n');
  const match = command.match(
    /(?:^|[;&|]\s*|(?:cmd|command|script)\s*[:=]\s*["']?)(?:cat|sed|head|tail|rg|grep|awk|find|ls|wc|stat|git\s+(?:show|diff|log|status))\b[^\n]*?\s((?:\/?[.~]\/|\/?[A-Za-z]:[\\/]|\/)[^\s'"`|;)]+)/im,
  );
  return match?.[1];
}

function shellReadTool(input: JsonRecord): boolean {
  const raw = rawToolInput(input);
  if (!raw) return false;
  return /(?:^|[;&|\s])(?:cat|sed|head|tail|rg|grep|awk|find|ls|wc|stat|git\s+(?:show|diff|log|status))\b/i.test(
    raw.replace(/\\"/g, '"'),
  );
}

function toolDetails(
  name: string | undefined,
  input: JsonRecord,
  output?: string,
): Pick<AnalysisEvent, 'filePath' | 'fileRange' | 'target' | 'stateHash' | 'contentHash' | 'pureWait'> {
  const lower = (name ?? '').toLowerCase();
  const filePath = stringValue(
    input.file_path,
    input.filePath,
    input.path,
    input.filename,
    input.file,
    shellReadPath(input),
  );
  const start = numberValue(input.start_line, input.startLine, input.line_start, input.lineStart);
  const end = numberValue(input.end_line, input.endLine, input.line_end, input.lineEnd);
  const range = stringValue(
    input.range,
    input.lines,
    start !== undefined && end !== undefined ? String(start) + '-' + String(end) : undefined,
    start !== undefined ? String(start) : undefined,
  );
  const target = stringValue(input.target, input.task_id, input.taskId, input.session_id, input.sessionId);
  const isWait =
    /(^|[-_ ])(wait|poll)([-_ ]|$)/.test(lower) ||
    lower.includes('wait_for') ||
    lower.includes('get_task_status') ||
    lower.includes('check_task');
  const nested = Boolean(output && /"type"\s*:\s*"(function_call|tool_use)"/.test(output));
  return {
    filePath,
    fileRange: range,
    target,
    stateHash: output ? hashText(output.replace(/\s+/g, ' ').trim()) : undefined,
    contentHash: output ? hashText(output) : undefined,
    pureWait: Boolean(isWait && output && !nested),
  };
}

function recordType(record: JsonRecord): string {
  const direct = stringValue(record.type, record.event, record.subtype);
  const nested = stringValue(
    isRecord(record.payload) ? record.payload.type : undefined,
    isRecord(record.message) ? record.message.type : undefined,
  );
  if (nested && (!direct || direct === 'response_item' || direct === 'event_msg')) {
    return nested.toLowerCase();
  }
  return direct?.toLowerCase() ?? 'unknown';
}

function payloadOf(record: JsonRecord): JsonRecord {
  return firstRecord(record.payload, record.data, record.event) ?? record;
}

function findSessionId(record: JsonRecord, fallback: string): string {
  const payload = payloadOf(record);
  const type = stringValue(record.type, record.event, record.subtype, payload.type)?.toLowerCase() ?? '';
  const metadataSessionId = /session|conversation|thread|metadata|meta/.test(type)
    ? payload.id
    : undefined;
  return (
    stringValue(
      record.session_id,
      record.sessionId,
      record.conversation_id,
      record.conversationId,
      record.thread_id,
      record.threadId,
      payload.session_id,
      payload.sessionId,
      metadataSessionId,
      fallback,
    ) ?? fallback
  );
}

function findParentSessionId(record: JsonRecord): string | undefined {
  const payload = payloadOf(record);
  return stringValue(
    record.parent_session_id,
    record.parentSessionId,
    record.parentUuid,
    record.parent_uuid,
    record.parent_id,
    record.parentId,
    record.parent_thread_id,
    record.parentThreadId,
    record.forked_from,
    record.forkedFrom,
    payload.parent_session_id,
    payload.parentSessionId,
    payload.parentUuid,
    payload.parent_uuid,
    payload.parent_id,
    payload.parentId,
    payload.parent_thread_id,
    payload.parentThreadId,
    payload.forked_from,
    payload.forkedFrom,
  );
}

function findActorId(record: JsonRecord, sessionId: string): string {
  const payload = payloadOf(record);
  return (
    stringValue(
      record.actor_id,
      record.actorId,
      record.agent_id,
      record.agentId,
      payload.actor_id,
      payload.actorId,
      sessionId,
    ) ?? sessionId
  );
}

function findSessionTitle(record: JsonRecord): string | undefined {
  const payload = payloadOf(record);
  return stringValue(
    record.session_title,
    record.sessionTitle,
    record.title,
    record.thread_name,
    record.customTitle,
    payload.session_title,
    payload.sessionTitle,
    payload.title,
    payload.thread_name,
    payload.agent_nickname,
  );
}

function findModel(record: JsonRecord): string | undefined {
  const message = nestedRecord(record, 'message');
  const payload = payloadOf(record);
  const threadSettings = nestedRecord(payload, 'thread_settings');
  const baseInstructions = nestedRecord(payload, 'base_instructions');
  const provenance = nestedRecord(baseInstructions, 'provenance');
  const settings = nestedRecord(payload, 'settings');
  return stringValue(
    record.model,
    message?.model,
    payload.model,
    payload.model_name,
    payload.modelName,
    threadSettings?.model,
    settings?.model,
    baseInstructions?.model,
    provenance?.model,
  );
}

function findTimestamp(record: JsonRecord): string {
  const payload = payloadOf(record);
  return timestampFor(record.timestamp ?? record.created_at ?? record.createdAt ?? payload.timestamp);
}

function findText(record: JsonRecord): string | undefined {
  const message = nestedRecord(record, 'message');
  const payload = payloadOf(record);
  return textFromContent(
    record.text ??
      record.content ??
      record.output ??
      message?.content ??
      record.message ??
      payload.text ??
      payload.message ??
      payload.content,
  );
}

function tokenSnapshotUsage(record: JsonRecord): { usage?: Usage; cumulative: boolean } {
  const payload = payloadOf(record);
  const info = nestedRecord(payload, 'info') ?? nestedRecord(record, 'info');
  const total = info ? usageFromRecord(info.total_token_usage ?? info.totalTokenUsage) : undefined;
  if (total) {
    total.outputIncludesReasoning = true;
    return { usage: total, cumulative: true };
  }
  const last = info ? usageFromRecord(info.last_token_usage ?? info.lastTokenUsage) : undefined;
  if (last) {
    last.outputIncludesReasoning = true;
    return { usage: last, cumulative: false };
  }
  return { usage: findUsage(record), cumulative: true };
}

function makeEvent(
  base: Pick<AnalysisEvent, 'id' | 'provider' | 'sourceFile' | 'sourceLine' | 'timestamp' | 'sessionId' | 'actorId' | 'sessionTitle'>,
  fields: Partial<AnalysisEvent>,
): AnalysisEvent {
  return { ...base, kind: 'unknown', ...fields };
}

function isToolResultOnly(record: JsonRecord): boolean {
  const containers = [record, payloadOf(record), nestedRecord(record, 'message')];
  for (const container of containers) {
    if (!container) continue;
    const content = container.content;
    if (!Array.isArray(content) || content.length === 0) continue;
    if (
      content.every(
        (item) =>
          isRecord(item) &&
          /^(tool_result|function_call_output)$/.test(stringValue(item.type)?.toLowerCase() ?? ''),
      )
    ) {
      return true;
    }
  }
  return false;
}

export function parseJsonl(text: string, options: ParseOptions): ParsedJsonl {
  const errors: ParseError[] = [];
  const events: AnalysisEvent[] = [];
  const sourceFile = options.sourceFile;
  const fallbackSession = options.sessionId ?? (sourceFile.replace(/\.[^.]+$/, '') || 'session');
  let provider = options.provider ?? normalizeProvider(undefined, sourceFile);
  let latestSession = fallbackSession;
  let latestUserRequest: string | undefined;
  const seenUsageSessions = new Set<string>();
  const toolEvents = new Map<string, AnalysisEvent>();
  const pendingOutputs = new Map<string, string>();
  const sessionTitles = new Map<string, string>();
  const sessionDirectories = new Map<string, string>();
  if (options.sessionId && options.cwd) sessionDirectories.set(options.sessionId, options.cwd);
  if (options.sessionId && options.sessionTitle) sessionTitles.set(options.sessionId, options.sessionTitle);
  const sessionParents = new Map<string, string>();
  const sessionModels = new Map<string, string>();
  if (options.sessionId && options.model) sessionModels.set(options.sessionId, options.model);
  const hasTrailingNewline = /\r?\n$/.test(text);
  const lineOffset = options.lineOffset ?? 0;

  const lines = text.split(/\r?\n/);
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    if (!line.trim()) continue;
    let record: JsonRecord;
    try {
      const parsed: unknown = JSON.parse(line);
      if (!isRecord(parsed)) throw new Error('JSON 顶层不是对象');
      record = parsed;
    } catch (error) {
      const pendingTail = lineIndex === lines.length - 1 && !hasTrailingNewline;
      if (pendingTail) continue;
      errors.push({
        sourceFile,
        line: lineIndex + 1 + lineOffset,
        message: error instanceof Error ? error.message : '无法解析 JSON',
      });
      continue;
    }

    const type = recordType(record);
    provider = options.provider ?? (provider === 'unknown' ? normalizeProvider(record, sourceFile) : provider);
    const sessionId = options.sessionId ?? findSessionId(record, latestSession);
    latestSession = sessionId;
    const parentSessionId = findParentSessionId(record);
    const actorId = findActorId(record, sessionId);
    const timestamp = findTimestamp(record);
    const sourceTitle = findSessionTitle(record);
    const sourceCwd = stringValue(record.cwd, payloadOf(record).cwd);
    if (sourceCwd) sessionDirectories.set(sessionId, sourceCwd);
    const discoveredModel = findModel(record);
    if (discoveredModel) sessionModels.set(sessionId, discoveredModel);
    const model = discoveredModel ?? sessionModels.get(sessionId);
    if (sourceTitle) sessionTitles.set(sessionId, sourceTitle);
    if (parentSessionId) sessionParents.set(sessionId, parentSessionId);
    const resolvedParent = parentSessionId ?? sessionParents.get(sessionId);
    const base = {
      provider,
      sourceFile,
      sourceLine: lineIndex + 1 + lineOffset,
      timestamp,
      sessionId,
      parentSessionId: resolvedParent,
      actorId,
      sessionTitle: sourceTitle ?? sessionTitles.get(sessionId),
      cwd: sourceCwd ?? sessionDirectories.get(sessionId),
    };
    const payload = payloadOf(record);
    const message = nestedRecord(record, 'message');
    for (const [index, contextSnapshot] of extractContextSnapshots(record).entries()) {
      events.push(makeEvent({ id: sourceFile + ':context:' + String(lineIndex + 1 + lineOffset) + ':' + index, ...base }, {
        kind: 'context', contextSnapshot, rawType: type,
      }));
    }
    const payloadMessage = nestedRecord(payload, 'message');
    const callId = stringValue(
      record.call_id,
      record.callId,
      record.request_id,
      record.requestId,
      message?.id,
      payload.call_id,
      payload.callId,
      payload.id,
    );
    const explicitUser =
      type === 'user' ||
      type === 'human' ||
      type.includes('user_message') ||
      type.includes('user_prompt') ||
      stringValue(message?.role, payload.role)?.toLowerCase() === 'user';
    const toolResultOnly = explicitUser && isToolResultOnly(record);
    if (explicitUser && !toolResultOnly) {
      latestUserRequest = callId ?? sourceFile + ':request:' + String(lineIndex + 1 + lineOffset);
      events.push(
        makeEvent(
          {
            id: sourceFile + ':user:' + String(lineIndex + 1 + lineOffset),
            ...base,
          },
          {
            kind: 'user',
            userRequestId: latestUserRequest,
            text: findText(record),
            rawType: type,
          },
        ),
      );
    }

    // Keep visible replies as content evidence, not as extra billable calls.
    const assistantText = (type === 'assistant' || type === 'agent_message' ||
      stringValue(record.role, message?.role, payload.role)?.toLowerCase() === 'assistant')
      ? boundedText(findText(record), 1200) : undefined;
    if (assistantText) {
      events.push(makeEvent({ id: sourceFile + ':assistant:' + String(lineIndex + 1 + lineOffset), ...base }, {
        kind: 'assistant', text: assistantText, userRequestId: latestUserRequest, rawType: type,
      }));
    }

    const compact =
      type.includes('compact') ||
      type.includes('compaction') ||
      type.includes('context_compaction') ||
      type.includes('compact_boundary');
    if (compact) {
      events.push(
        makeEvent(
          {
            id: sourceFile + ':compaction:' + String(lineIndex + 1 + lineOffset),
            ...base,
          },
          {
            kind: 'compaction',
            userRequestId: latestUserRequest,
            text: findText(record),
            rawType: type,
          },
        ),
      );
    }

    const isResult =
      type.includes('result') ||
      type.includes('output') ||
      type.includes('tool_result') ||
      type.includes('function_call_output');
    const output = boundedText(textFromContent(
      record.output ?? payload.output ?? payload.result ?? record.result ?? findText(record),
    ), 512);
    const outputCallId = stringValue(
      record.tool_use_id,
      record.toolUseId,
      record.call_id,
      record.callId,
      payload.tool_use_id,
      payload.toolUseId,
      payload.call_id,
      payload.callId,
    );
    if (isResult && outputCallId && output !== undefined) {
      pendingOutputs.set(outputCallId, output);
      const existing = toolEvents.get(outputCallId);
      if (existing) {
        const nested = /"type"\s*:\s*"(function_call|tool_use)"/.test(output);
        existing.toolOutput = output;
        existing.contentHash = hashText(output);
        existing.stateHash = hashText(output.replace(/\s+/g, ' ').trim());
        existing.complete = !record.partial && !payload.partial;
        if (existing.kind === 'wait') existing.pureWait = !nested;
      }
    }

    const toolUses: Array<{ id?: string; name?: string; input: JsonRecord }> = [];
    const possibleToolContainers = [
      payload,
      message,
      payloadMessage,
      isRecord(record.content) ? record.content : undefined,
    ];
    for (const container of possibleToolContainers) {
      if (!container) continue;
      const content = container.content;
      if (Array.isArray(content)) {
        for (const item of content) {
          if (!isRecord(item)) continue;
          const itemType = stringValue(item.type)?.toLowerCase();
          if (itemType === 'tool_use' || itemType === 'function_call' || itemType === 'tool') {
            toolUses.push({
              id: stringValue(item.id, item.call_id, item.callId),
              name: stringValue(item.name, item.tool_name, item.toolName),
              input: extractArguments(item.input ?? item.arguments),
            });
          }
          if (itemType === 'tool_result' || itemType === 'function_call_output') {
            const itemId = stringValue(item.tool_use_id, item.toolUseId, item.call_id, item.callId);
            const itemOutput = boundedText(textFromContent(item.content ?? item.output), 512);
            if (itemId && itemOutput) pendingOutputs.set(itemId, itemOutput);
          }
        }
      }
      const directName = stringValue(container.name, container.tool_name, container.toolName);
      const directArguments = container.arguments ?? container.input;
      if (directName || directArguments) {
        toolUses.push({
          id: stringValue(container.call_id, container.callId, container.id),
          name: directName,
          input: extractArguments(directArguments),
        });
      }
    }
    if (type.includes('function_call') && (payload.name || payload.arguments)) {
      toolUses.push({
        id: stringValue(payload.call_id, payload.callId, payload.id),
        name: stringValue(payload.name, payload.tool_name, payload.toolName),
        input: extractArguments(payload.arguments ?? payload.input),
      });
    }
    const uniqueToolUses = [...new Map(
      toolUses.map((toolUse) => [
        toolUse.id ?? (toolUse.name ?? 'unknown') + '|' + JSON.stringify(toolUse.input),
        toolUse,
      ]),
    ).values()];
    const toolsThisLine: AnalysisEvent[] = [];
    for (const toolUse of uniqueToolUses) {
      const detail = toolDetails(toolUse.name, toolUse.input);
      const knownOutput = toolUse.id ? pendingOutputs.get(toolUse.id) : undefined;
      const enriched = knownOutput ? toolDetails(toolUse.name, toolUse.input, knownOutput) : detail;
      const lowerName = (toolUse.name ?? '').toLowerCase();
      const waiting = isWaitTool(toolUse.name);
      const eventId = sourceFile + ':tool:' + String(lineIndex + 1 + lineOffset) + ':' + (toolUse.id ?? lowerName);
      const toolEvent = makeEvent(
        {
          id: eventId,
          ...base,
        },
        {
          kind: waiting ? 'wait' : 'tool',
          callId: toolUse.id,
          userRequestId: latestUserRequest,
          toolName: toolUse.name ?? 'unknown',
          toolInput: boundedText(rawToolInput(toolUse.input) ?? JSON.stringify(toolUse.input), 320),
          toolOutput: boundedText(knownOutput, 256),
          ...enriched,
          behavior: waiting ? 'wait' : isReadTool(toolUse.name, toolUse.input) ? 'read' : classifyTool(toolUse.name, toolUse.input),
          rawType: type,
          complete: knownOutput !== undefined,
        },
      );
      events.push(toolEvent);
      toolsThisLine.push(toolEvent);
      if (toolUse.id) toolEvents.set(toolUse.id, toolEvent);
    }

    const isTokenSnapshot =
      type.includes('token_count') ||
      type.includes('token-count') ||
      type.includes('usage_snapshot') ||
      type.includes('usage-snapshot');
    const snapshot = isTokenSnapshot ? tokenSnapshotUsage(record) : { usage: findUsage(record), cumulative: false };
    const usage = snapshot.usage;
    const isResultSummary = type === 'result' || type === 'final_result';
    if (usage && !(isResultSummary && seenUsageSessions.has(provider + ':' + sessionId))) {
      if (isTokenSnapshot) usage.cumulative = snapshot.cumulative;
      usage.inputIncludesCached = provider === 'codex';
      const usageId = callId ?? sourceFile + ':model:' + String(lineIndex + 1 + lineOffset);
      events.push(
        makeEvent(
          {
            id: usageId,
            ...base,
          },
          {
            kind: 'model',
            callId: usageId,
            userRequestId: latestUserRequest,
            model,
            usage,
            text: assistantText,
            scope: isTokenSnapshot ? 'tree' : 'call',
            behavior: classifyModelBehavior(toolUses),
            rawType: type,
          },
        ),
      );
      for (const toolEvent of toolsThisLine) toolEvent.modelCallId = usageId;
      seenUsageSessions.add(provider + ':' + sessionId);
    }

    if (isResultSummary) {
      const reportedCost = numberValue(record.total_cost_usd, record.totalCostUsd, payload.total_cost_usd);
      if (reportedCost !== undefined) {
        events.push(
          makeEvent(
            {
              id: sourceFile + ':summary:' + String(lineIndex + 1 + lineOffset),
              ...base,
            },
            {
              kind: 'model',
              callId: sourceFile + ':summary:' + String(lineIndex + 1 + lineOffset),
              userRequestId: latestUserRequest,
              model,
              reportedCostUsd: reportedCost,
              scope: 'summary',
              behavior: 'unknown',
              rawType: type,
            },
          ),
        );
      }
    }
  }

  for (const event of events) {
    if (!event.sessionTitle) event.sessionTitle = sessionTitles.get(event.sessionId);
    if (!event.cwd) event.cwd = sessionDirectories.get(event.sessionId);
    if (!event.parentSessionId) event.parentSessionId = sessionParents.get(event.sessionId);
    if (!event.model) event.model = sessionModels.get(event.sessionId);
    if (!event.callId) continue;
    const output = pendingOutputs.get(event.callId);
    if (output && (event.kind === 'tool' || event.kind === 'wait')) {
      const nested = /"type"\s*:\s*"(function_call|tool_use)"/.test(output);
      event.toolOutput = output;
      event.contentHash = hashText(output);
      event.stateHash = hashText(output.replace(/\s+/g, ' ').trim());
      event.complete = true;
      if (event.kind === 'wait') event.pureWait = !nested;
    }
  }
  events.sort(compareEvents);
  return {
    events,
    errors,
    provider,
    sourceFile,
    lineCount: lines.length,
  };
}

function compareEvents(left: AnalysisEvent, right: AnalysisEvent): number {
  const leftTime = left.timestamp ? Date.parse(left.timestamp) : Number.NaN;
  const rightTime = right.timestamp ? Date.parse(right.timestamp) : Number.NaN;
  if (Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime !== rightTime) {
    return leftTime - rightTime;
  }
  return left.sourceLine - right.sourceLine;
}

function isWaitTool(name?: string): boolean {
  const value = (name ?? '').toLowerCase();
  return (
    /(^|[-_ ])(wait|poll)([-_ ]|$)/.test(value) ||
    value.includes('wait_for') ||
    value.includes('get_task_status') ||
    value.includes('check_task')
  );
}

function isReadTool(name?: string, input?: JsonRecord): boolean {
  const value = (name ?? '').toLowerCase();
  return (
    value === 'read' ||
    value === 'read_file' ||
    value === 'readfile' ||
    value === 'cat' ||
    value === 'sed' ||
    value === 'head' ||
    value === 'tail' ||
    value === 'rg' ||
    value === 'grep' ||
    (value === 'exec' && Boolean(input && shellReadTool(input)))
  );
}

function classifyTool(name?: string, input?: JsonRecord): Behavior {
  const value = (name ?? '').toLowerCase();
  if (isReadTool(value, input)) return 'read';
  if (
    value === 'task' ||
    value === 'task_agent' ||
    /agent|spawn|fork|delegate|collab|subagent/.test(value)
  ) {
    return 'subagent';
  }
  if (/write|edit|patch|exec|shell|command|bash|terminal|apply/.test(value)) return 'code';
  if (/plan|think|reason/.test(value)) return 'planning';
  if (isWaitTool(value)) return 'wait';
  return 'other';
}

function classifyModelBehavior(
  tools: Array<{ id?: string; name?: string; input: JsonRecord; behavior?: Behavior }>,
): Behavior {
  const behaviors = new Set(
    tools.map((item) =>
      item.behavior && item.behavior !== 'unknown'
        ? item.behavior
        : classifyTool(item.name, item.input),
    ),
  );
  behaviors.delete('other');
  if (behaviors.size === 1) return [...behaviors][0];
  if (behaviors.size > 1) return 'mixed';
  return 'unknown';
}

function isMeaningfulUsage(usage?: Usage): boolean {
  if (!usage) return false;
  return (
    usage.inputTokens > 0 ||
    (usage.cachedInputTokens ?? 0) > 0 ||
    (usage.cacheCreationInputTokens ?? 0) > 0 ||
    usage.outputTokens > 0 ||
    (usage.reasoningTokens ?? 0) > 0
  );
}

function usageVector(usage: Usage): [number, number, number, number, number] {
  return [
    usage.inputTokens,
    usage.cachedInputTokens ?? 0,
    usage.cacheCreationInputTokens ?? 0,
    usage.outputTokens,
    usage.reasoningTokens ?? 0,
  ];
}

function subtractUsage(current: Usage, previous: Usage): Usage {
  const currentVector = usageVector(current);
  const previousVector = usageVector(previous);
  const delta = currentVector.map((value, index) => Math.max(0, value - previousVector[index]));
  return {
    inputTokens: delta[0],
    cachedInputTokens: delta[1],
    cacheCreationInputTokens: delta[2],
    outputTokens: delta[3],
    reasoningTokens: delta[4],
    inputIncludesCached: current.inputIncludesCached,
    outputIncludesReasoning: current.outputIncludesReasoning,
  };
}

function sameVector(left: Usage, right: Usage): boolean {
  return usageVector(left).every((value, index) => value === usageVector(right)[index]);
}

function eventFingerprint(event: AnalysisEvent): string {
  if (event.kind === 'model' && event.scope === 'summary') {
    // A result summary is scoped to the session, not to the generated source
    // line id. This prevents copying the same final total into another export
    // from adding it twice.
    return [event.provider, event.sessionId, event.kind, event.scope].join('|');
  }
  const generatedModelId = event.sourceFile + ':model:';
  const explicitCallId = event.callId && !event.callId.startsWith(generatedModelId)
    ? event.callId
    : undefined;
  if (explicitCallId) {
    if (event.kind === 'model') {
      return [event.provider, event.sessionId, event.kind, explicitCallId].join('|');
    }
    return [
      event.provider,
      event.sessionId,
      event.kind,
      explicitCallId,
      event.timestamp,
      event.toolName ?? '',
      event.filePath ?? '',
      event.fileRange ?? '',
      event.contentHash ?? '',
      event.target ?? '',
      event.stateHash ?? '',
    ].join('|');
  }
  return [
    event.provider,
    event.sessionId,
    event.actorId,
    event.kind,
    event.timestamp,
    event.model ?? '',
    event.usage ? usageVector(event.usage).join(',') : '',
    event.scope ?? '',
    event.toolName ?? '',
    event.filePath ?? '',
    event.fileRange ?? '',
    event.contentHash ?? '',
    event.target ?? '',
    event.stateHash ?? '',
    event.text ?? '',
    event.contextSnapshot ? event.contextSnapshot.category + ':' + event.contextSnapshot.fingerprint : '',
  ].join('|');
}

function dedupeAndDelta(events: AnalysisEvent[]): AnalysisEvent[] {
  const seenIds = new Set<string>();
  const seenFingerprints = new Map<string, AnalysisEvent>();
  const seenSnapshots = new Map<string, Usage>();
  const result: AnalysisEvent[] = [];
  for (const original of [...events].sort(compareEvents)) {
    if (seenIds.has(original.id)) continue;
    const event = { ...original, usage: original.usage ? { ...original.usage } : undefined };
    const fingerprint = eventFingerprint(event);
    const duplicate = seenFingerprints.get(fingerprint);
    if (duplicate) {
      // A split export may contain a tool call in one file and its richer
      // output in another. Keep the first position but merge the evidence.
      if (duplicate.kind === 'tool' || duplicate.kind === 'wait') {
        if (!duplicate.complete && event.complete) Object.assign(duplicate, event);
        if (!duplicate.toolOutput && event.toolOutput) duplicate.toolOutput = event.toolOutput;
        if (!duplicate.contentHash && event.contentHash) duplicate.contentHash = event.contentHash;
        if (!duplicate.stateHash && event.stateHash) duplicate.stateHash = event.stateHash;
      }
      seenIds.add(original.id);
      continue;
    }
    seenIds.add(original.id);
    seenFingerprints.set(fingerprint, event);
    if (event.kind === 'model' && event.scope === 'tree' && event.usage?.cumulative) {
      const key = [
        event.provider,
        event.sessionId,
        event.actorId,
        event.model ?? 'unknown',
        event.scope,
      ].join('|');
      const cumulative = { ...event.usage };
      const previous = seenSnapshots.get(key);
      if (previous && sameVector(previous, cumulative)) continue;
      if (previous) event.usage = subtractUsage(cumulative, previous);
      seenSnapshots.set(key, cumulative);
      if (!isMeaningfulUsage(event.usage)) continue;
    }
    if (event.kind === 'model' && event.scope === 'summary') {
      const hasCallUsage = events.some(
        (candidate) =>
          candidate !== original &&
          candidate.kind === 'model' &&
          candidate.scope === 'call' &&
          candidate.sessionId === event.sessionId &&
          isMeaningfulUsage(candidate.usage),
      );
      if (hasCallUsage && event.reportedCostUsd === undefined) continue;
    }
    result.push(event);
  }
  return result;
}

function emptyUsage(): UsageSummary {
  return {
    inputTokens: 0,
    cachedInputTokens: 0,
    cacheCreationInputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    totalTokens: 0,
  };
}

/**
 * Returns the additive Token count for one usage record while respecting
 * provider semantics. Codex input snapshots can already include cached input;
 * Claude style records usually report cached input separately.
 */
export function usageTokenCount(usage?: Usage): number {
  if (!usage) return 0;
  const cached = usage.cachedInputTokens ?? 0;
  const cacheCreation = usage.cacheCreationInputTokens ?? 0;
  const input = usage.inputIncludesCached ? usage.inputTokens : usage.inputTokens + cached;
  const reasoning = usage.outputIncludesReasoning ? 0 : (usage.reasoningTokens ?? 0);
  return input + cacheCreation + usage.outputTokens + reasoning;
}

function addUsage(target: UsageSummary, usage?: Usage): UsageSummary {
  if (!usage) return target;
  const cached = usage.cachedInputTokens ?? 0;
  const cacheCreation = usage.cacheCreationInputTokens ?? 0;
  const reasoning = usage.reasoningTokens ?? 0;
  target.inputTokens += usage.inputTokens;
  target.cachedInputTokens += cached;
  target.cacheCreationInputTokens += cacheCreation;
  target.outputTokens += usage.outputTokens;
  target.reasoningTokens += reasoning;
  target.totalTokens += usageTokenCount(usage);
  return target;
}

function combineUsage(...summaries: UsageSummary[]): UsageSummary {
  const result = emptyUsage();
  for (const summary of summaries) {
    result.inputTokens += summary.inputTokens;
    result.cachedInputTokens += summary.cachedInputTokens;
    result.cacheCreationInputTokens += summary.cacheCreationInputTokens;
    result.outputTokens += summary.outputTokens;
    result.reasoningTokens += summary.reasoningTokens;
    result.totalTokens += summary.totalTokens;
  }
  return result;
}

function matchRate(call: AnalysisEvent, rates: RateSnapshot[]): RateSnapshot | undefined {
  const model = (call.model ?? '').toLowerCase();
  const scored = rates
    .map((rate) => {
      if (rate.provider !== call.provider && rate.provider !== 'unknown') return { rate, score: 0 };
      const pattern = rate.modelPattern.toLowerCase();
      let score = 0;
      if (pattern === '*') score = 1;
      else if (model === pattern) score = pattern.length + 100;
      else if (pattern.endsWith('*') && model.startsWith(pattern.slice(0, -1))) {
        score = pattern.length + 50;
      } else if (model.startsWith(pattern)) score = pattern.length + 40;
      else if (model.includes(pattern)) score = pattern.length + 10;
      return { rate, score };
    })
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score);
  const matches = scored.map((item) => item.rate);
  if (!matches.length) return undefined;
  // A custom snapshot may only define USD or credits. Fill its missing unit
  // from a later official/demo match without overriding the user's values.
  const numericFields = [
    'inputCreditsPerMillion',
    'cachedInputCreditsPerMillion',
    'cacheCreationCreditsPerMillion',
    'outputCreditsPerMillion',
    'inputUsdPerMillion',
    'cachedInputUsdPerMillion',
    'cacheCreationUsdPerMillion',
    'outputUsdPerMillion',
  ] as const;
  return matches.slice(1).reduce((merged, candidate) => {
    const next = { ...merged };
    for (const field of numericFields) {
      if (next[field] === undefined && candidate[field] !== undefined) {
        next[field] = candidate[field];
      }
    }
    return next;
  }, matches[0]);
}

function calculateCost(
  calls: AnalysisEvent[],
  rates: RateSnapshot[],
  reportedSummaries: AnalysisEvent[] = [],
): CostSummary {
  const breakdown: CostBreakdown = {
    inputTokens: 0,
    cachedInputTokens: 0,
    cacheCreationInputTokens: 0,
    outputTokens: 0,
  };
  let creditsKnownAmount = 0;
  let usdKnownAmount = 0;
  let creditsKnownCalls = 0;
  let usdKnownCalls = 0;
  let creditsKnown = true;
  let usdKnown = true;
  let knownCalls = 0;
  let unknownCalls = 0;
  const basis = new Set<string>();
  for (const call of calls) {
    if (!call.usage || !isMeaningfulUsage(call.usage)) {
      if (call.reportedCostUsd !== undefined && Number.isFinite(call.reportedCostUsd)) {
        usdKnownAmount += call.reportedCostUsd;
        usdKnownCalls += 1;
        knownCalls += 1;
        creditsKnown = false;
        basis.add('来源记录的 total_cost_usd（估算）');
      }
      continue;
    }
    const usage = call.usage;
    const cached = usage.cachedInputTokens ?? 0;
    const cacheCreation = usage.cacheCreationInputTokens ?? 0;
    breakdown.inputTokens += usage.inputTokens;
    breakdown.cachedInputTokens += cached;
    breakdown.cacheCreationInputTokens += cacheCreation;
    breakdown.outputTokens += usage.outputTokens + (usage.outputIncludesReasoning ? 0 : (usage.reasoningTokens ?? 0));
    const rate = matchRate(call, rates);
    if (!rate) {
      unknownCalls += 1;
      creditsKnown = false;
      usdKnown = false;
      continue;
    }
    basis.add(rate.source + ' · ' + rate.checkedDate);
    const billableInput = usage.inputIncludesCached
      ? Math.max(usage.inputTokens - cached, 0)
      : usage.inputTokens;
    const creditInput =
      billableInput * (rate.inputCreditsPerMillion ?? 0) / MILLION +
      cached * (rate.cachedInputCreditsPerMillion ?? 0) / MILLION +
      cacheCreation * (rate.cacheCreationCreditsPerMillion ?? rate.cachedInputCreditsPerMillion ?? 0) / MILLION;
    const usdInput =
      billableInput * (rate.inputUsdPerMillion ?? 0) / MILLION +
      cached * (rate.cachedInputUsdPerMillion ?? 0) / MILLION +
      cacheCreation * (rate.cacheCreationUsdPerMillion ?? rate.cachedInputUsdPerMillion ?? 0) / MILLION;
    const output = usage.outputTokens + (usage.outputIncludesReasoning ? 0 : (usage.reasoningTokens ?? 0));
    const creditOutput = output * (rate.outputCreditsPerMillion ?? 0) / MILLION;
    const usdOutput = output * (rate.outputUsdPerMillion ?? 0) / MILLION;
    const creditCallKnown = !(
      (billableInput > 0 && rate.inputCreditsPerMillion === undefined) ||
      (cached > 0 && rate.cachedInputCreditsPerMillion === undefined) ||
      (cacheCreation > 0 &&
        rate.cacheCreationCreditsPerMillion === undefined &&
        rate.cachedInputCreditsPerMillion === undefined) ||
      (output > 0 && rate.outputCreditsPerMillion === undefined)
    );
    if (!creditCallKnown) {
      creditsKnown = false;
    }
    const usdCallKnown = !(
      (billableInput > 0 && rate.inputUsdPerMillion === undefined) ||
      (cached > 0 && rate.cachedInputUsdPerMillion === undefined) ||
      (cacheCreation > 0 &&
        rate.cacheCreationUsdPerMillion === undefined &&
        rate.cachedInputUsdPerMillion === undefined) ||
      (output > 0 && rate.outputUsdPerMillion === undefined)
    );
    if (!usdCallKnown) {
      usdKnown = false;
    }
    if (creditCallKnown) {
      creditsKnownAmount += creditInput + creditOutput;
      creditsKnownCalls += 1;
    }
    if (usdCallKnown) {
      usdKnownAmount += usdInput + usdOutput;
      usdKnownCalls += 1;
    }
    knownCalls += 1;
  }
  // A provider result can expose a trustworthy session-level USD total while
  // omitting per-call prices. Keep it as a clearly labelled estimate only when
  // no per-call USD amount is known; never add it on top of a priced subtotal.
  if (usdKnownCalls === 0) {
    const reported = reportedSummaries
      .map((summary) => summary.reportedCostUsd)
      .filter((value): value is number => value !== undefined && Number.isFinite(value));
    if (reported.length) {
      usdKnownAmount = reported.reduce((sum, value) => sum + value, 0);
      usdKnownCalls = 1;
      knownCalls += 1;
      creditsKnown = false;
      usdKnown = false;
      basis.add('来源记录的 total_cost_usd（估算）');
    }
  }
  const hasKnownAmount = creditsKnownCalls > 0 || usdKnownCalls > 0;
  if (knownCalls === 0 && unknownCalls === 0) {
    return {
      credits: 0,
      usd: 0,
      complete: true,
      hasKnownAmount: false,
      basis: '没有可计价调用',
      knownCalls: 0,
      unknownCalls: 0,
      breakdown,
    };
  }
  return {
    credits: creditsKnownCalls > 0 ? creditsKnownAmount : undefined,
    usd: usdKnownCalls > 0 ? usdKnownAmount : undefined,
    complete: unknownCalls === 0 && creditsKnown && usdKnown,
    hasKnownAmount,
    basis: basis.size ? [...basis].join('；') : '暂无适用费率',
    knownCalls,
    unknownCalls,
    breakdown,
  };
}

interface CallIndex {
  bySession: Map<string, AnalysisEvent[]>;
  byActor: Map<string, AnalysisEvent[]>;
}

const callIndexCache = new WeakMap<AnalysisEvent[], CallIndex>();

function callIndexFor(calls: AnalysisEvent[]): CallIndex {
  const cached = callIndexCache.get(calls);
  if (cached) return cached;
  const bySession = new Map<string, AnalysisEvent[]>();
  const byActor = new Map<string, AnalysisEvent[]>();
  for (const call of calls) {
    const session = bySession.get(call.sessionId) ?? [];
    session.push(call);
    bySession.set(call.sessionId, session);
    const actor = byActor.get(call.actorId) ?? [];
    actor.push(call);
    byActor.set(call.actorId, actor);
  }
  for (const bucket of [...bySession.values(), ...byActor.values()]) bucket.sort(compareEvents);
  const index = { bySession, byActor };
  callIndexCache.set(calls, index);
  return index;
}

function nearestFromBucket(event: AnalysisEvent, bucket: AnalysisEvent[]): AnalysisEvent | undefined {
  if (!bucket.length) return undefined;
  let low = 0;
  let high = bucket.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (compareEvents(bucket[middle], event) < 0) low = middle + 1;
    else high = middle;
  }
  const candidates = [bucket[low - 1], bucket[low]].filter(
    (item): item is AnalysisEvent => Boolean(item),
  );
  return candidates.reduce<AnalysisEvent | undefined>((nearest, candidate) => {
    if (!nearest || timestampDistance(candidate, event) < timestampDistance(nearest, event)) return candidate;
    return nearest;
  }, undefined);
}

function nearestCallId(event: AnalysisEvent, calls: AnalysisEvent[]): string | undefined {
  const index = callIndexFor(calls);
  const candidates = new Map<string, AnalysisEvent>();
  for (const bucket of [index.bySession.get(event.sessionId), index.byActor.get(event.actorId)]) {
    const nearest = bucket ? nearestFromBucket(event, bucket) : undefined;
    if (nearest) candidates.set(nearest.id, nearest);
  }
  return [...candidates.values()].reduce<AnalysisEvent | undefined>((nearest, candidate) => {
    if (!nearest || timestampDistance(candidate, event) < timestampDistance(nearest, event)) return candidate;
    return nearest;
  }, undefined)?.id;
}

function eventCallId(event: AnalysisEvent, calls: AnalysisEvent[]): string | undefined {
  if (event.kind === 'model') return event.id;
  return event.modelCallId ?? nearestCallId(event, calls);
}

function assignModelCallIds(events: AnalysisEvent[]): void {
  const calls = events.filter((event) => event.kind === 'model' && event.scope !== 'summary');
  for (const event of events) {
    if (event.kind === 'model' || event.modelCallId) continue;
    if (event.kind === 'tool' || event.kind === 'wait' || event.kind === 'compaction') {
      event.modelCallId = nearestCallId(event, calls);
    }
  }
  const toolsByCall = new Map<string, AnalysisEvent[]>();
  for (const event of events) {
    if (!event.modelCallId || (event.kind !== 'tool' && event.kind !== 'wait')) continue;
    const group = toolsByCall.get(event.modelCallId) ?? [];
    group.push(event);
    toolsByCall.set(event.modelCallId, group);
  }
  for (const call of calls) {
    const tools = toolsByCall.get(call.id);
    if (!tools?.length) continue;
    if (call.behavior && call.behavior !== 'unknown') continue;
    call.behavior = classifyModelBehavior(
      tools.map((item) => ({
        id: item.callId,
        name: item.toolName,
        input: extractArguments(item.toolInput),
        behavior: item.behavior,
      })),
    );
  }
}

function evidenceForEvent(event: AnalysisEvent, label: string, detail: string): Evidence {
  return {
    label,
    detail,
    sourceFile: event.sourceFile,
    sourceLine: event.sourceLine,
    eventId: event.id,
  };
}

function timestampDistance(left: AnalysisEvent, right: AnalysisEvent): number {
  const leftTime = Date.parse(left.timestamp);
  const rightTime = Date.parse(right.timestamp);
  if (Number.isFinite(leftTime) && Number.isFinite(rightTime)) return Math.abs(leftTime - rightTime);
  return Math.abs(left.sourceLine - right.sourceLine) * 1000;
}

function readEvents(events: AnalysisEvent[]): AnalysisEvent[] {
  return events.filter(
    (event) =>
      event.kind === 'tool' &&
      (event.behavior === 'read' || isReadTool(event.toolName)) &&
      Boolean(event.filePath),
  );
}

function isReadPhaseBoundary(event: AnalysisEvent): boolean {
  if (event.kind === 'user' || event.kind === 'compaction') return true;
  if (event.kind !== 'tool') return false;
  if (event.behavior === 'code') return true;
  return /write|edit|patch|replace|delete|mkdir|move|rename/.test((event.toolName ?? '').toLowerCase());
}

function detectRereads(events: AnalysisEvent[], calls: AnalysisEvent[]): Anomaly[] {
  const groups = new Map<string, AnalysisEvent[]>();
  const phases = new Map<string, number>();
  for (const event of [...events].sort(compareEvents)) {
    if (isReadPhaseBoundary(event)) {
      phases.set(event.actorId, (phases.get(event.actorId) ?? 0) + 1);
      continue;
    }
    if (event.kind !== 'tool' || !event.filePath || (event.behavior !== 'read' && !isReadTool(event.toolName))) continue;
    const content = event.contentHash ?? 'unknown-content';
    const range = event.fileRange ?? 'unknown-range';
    const key = [event.actorId, phases.get(event.actorId) ?? 0, event.filePath, range, content].join('|');
    const group = groups.get(key) ?? [];
    group.push(event);
    groups.set(key, group);
  }
  const anomalies: Anomaly[] = [];
  for (const [key, group] of groups) {
    const ordered = [...group].sort(compareEvents);
    for (let start = 0; start < ordered.length; start += 1) {
      const window = ordered.filter(
        (item) => timestampDistance(item, ordered[start]) <= 5 * 60 * 1000 && compareEvents(item, ordered[start]) >= 0,
      );
      if (window.length < 3) continue;
      const exact = !key.endsWith('|unknown-content') && !key.includes('|unknown-range|');
      const callIds = [...new Set(window.map((item) => eventCallId(item, calls)).filter(Boolean))] as string[];
      const mixed = callIds.some((id) => calls.find((call) => call.id === id)?.behavior === 'mixed');
      const baselineCallIds = callIds.length ? [callIds[0]] : [];
      const candidateCallIds = callIds.slice(1);
      const first = window[0];
      const last = window[window.length - 1];
      anomalies.push({
        id: 'reread:' + first.id,
        type: 'reread',
        title: '疑似重复读取',
        description: exact
          ? '同一执行主体在 5 分钟内读取了相同文件、范围和内容至少 3 次。'
          : '同一路径与范围出现重复读取，但内容或范围证据不完整。',
        confidence: exact ? 'high' : 'low',
        actorId: first.actorId,
        sessionId: first.sessionId,
        startedAt: first.timestamp,
        endedAt: last.timestamp,
        callIds,
        candidateCallIds,
        baselineCallIds,
        mixed,
        recommendation: '如果内容和范围稳定，可在同一上下文复用已读结果或建立索引；是否合并由你根据任务需要决定。',
        evidence: window.map((item, index) =>
          evidenceForEvent(
            item,
            index === 0 ? '基线读取' : '重复读取 ' + String(index),
            (item.filePath ?? '未知文件') + ' · ' + (item.fileRange ?? '范围未知') + ' · ' + (item.contentHash ?? '内容未知'),
          ),
        ),
      });
      break;
    }
  }
  return dedupeAnomalies(anomalies);
}

function detectPolls(events: AnalysisEvent[], calls: AnalysisEvent[]): Anomaly[] {
  const groups = new Map<string, AnalysisEvent[]>();
  for (const event of events) {
    if (event.kind !== 'wait' || !event.pureWait || !event.target) continue;
    const key = event.actorId + '|' + event.target;
    const group = groups.get(key) ?? [];
    group.push(event);
    groups.set(key, group);
  }
  const anomalies: Anomaly[] = [];
  for (const group of groups.values()) {
    const ordered = [...group].sort(compareEvents);
    for (let index = 0; index <= ordered.length - 3; index += 1) {
      const window = ordered.slice(index, index + 3);
      if (
        timestampDistance(window[0], window[1]) > 60 * 1000 ||
        timestampDistance(window[1], window[2]) > 60 * 1000
      ) {
        continue;
      }
      const states = window.map((item) => item.stateHash).filter(Boolean);
      if (states.length !== 3 || new Set(states).size !== 1) continue;
      const callIds = [...new Set(window.map((item) => eventCallId(item, calls)).filter(Boolean))] as string[];
      const mixed = callIds.some((id) => calls.find((call) => call.id === id)?.behavior === 'mixed');
      const hasUsage = calls.some(
        (call) =>
          call.usage &&
          isMeaningfulUsage(call.usage) &&
          window.some(
            (wait) =>
              call.id === wait.modelCallId ||
              call.id === wait.callId ||
              timestampDistance(call, wait) <= 1000,
          ),
      );
      if (!hasUsage) continue;
      const first = window[0];
      const last = window[2];
      anomalies.push({
        id: 'poll:' + first.id,
        type: 'poll',
        title: '疑似轮询空转',
        description: '同一目标连续查询但没有新的输出或状态变化，同时产生了新增模型用量。',
        confidence: 'high',
        actorId: first.actorId,
        sessionId: first.sessionId,
        startedAt: first.timestamp,
        endedAt: last.timestamp,
        callIds,
        candidateCallIds: callIds.slice(1),
        baselineCallIds: callIds.length ? [callIds[0]] : [],
        mixed,
        recommendation: '优先使用事件或回调；必须轮询时可适当拉长间隔，并先确认目标确实需要实时查询。',
        evidence: window.map((item, itemIndex) =>
          evidenceForEvent(
            item,
            '轮询 ' + String(itemIndex + 1),
            (item.target ?? '未知目标') + ' · 间隔状态未变化 · 新增模型用量',
          ),
        ),
      });
      break;
    }
  }
  return anomalies;
}

function detectCompactionLoops(events: AnalysisEvent[], calls: AnalysisEvent[]): Anomaly[] {
  const compactions = events.filter((event) => event.kind === 'compaction');
  const reads = readEvents(events);
  const cycles: Array<{ compact: AnalysisEvent; read: AnalysisEvent }> = [];
  for (const compact of compactions) {
    const prior = reads.some(
      (read) =>
        read.actorId === compact.actorId &&
        compareEvents(read, compact) < 0 &&
        Boolean(read.contentHash && read.filePath),
    );
    if (!prior) continue;
    const candidates = reads
      .filter(
        (read) =>
          read.actorId === compact.actorId &&
          compareEvents(read, compact) > 0 &&
          timestampDistance(read, compact) <= 10 * 60 * 1000,
      )
      .sort(compareEvents);
    const priorFingerprints = new Set(
      reads
        .filter(
          (read) =>
            read.actorId === compact.actorId &&
            compareEvents(read, compact) < 0 &&
            read.filePath &&
            read.contentHash,
        )
        .map((read) => [read.filePath, read.fileRange ?? 'unknown-range', read.contentHash].join('|')),
    );
    const match = candidates.find((read) =>
      Boolean(
        read.contentHash &&
          read.filePath &&
          priorFingerprints.has([read.filePath, read.fileRange ?? 'unknown-range', read.contentHash].join('|')),
      ),
    );
    if (match) cycles.push({ compact, read: match });
  }
  const anomalies: Anomaly[] = [];
  const byActor = new Map<string, typeof cycles>();
  for (const cycle of cycles) {
    const key = [
      cycle.compact.actorId,
      cycle.read.filePath ?? '',
      cycle.read.fileRange ?? 'unknown-range',
      cycle.read.contentHash ?? '',
    ].join('|');
    const group = byActor.get(key) ?? [];
    group.push(cycle);
    byActor.set(key, group);
  }
  for (const group of byActor.values()) {
    const ordered = [...group].sort((left, right) => compareEvents(left.compact, right.compact));
    for (let index = 0; index <= ordered.length - 2; index += 1) {
      const window = ordered.slice(index, index + 2);
      if (timestampDistance(window[0].compact, window[1].compact) > 10 * 60 * 1000) continue;
      const sourceEvents = window.flatMap((item) => [item.compact, item.read]);
      const callIds = [
        ...new Set(sourceEvents.map((item) => eventCallId(item, calls)).filter(Boolean)),
      ] as string[];
      const mixed = callIds.some((id) => calls.find((call) => call.id === id)?.behavior === 'mixed');
      anomalies.push({
        id: 'compaction:' + window[0].compact.id,
        type: 'compaction',
        title: '疑似压缩循环',
        description: '在 10 分钟内重复出现上下文压缩后重读相同内容的可验证链。',
        confidence: 'high',
        actorId: window[0].compact.actorId,
        sessionId: window[0].compact.sessionId,
        startedAt: window[0].compact.timestamp,
        endedAt: window[1].read.timestamp,
        callIds,
        candidateCallIds: callIds.slice(1),
        baselineCallIds: callIds.length ? [callIds[0]] : [],
        mixed,
        recommendation: '在压缩前保留可定位的摘要或索引，恢复后只读缺失片段；先确认文件确实发生变化。',
        evidence: sourceEvents.map((item, itemIndex) =>
          evidenceForEvent(
            item,
            itemIndex % 2 === 0 ? '上下文压缩' : '压缩后重读',
            item.kind === 'compaction'
              ? '上下文阶段发生压缩'
              : (item.filePath ?? '未知文件') + ' · ' + (item.fileRange ?? '范围未知') + ' · 内容可比较',
          ),
        ),
      });
      break;
    }
  }
  return anomalies;
}

function dedupeAnomalies(anomalies: Anomaly[]): Anomaly[] {
  const seen = new Set<string>();
  return anomalies.filter((anomaly) => {
    const key = anomaly.type + '|' + anomaly.actorId + '|' + anomaly.callIds.join(',');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function scopedSessionKey(provider: Provider, sessionId: string): string {
  return provider + '\u0000' + sessionId;
}

function createSessions(calls: AnalysisEvent[], rates: RateSnapshot[]): AnalysisSession[] {
  const map = new Map<string, AnalysisSession>();
  for (const call of calls) {
    const key = scopedSessionKey(call.provider, call.sessionId);
    const current = map.get(key);
    if (current) {
      current.ownCalls.push(call);
      if (call.sessionTitle) current.title = call.sessionTitle;
      if (call.cwd) current.cwd = call.cwd;
      if (call.timestamp && (!current.lastDataAt || call.timestamp > current.lastDataAt)) {
        current.lastDataAt = call.timestamp;
      }
      continue;
    }
    map.set(key, {
      id: call.sessionId,
      provider: call.provider,
      title: call.sessionTitle ?? call.sessionId,
      cwd: call.cwd,
      parentSessionId: call.parentSessionId,
      childSessionIds: [],
      ownCalls: [call],
      ownUsage: emptyUsage(),
      ownCost: calculateCost([], rates),
      inclusiveUsage: emptyUsage(),
      inclusiveCost: calculateCost([], rates),
      completeness: 'complete',
      lastDataAt: call.timestamp || undefined,
    });
  }
  for (const session of map.values()) {
    session.ownUsage = session.ownCalls.reduce((summary, call) => addUsage(summary, call.usage), emptyUsage());
    session.ownCost = calculateCost(session.ownCalls, rates);
  }
  for (const session of map.values()) {
    const parentKey = session.parentSessionId
      ? scopedSessionKey(session.provider, session.parentSessionId)
      : undefined;
    if (parentKey && map.has(parentKey)) {
      map.get(parentKey)?.childSessionIds.push(session.id);
    } else if (session.parentSessionId) {
      // Keep an orphaned child visible, but mark the analysis partial instead
      // of inventing a parent node or silently dropping its usage.
      session.completeness = 'partial';
    }
  }
  const visiting = new Set<string>();
  const computed = new Set<string>();
  const inclusiveCalls = new Map<string, AnalysisEvent[]>();
  const computeInclusive = (session: AnalysisSession): AnalysisEvent[] => {
    const key = scopedSessionKey(session.provider, session.id);
    if (computed.has(key)) return inclusiveCalls.get(key) ?? session.ownCalls;
    if (visiting.has(key)) {
      session.completeness = 'partial';
      return session.ownCalls;
    }
    visiting.add(key);
    const children = session.childSessionIds
      .map((id) => map.get(scopedSessionKey(session.provider, id)))
      .filter((item): item is AnalysisSession => Boolean(item));
    const childCalls = children.map((child) => computeInclusive(child));
    session.inclusiveUsage = combineUsage(
      session.ownUsage,
      ...children.map((child) => child.inclusiveUsage),
    );
    const calls = [
      ...session.ownCalls,
      ...childCalls.flat(),
    ];
    session.inclusiveCost = calculateCost(calls, rates);
    visiting.delete(key);
    computed.add(key);
    inclusiveCalls.set(key, calls);
    return calls;
  };
  for (const session of map.values()) computeInclusive(session);
  return [...map.values()].sort((left, right) => {
    if (left.parentSessionId && !right.parentSessionId) return 1;
    if (!left.parentSessionId && right.parentSessionId) return -1;
    return left.id.localeCompare(right.id);
  });
}

function candidateCost(
  anomalies: Anomaly[],
  calls: AnalysisEvent[],
  rates: RateSnapshot[],
  necessaryCallIds: Set<string>,
): CostSummary {
  const byId = new Map(calls.map((call) => [call.id, call]));
  const ids = new Set<string>();
  for (const anomaly of anomalies) {
    // Only a complete, high-confidence pattern with separable behavior can
    // contribute to the candidate subtotal. Lower-confidence evidence stays
    // visible for review but must not look like a confirmed amount.
    if (anomaly.mixed || anomaly.confidence !== 'high') continue;
    for (const id of anomaly.candidateCallIds) {
      if (!necessaryCallIds.has(id)) ids.add(id);
    }
  }
  const selected = [...ids].map((id) => byId.get(id)).filter((item): item is AnalysisEvent => Boolean(item));
  return calculateCost(selected, rates);
}

function hasUnknownData(events: AnalysisEvent[], errors: ParseError[]): boolean {
  return (
    errors.length > 0 ||
    events.some(
      (event) =>
        event.kind === 'unknown' ||
        (event.kind === 'model' && !event.usage && event.reportedCostUsd === undefined) ||
        (event.kind === 'tool' && event.complete === false),
    )
  );
}

export function buildAnalysis(
  inputEvents: AnalysisEvent[],
  rates: RateSnapshot[] = defaultRateSnapshots,
  options: {
    mode?: 'demo' | 'history' | 'live';
    sourceLabel?: string;
    errors?: ParseError[];
    necessaryCallIds?: Set<string>;
  } = {},
): AnalysisResult {
  const events = dedupeAndDelta(inputEvents);
  assignModelCallIds(events);
  const calls = events.filter((event) => event.kind === 'model' && event.scope !== 'summary');
  const reportedSummaries = events.filter(
    (event) => event.kind === 'model' && event.scope === 'summary' && event.reportedCostUsd !== undefined,
  );
  const necessaryCallIds = new Set(options.necessaryCallIds ?? []);
  const anomalies = dedupeAnomalies([
    ...detectRereads(events, calls),
    ...detectPolls(events, calls),
    ...detectCompactionLoops(events, calls),
  ]);
  const sessions = createSessions(calls, rates);
  const usage = calls.reduce((summary, call) => addUsage(summary, call.usage), emptyUsage());
  const cost = calculateCost(calls, rates, reportedSummaries);
  const result: AnalysisResult = {
    mode: options.mode ?? 'history',
    sourceLabel: options.sourceLabel ?? '本地日志',
    events,
    calls,
    sessions,
    anomalies,
    usage,
    cost,
    candidateCost: calculateCost([], rates),
    necessaryCallIds,
    lastDataAt: events
      .map((event) => event.timestamp)
      .filter(Boolean)
      .sort()
      .at(-1),
    errors: options.errors ?? [],
    rates,
    completeness: hasUnknownData(events, options.errors ?? []) ? 'partial' : 'complete',
  };
  result.candidateCost = candidateCost(anomalies, calls, rates, necessaryCallIds);
  for (const anomaly of result.anomalies) {
    anomaly.necessary = anomaly.candidateCallIds.length > 0 &&
      anomaly.candidateCallIds.every((id) => necessaryCallIds.has(id));
    const associated = anomaly.callIds
      .map((id) => calls.find((call) => call.id === id))
      .filter((item): item is AnalysisEvent => Boolean(item));
    anomaly.associatedCost = calculateCost(associated, rates);
  }
  return result;
}

/** Scope normalized usage, never raw cumulative snapshots. Keep historical evidence
 * for anomaly detection, but charge only calls inside the selected window. */
export function scopeAnalysis(
  analysis: AnalysisResult,
  options: { since?: number; until?: number; provider?: Provider } = {},
): AnalysisResult {
  const hasWindow = options.since !== undefined || options.until !== undefined;
  if (!hasWindow && !options.provider) return analysis;
  const matches = (event: AnalysisEvent) => {
    if (options.provider && event.provider !== options.provider) return false;
    if (!hasWindow) return true;
    const time = Date.parse(event.timestamp);
    return Number.isFinite(time) && time >= (options.since ?? -Infinity) && time <= (options.until ?? Infinity);
  };
  const calls = analysis.calls.filter(matches);
  const byId = new Map(calls.map((call) => [call.id, call]));
  const anomalies = analysis.anomalies.filter((item) => item.callIds.some((id) => byId.has(id))).map((item) => {
    const callIds = item.callIds.filter((id) => byId.has(id));
    const candidateCallIds = item.candidateCallIds.filter((id) => byId.has(id));
    return {
      ...item,
      callIds,
      candidateCallIds,
      baselineCallIds: item.baselineCallIds.filter((id) => byId.has(id)),
      necessary: candidateCallIds.length > 0 && candidateCallIds.every((id) => analysis.necessaryCallIds.has(id)),
      associatedCost: calculateCost(callIds.map((id) => byId.get(id)!), analysis.rates),
    };
  });
  const events = analysis.events.filter(matches);
  // A session-wide reported bill cannot be allocated to a smaller time window.
  const reportedSummaries = hasWindow ? [] : events.filter((event) => event.kind === 'model' && event.scope === 'summary');
  return {
    ...analysis,
    events,
    calls,
    sessions: createSessions(calls, analysis.rates),
    anomalies,
    usage: calls.reduce((summary, call) => addUsage(summary, call.usage), emptyUsage()),
    cost: calculateCost(calls, analysis.rates, reportedSummaries),
    candidateCost: candidateCost(anomalies, calls, analysis.rates, analysis.necessaryCallIds),
    lastDataAt: calls.filter((call) => Number.isFinite(Date.parse(call.timestamp)))
      .reduce<string | undefined>((latest, call) => !latest || Date.parse(call.timestamp) > Date.parse(latest) ? call.timestamp : latest, undefined),
  };
}

export function costForCalls(
  calls: AnalysisEvent[],
  rates: RateSnapshot[],
  reportedSummaries: AnalysisEvent[] = [],
): CostSummary {
  return calculateCost(calls, rates, reportedSummaries);
}

function demoCall(
  id: string,
  provider: Provider,
  sessionId: string,
  title: string,
  model: string,
  timestamp: string,
  behavior: Behavior,
  inputTokens: number,
  outputTokens: number,
  parentSessionId?: string,
): AnalysisEvent {
  return {
    id,
    provider,
    sourceFile: 'synthetic-demo.jsonl',
    sourceLine: Number(id.replace(/\D/g, '')) || 1,
    timestamp,
    kind: 'model',
    sessionId,
    parentSessionId,
    sessionTitle: title,
    actorId: sessionId,
    model,
    callId: id,
    behavior,
    usage: {
      inputTokens,
      cachedInputTokens: Math.floor(inputTokens * 0.35),
      outputTokens,
      inputIncludesCached: provider === 'codex',
    },
    scope: 'call',
  };
}

function demoTool(
  id: string,
  timestamp: string,
  sessionId: string,
  callId: string,
  kind: 'tool' | 'wait' | 'compaction',
  fields: Partial<AnalysisEvent>,
): AnalysisEvent {
  return {
    id,
    provider: 'codex',
    sourceFile: 'synthetic-demo.jsonl',
    sourceLine: Number(id.replace(/\D/g, '')) || 1,
    timestamp,
    kind,
    sessionId,
    actorId: sessionId,
    callId,
    ...fields,
  };
}

export function createDemoAnalysis(): AnalysisResult {
  // A stable fixture keeps the server-rendered dashboard and the first client
  // render identical while still showing a recent-looking sample in the demo.
  const now = Date.parse('2026-08-28T12:00:00+08:00');
  const at = (minutesAgo: number) => new Date(now - minutesAgo * 60 * 1000).toISOString();
  const events: AnalysisEvent[] = [];
  const auth = 'auth-service';
  const child = 'auth-service/subagent-1';
  const api = 'api-gateway';
  const realtime = 'realtime-client';
  let index = 1;
  for (const minutes of [3900, 3600, 3000, 2400, 1800, 1200, 600, 45]) {
    events.push(
      demoCall('demo-call-' + String(index++), 'codex', auth, '重构认证模块', 'gpt-5.6-sol', at(minutes), minutes < 300 ? 'read' : 'code', 260_000, 34_000),
    );
  }
  for (const minutes of [3850, 3200, 2500, 1700]) {
    events.push(
      demoCall('demo-call-' + String(index++), 'codex', child, '认证模块子 Agent', 'gpt-5.6-sol', at(minutes), 'subagent', 180_000, 22_000, auth),
    );
  }
  for (const minutes of [3300, 2700, 2100, 1300, 520]) {
    events.push(
      demoCall('demo-call-' + String(index++), 'claude', api, 'Review API 接口变更', 'claude-sonnet-4', at(minutes), minutes < 800 ? 'read' : 'code', 150_000, 24_000),
    );
  }
  for (const minutes of [2900, 2200, 1500, 300, 90]) {
    events.push(
      demoCall('demo-call-' + String(index++), 'codex', realtime, '修复 WebSocket 重连逻辑', 'gpt-5.6-terra', at(minutes), 'code', 210_000, 28_000),
    );
  }
  const readTimes = [40, 20, 18, 16];
  readTimes.forEach((minutes, readIndex) => {
    const callId = readIndex === 0 ? 'demo-call-7' : 'demo-call-' + String(5 + readIndex);
    events.push(
      demoTool(
        'demo-read-' + String(readIndex),
        at(minutes),
        auth,
        callId,
        'tool',
        {
          toolName: 'Read',
          behavior: 'read',
          filePath: 'src/auth/session.ts',
          fileRange: '1-180',
          contentHash: 'session-file-v1',
          complete: true,
          modelCallId: callId,
        },
      ),
    );
  });
  [12, 11, 10].forEach((minutes, pollIndex) => {
    const callId = 'demo-call-' + String(7 + pollIndex);
    events.push(
      demoTool(
        'demo-poll-' + String(pollIndex),
        at(minutes),
        auth,
        callId,
        'wait',
        {
          toolName: 'wait_for_agent',
          behavior: 'wait',
          target: child,
          stateHash: 'child-still-running',
          pureWait: true,
          modelCallId: callId,
        },
      ),
    );
  });
  [30, 25].forEach((minutes, compactIndex) => {
    const callId = 'demo-call-' + String(7 + compactIndex);
    events.push(
      demoTool(
        'demo-compact-' + String(compactIndex),
        at(minutes),
        auth,
        callId,
        'compaction',
        { modelCallId: callId },
      ),
      demoTool(
        'demo-recovery-read-' + String(compactIndex),
        at(minutes - 1),
        auth,
        callId,
        'tool',
        {
          toolName: 'Read',
          behavior: 'read',
          filePath: 'src/auth/session.ts',
          fileRange: '1-180',
          contentHash: 'session-file-v1',
          complete: true,
          modelCallId: callId,
        },
      ),
    );
  });
  return buildAnalysis(events, demoRateSnapshots, {
    mode: 'demo',
    sourceLabel: '合成演示数据',
  });
}

export function formatTokenCount(value: number): string {
  if (value >= 1_000_000) return (value / 1_000_000).toFixed(value >= 10_000_000 ? 1 : 2) + 'M';
  if (value >= 1_000) return (value / 1_000).toFixed(value >= 100_000 ? 0 : 1) + 'K';
  return Math.round(value).toLocaleString('zh-CN');
}

export function formatMoney(value: number | undefined, currency = 'USD'): string {
  if (value === undefined) return '未知';
  if (value === 0) return currency === 'USD' ? '$0.00' : '0 credits';
  if (currency === 'USD') return Math.abs(value) < 0.01 ? '<$0.01' : '$' + value.toFixed(2);
  if (Math.abs(value) < 0.01) return '<0.01 credits';
  const maximumFractionDigits = Math.abs(value) < 1 ? 2 : Math.abs(value) < 100 ? 1 : 0;
  return value.toLocaleString('zh-CN', { maximumFractionDigits }) + ' credits';
}

export function formatDateTime(value?: string): string {
  if (!value) return '暂无数据';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '时间未知';
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatRelativeTime(value?: string): string {
  if (!value) return '暂无数据';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '时间未知';
  const seconds = Math.max(0, Math.round((Date.now() - date.getTime()) / 1000));
  if (seconds < 60) return seconds + ' 秒前';
  if (seconds < 3600) return Math.floor(seconds / 60) + ' 分钟前';
  if (seconds < 86400) return Math.floor(seconds / 3600) + ' 小时前';
  return Math.floor(seconds / 86400) + ' 天前';
}

export function providerLabel(provider: Provider): string {
  if (provider === 'codex') return 'Codex';
  if (provider === 'claude') return 'Claude Code';
  return '未知来源';
}

export function behaviorLabel(behavior?: Behavior): string {
  const labels: Record<Behavior, string> = {
    planning: '规划与思考',
    code: '代码与执行',
    read: '读取',
    wait: '等待 / 轮询',
    subagent: '子 Agent',
    other: '其他',
    mixed: '混合',
    unknown: '未知归因',
  };
  return labels[behavior ?? 'unknown'];
}

export function anomalyLabel(type: AnomalyType): string {
  if (type === 'reread') return '重复读取';
  if (type === 'poll') return '轮询空转';
  return '压缩循环';
}
