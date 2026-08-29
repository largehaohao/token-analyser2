import {
  buildAnalysis,
  cloneParseContinuationState,
  createParseContinuationState,
  parseJsonl,
  defaultRateSnapshots,
  type AnalysisEvent,
  type AnalysisResult,
  type ParseError,
  type ParseContinuationState,
  type Provider,
  type RateSnapshot,
} from './analysis';
import { consumeJsonlChunk, isSessionLogFile } from './jsonl-cursor';
import { providerFromName } from './collector';

export type CollectorStatus = 'idle' | 'collecting' | 'stopped' | 'error';

export interface CollectorFs {
  sessionMetadata?(root: string): Promise<Map<string, { title?: string; cwd?: string }>>;
  realpath(path: string): Promise<string>;
  homeDir(): Promise<string>;
  stat(path: string): Promise<{ kind: 'file' | 'directory'; size: number; mtimeMs: number }>;
  readdir(path: string): Promise<Array<{ name: string; kind: 'file' | 'directory' }>>;
  read(path: string, offset: number): Promise<{ chunk: string; size: number }>;
}

export interface CollectorSnapshot {
  revision: string;
  status: CollectorStatus;
  path?: string;
  message: string;
  analysis?: AnalysisResult;
}

export interface CollectorDataSnapshot {
  revision: string;
  status: CollectorStatus;
  path?: string;
  message: string;
  events: AnalysisEvent[];
  errors: ParseError[];
}

interface FileCursor {
  parsedBytes: number;
  pending: string;
  pendingStart?: number;
  lineNumber: number;
  sessionId?: string;
  provider?: Provider;
  model?: string;
  cwd?: string;
  sessionTitle?: string;
  pendingOutputs: Map<string, string>;
  toolEvents: Map<string, AnalysisEvent>;
  continuation: ParseContinuationState;
}

function joinPath(dir: string, name: string): string {
  if (dir.endsWith('/')) return dir + name;
  return dir + '/' + name;
}

function isInsideRoot(root: string, full: string): boolean {
  const prefix = root.endsWith('/') ? root : root + '/';
  return full === root || full.startsWith(prefix);
}

function relativeTo(root: string, full: string): string {
  if (full === root) return full.split('/').at(-1) ?? full;
  const prefix = root.endsWith('/') ? root : root + '/';
  return full.startsWith(prefix) ? full.slice(prefix.length) : full;
}

function isCodexRoot(root: string): boolean {
  return root.split('/').at(-1) === '.codex';
}

function isCodexSessionDirectory(root: string, full: string): boolean {
  if (!isCodexRoot(root)) return true;
  const relative = relativeTo(root, full);
  const first = relative.split('/')[0];
  return first === 'sessions' || first === 'archived_sessions';
}

function sessionIdFromPath(fullPath: string): string | undefined {
  const match = fullPath.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\.[^/]+)?$/i);
  return match?.[1];
}

function sessionIdFromFirstRecord(text: string): string | undefined {
  const line = text.split(/\r?\n/).find((item) => item.trim());
  if (!line) return undefined;
  try {
    const record = JSON.parse(line) as Record<string, unknown>;
    const payload = record.payload && typeof record.payload === 'object'
      ? record.payload as Record<string, unknown>
      : undefined;
    const value = [payload?.id, record.session_id, record.sessionId, payload?.session_id]
      .find((item) => typeof item === 'string' && item.trim());
    return typeof value === 'string' ? value : undefined;
  } catch {
    return undefined;
  }
}

export async function expandPath(path: string, fs: CollectorFs): Promise<string> {
  const trimmed = path.trim();
  if (trimmed === '~') return fs.homeDir();
  if (trimmed.startsWith('~/')) return joinPath(await fs.homeDir(), trimmed.slice(2));
  return trimmed;
}

export function createCollector(fs: CollectorFs, rates: RateSnapshot[] = defaultRateSnapshots) {
  const instanceId = crypto.randomUUID();
  let revision = 0;
  let status: CollectorStatus = 'idle';
  let root: string | undefined;
  let message = '本地采集空闲';
  const cursors = new Map<string, FileCursor>();
  const eventsByFile = new Map<string, AnalysisEvent[]>();
  const errorsByFile = new Map<string, ParseError[]>();
  let sessionMetadata = new Map<string, { title?: string; cwd?: string }>();
  let cachedAnalysis: AnalysisResult | undefined;
  let analysisDirty = true;

  async function walk(dir: string): Promise<string[]> {
    const files: string[] = [];
    const entries = await fs.readdir(dir);
    for (const entry of entries) {
      const full = joinPath(dir, entry.name);
      const resolved = await fs.realpath(full).catch(() => undefined);
      if (!resolved || !root || !isInsideRoot(root, resolved)) continue;
      if (!isCodexSessionDirectory(root, resolved)) continue;
      if (entry.kind === 'directory') files.push(...(await walk(resolved)));
      else if (isSessionLogFile(entry.name)) files.push(resolved);
    }
    return files;
  }

  function enrichedEvents(): AnalysisEvent[] {
    return [...eventsByFile.values()].flat().map((event) => {
      const metadata = event.provider === 'codex' ? sessionMetadata.get(event.sessionId) : undefined;
      return metadata ? { ...event, sessionTitle: metadata.title || event.sessionTitle, cwd: metadata.cwd || event.cwd } : event;
    });
  }

  function rebuild(): AnalysisResult | undefined {
    if (!analysisDirty) return cachedAnalysis;
    const events = enrichedEvents();
    const errors = [...errorsByFile.values()].flat();
    cachedAnalysis = events.length || errors.length
      ? buildAnalysis(events, rates, {
          mode: 'live',
          sourceLabel: root ? '实时目录 · ' + root : '实时采集',
          errors,
        })
      : undefined;
    analysisDirty = false;
    return cachedAnalysis;
  }

  async function ingestFile(fullPath: string): Promise<void> {
    if (!root) return;
    const relative = relativeTo(root, fullPath);
    const cursor: FileCursor = cursors.get(fullPath) ?? {
      parsedBytes: 0,
      pending: '',
      pendingStart: undefined,
      lineNumber: 0,
      sessionId: sessionIdFromPath(fullPath),
      provider: providerFromName(relative) === 'unknown' ? undefined : providerFromName(relative),
      pendingOutputs: new Map(),
      toolEvents: new Map(),
      continuation: createParseContinuationState(),
    };
    let changed = false;
    const info = await fs.stat(fullPath);
    if (info.size < cursor.parsedBytes) {
      cursor.parsedBytes = 0;
      cursor.pending = '';
      cursor.pendingStart = undefined;
      cursor.lineNumber = 0;
      cursor.sessionId = sessionIdFromPath(fullPath);
      cursor.provider = providerFromName(relative) === 'unknown' ? undefined : providerFromName(relative);
      cursor.model = undefined;
      cursor.cwd = undefined;
      cursor.sessionTitle = undefined;
      cursor.pendingOutputs = new Map();
      cursor.toolEvents = new Map();
      cursor.continuation = createParseContinuationState();
      eventsByFile.delete(relative);
      errorsByFile.delete(relative);
      changed = true;
    }
    const readOffset = cursor.pending
      ? Math.max(0, Math.min(cursor.pendingStart ?? cursor.parsedBytes, info.size))
      : cursor.parsedBytes;
    const { chunk, size } = await fs.read(fullPath, readOffset);
    if (!chunk) {
      cursors.set(fullPath, cursor);
      return;
    }
    let { lines, pending } = consumeJsonlChunk('', chunk);
    const kept: AnalysisEvent[] = eventsByFile.get(relative) ?? [];
    const fileErrors: ParseError[] = errorsByFile.get(relative) ?? [];
    let completeText = lines.length ? lines.join('\n') + '\n' : '';
    cursor.sessionId ??= sessionIdFromFirstRecord(completeText);
    let pendingOutputs = new Map(cursor.pendingOutputs);
    let toolEvents = new Map(cursor.toolEvents);
    let continuation = cloneParseContinuationState(cursor.continuation);
    const parseChunk = (text: string) => parseJsonl(text, {
      sourceFile: relative,
      provider: cursor.provider,
      sessionId: cursor.sessionId,
      model: cursor.model,
      cwd: cursor.cwd,
      sessionTitle: cursor.sessionTitle,
      lineOffset: cursor.lineNumber,
      pendingOutputs,
      toolEvents,
      continuation,
    });
    let parsed = completeText ? parseChunk(completeText) : undefined;
    // A writer can flush a newline before finishing the JSON object. Defer a
    // malformed final record and retry it with the next appended chunk rather
    // than turning a transient tail into a permanent parse error.
    const lastLineNumber = cursor.lineNumber + lines.length;
    if (parsed?.errors.some((error) => error.line === lastLineNumber) && lines.length > 0) {
      pending = lines.at(-1) ?? pending;
      lines = lines.slice(0, -1);
      completeText = lines.length ? lines.join('\n') + '\n' : '';
      pendingOutputs = new Map(cursor.pendingOutputs);
      toolEvents = new Map(cursor.toolEvents);
      continuation = cloneParseContinuationState(cursor.continuation);
      parsed = completeText ? parseChunk(completeText) : undefined;
    }
    if (parsed) {
      cursor.pendingOutputs = pendingOutputs;
      cursor.toolEvents = toolEvents;
      cursor.continuation = continuation;
      if (parsed.provider !== 'unknown') {
        cursor.provider = parsed.provider;
        for (const event of kept) {
          if (event.provider === 'unknown') {
            event.provider = parsed.provider;
            changed = true;
          }
        }
      }
      cursor.model ??= parsed.events.find((event) => event.model)?.model;
      cursor.cwd = parsed.events.findLast((event) => event.cwd)?.cwd ?? cursor.cwd;
      cursor.sessionTitle = parsed.events.findLast((event) => event.sessionTitle)?.sessionTitle ?? cursor.sessionTitle;
      kept.push(...parsed.events);
      fileErrors.push(...parsed.errors);
      changed = changed || parsed.events.length > 0 || parsed.errors.length > 0 || Boolean(parsed.updatedExisting);
    }
    const chunkBytes = Buffer.byteLength(chunk, 'utf8');
    cursor.parsedBytes = readOffset + chunkBytes;
    if (cursor.parsedBytes > size) cursor.parsedBytes = size;
    cursor.pending = pending;
    if (pending) {
      const endingBytes = /\r\n$/.test(chunk) ? 2 : /\n$/.test(chunk) ? 1 : 0;
      cursor.pendingStart = readOffset + chunkBytes - Buffer.byteLength(pending, 'utf8') - endingBytes;
    } else {
      cursor.pendingStart = undefined;
    }
    cursor.lineNumber += lines.length;
    cursors.set(fullPath, cursor);
    eventsByFile.set(relative, kept);
    errorsByFile.set(relative, fileErrors);
    if (changed) { analysisDirty = true; revision += 1; }
  }

  async function poll(): Promise<CollectorSnapshot> {
    if (status !== 'collecting' || !root) return statusSnapshot();
    try {
      const files = await walk(root);
      for (const file of files) await ingestFile(file);
      if (fs.sessionMetadata) {
        const next = await fs.sessionMetadata(root).catch(() => undefined);
        if (next && JSON.stringify([...next]) !== JSON.stringify([...sessionMetadata])) {
          sessionMetadata = next;
          analysisDirty = true;
          revision += 1;
        }
      }
      message = '实时采集运行中';
    } catch (error) {
      status = 'error';
      message = error instanceof Error ? error.message : '实时目录读取失败';
    }
    // Do not synchronously rebuild the complete analysis on every timer tick.
    // The browser builds its memoized view from the event snapshot, while an
    // explicit `snapshot()` remains available to callers that need the full
    // server-side result (for example, tests and offline consumers).
    return statusSnapshot();
  }

  async function start(path: string): Promise<CollectorSnapshot> {
    try {
      const expanded = await expandPath(path, fs);
      const resolved = await fs.realpath(expanded);
      const info = await fs.stat(resolved);
      if (info.kind !== 'directory') throw new Error('请选择日志目录而不是文件');
      root = resolved;
      status = 'collecting';
      message = '实时采集运行中';
      cursors.clear();
      eventsByFile.clear();
      errorsByFile.clear();
      sessionMetadata.clear();
      cachedAnalysis = undefined;
      analysisDirty = true;
      revision += 1;
      await poll();
    } catch (error) {
      status = 'error';
      message = error instanceof Error ? error.message : '无法开始采集';
    }
    return statusSnapshot();
  }

  function stop(): CollectorSnapshot {
    if (status === 'collecting') status = 'stopped';
    message = '采集已停止；当前结果仍可查看';
    return statusSnapshot();
  }

  function clear(): CollectorSnapshot {
    status = 'idle';
    root = undefined;
    message = '本次临时数据已清除；费率偏好仍保留';
    cursors.clear();
    eventsByFile.clear();
    errorsByFile.clear();
    sessionMetadata.clear();
    cachedAnalysis = undefined;
    analysisDirty = true;
    revision += 1;
    return statusSnapshot();
  }

  function snapshot(): CollectorSnapshot {
    return {
      revision: instanceId + ':' + revision,
      status,
      path: root,
      message,
      analysis: rebuild(),
    };
  }

  // Health checks only need lifecycle state. Keeping this path free of
  // `rebuild()` prevents a large live directory from blocking liveness probes
  // while a full analysis pass is being prepared for the data endpoint.
  function statusSnapshot(): CollectorSnapshot {
    return {
      revision: instanceId + ':' + revision,
      status,
      path: root,
      message,
    };
  }

  function rawSnapshot(): CollectorDataSnapshot {
    return {
      ...statusSnapshot(),
      events: enrichedEvents(),
      errors: [...errorsByFile.values()].flat(),
    };
  }

  return { start, stop, clear, poll, snapshot, statusSnapshot, rawSnapshot };
}

export function serializeAnalysis(result: AnalysisResult | undefined) {
  if (!result) return undefined;
  return {
    ...result,
    necessaryCallIds: [...result.necessaryCallIds],
  };
}

export function deserializeAnalysis(
  value: ReturnType<typeof serializeAnalysis>,
): AnalysisResult | undefined {
  if (!value) return undefined;
  return {
    ...value,
    necessaryCallIds: new Set(value.necessaryCallIds),
  };
}

export type { Provider };
