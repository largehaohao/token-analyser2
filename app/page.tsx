'use client';

import Link from 'next/link';
import { contextInventoryIndex, contextSessionKey, type ContextCategory, type SessionContextInventory } from '@/lib/context-inventory';
import {
  aggregateTokenComposition,
  analysisCompletenessLabel,
  anomalyBelongsToSession,
  anomalyCostView,
  behaviorKey,
  behaviorShares,
  callContentIndex,
  candidateShare,
  collectorConnectionLabel,
  compareSessionGrowth,
  confidenceLabel,
  costCaption,
  dataFreshness,
  dataFreshnessLabel,
  displayCost,
  eventsForSession,
  findSessionByKey,
  formatCallAmount,
  formatGrowthDisplay,
  formatSharePercent,
  paginate,
  SESSION_TIME_RANGES,
  sessionCollapseKey,
  sessionCompletenessCaption,
  sessionDisplayName,
  sessionEntryCounts,
  sessionForest,
  sessionGrowthRate,
  sessionIsActive,
  sessionParentPresent,
  sessionRoleLabel,
  sessionTreeRows,
  sessionsInTimeRange,
  shouldHandleEscape,
  tokenComposition,
  trendChartMode,
  optimizableCallIds,
  rootsMatchingQuery,
  type CallContent,
  type CollectorConnection,
  type SessionForest,
  type SessionTimeRange,
} from '@/lib/session-view';
import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  buildAnalysis,
  scopeAnalysis,
  createDemoAnalysis,
  defaultRateSnapshots,
  demoRateSnapshots,
  formatDateTime,
  formatExactTokenCount,
  formatRelativeTime,
  formatTokenCount,
  parseJsonl,
  providerLabel,
  usageTokenCount,
  costForCalls,
  type AnalysisEvent,
  type AnalysisSession,
  type AnalysisResult,
  type Anomaly,
  type Provider,
  type RateSnapshot,
} from '@/lib/analysis';
import {
  readFileDocuments,
  type SourceDocument,
} from '@/lib/collector';
import {
  clearSessionOnly,
  loadPreferences,
  savePreferences,
  type Preferences,
} from '@/lib/storage';

type View = 'overview' | 'sessions' | 'insights' | 'subagents' | 'settings';
type Currency = 'usd' | 'credits';
type CollectorStatus = 'idle' | 'loading' | 'collecting' | 'stopped' | 'error';
const COLLECTOR_URL = 'http://127.0.0.1:8787/api/collector';
type SessionSort = 'updated' | 'tokens' | 'cost' | 'growth';

const NAV_ITEMS: Array<{ id: View; label: string; icon: string }> = [
  { id: 'overview', label: '成本总览', icon: '◫' },
  { id: 'sessions', label: '会话记录', icon: '▤' },
  { id: 'insights', label: '异常洞察', icon: '⌁' },
  { id: 'subagents', label: '子 Agent', icon: '⑂' },
];

const BEHAVIOR_COLORS: Record<string, string> = {
  code: '#c5ed87',
  subagent: '#a99ae8',
  read: '#e3b576',
  wait: '#82b8bd',
  planning: '#94a1b5',
  mixed: '#c9b07a',
  other: '#dd8c87',
  unknown: '#8b968c',
};

const TOKEN_PART_COLORS: Record<string, string> = {
  uncached: '#77dc91',
  cached: '#5686d8',
  cacheWrite: '#d8aa64',
  output: '#b88ad3',
};

function providerClass(provider: Provider): string {
  return provider === 'claude' ? 'claude' : provider === 'codex' ? 'codex' : 'unknown';
}

function completenessLabel(result: AnalysisResult): string {
  return analysisCompletenessLabel(result.completeness);
}

function IntegrityBadge({ completeness }: { completeness: AnalysisResult['completeness'] }) {
  return (
    <span className={'integrity-pill integrity-' + completeness}>
      {analysisCompletenessLabel(completeness)}
    </span>
  );
}

function StatusChip({
  kind,
  label,
  title,
}: {
  kind: 'live' | 'quiet' | 'stale' | 'unknown' | 'ok' | 'warn' | 'error' | 'idle';
  label: string;
  title?: string;
}) {
  return <span className={'status-chip status-chip-' + kind} title={title}>{label}</span>;
}

function eventLabel(event: AnalysisEvent): string {
  if (event.kind === 'context') return '上下文目录快照';
  if (event.kind === 'assistant') return 'Agent 回复';
  if (event.kind === 'model') return event.scope === 'summary' ? '来源费用汇总' : '模型调用';
  if (event.kind === 'tool') return event.toolName || '工具执行';
  if (event.kind === 'wait') return '等待 / 轮询';
  if (event.kind === 'compaction') return '上下文压缩';
  if (event.kind === 'user') return '用户请求';
  return '未知记录';
}

function TokenFigure({ value }: { value: number }) {
  return <>
    <span aria-hidden="true">{formatTokenCount(value)}</span>
    <span className="visually-hidden">{formatExactTokenCount(value)}</span>
  </>;
}

function compareDescending(left: number | undefined, right: number | undefined): number {
  if (left === undefined && right === undefined) return 0;
  if (left === undefined) return 1;
  if (right === undefined) return -1;
  return right - left;
}

function MetricCard({
  label,
  value,
  caption,
  icon,
  accent,
  title,
  tone,
  badge,
}: {
  label: string;
  value: string;
  caption: string;
  icon: string;
  accent?: boolean;
  title?: string;
  tone?: 'known' | 'partial' | 'unknown';
  badge?: string;
}) {
  return (
    <article className={'metric-card' + (accent ? ' metric-card-accent' : '') + (tone ? ' metric-tone-' + tone : '')} title={title}>
      <div className="metric-label">
        <span>{label}</span>
        {badge ? <span className="metric-badge">{badge}</span> : <span className="metric-icon" aria-hidden="true">{icon}</span>}
      </div>
      <div className="metric-value">{value}</div>
      <div className="metric-caption">{caption}</div>
    </article>
  );
}

function SourceBadge({ provider }: { provider: Provider }) {
  return (
    <span className={'provider-tag ' + providerClass(provider)}>
      <span aria-hidden="true">{provider === 'codex' ? '⬡' : provider === 'claude' ? '✳' : '◌'}</span>
      {providerLabel(provider)}
    </span>
  );
}

function ConfidenceBadge({ confidence }: { confidence: Anomaly['confidence'] }) {
  return <span className={'confidence confidence-' + confidence}>{confidenceLabel(confidence)} 置信度</span>;
}

function AnomalyCard({
  anomaly,
  analysis,
  currency,
  onToggleNecessary,
  onSelect,
  selected,
  onOpenSession,
}: {
  anomaly: Anomaly;
  analysis: AnalysisResult;
  currency: Currency;
  onToggleNecessary: (callIds: string[]) => void;
  onSelect: () => void;
  selected: boolean;
  onOpenSession?: () => void;
}) {
  const allNecessary =
    anomaly.candidateCallIds.length > 0 &&
    anomaly.candidateCallIds.every((id) => analysis.necessaryCallIds.has(id));
  const costs = anomalyCostView(anomaly, analysis, currency);
  return (
    <article className={'anomaly-card' + (selected ? ' anomaly-card-selected' : '')}>
      <button className="anomaly-card-main" onClick={onSelect} aria-expanded={selected}>
        <div className="anomaly-card-top">
          <span className={'anomaly-symbol anomaly-' + anomaly.type} aria-hidden="true">
            {anomaly.type === 'reread' ? '↻' : anomaly.type === 'poll' ? '⌛' : '⤾'}
          </span>
          <ConfidenceBadge confidence={anomaly.confidence} />
        </div>
        <div className="anomaly-card-title">{anomaly.title}</div>
        <p>{anomaly.description}</p>
        <div className="anomaly-cost-rows">
          <div>
            <span>疑似可优化</span>
            <strong className={costs.countsTowardCandidate ? 'cost-candidate' : 'cost-excluded'} title={costs.candidateDisplay.note}>
              {costs.candidateDisplay.value}
            </strong>
          </div>
          <div>
            <span>关联调用费用</span>
            <em title={costs.associatedDisplay.note}>{costs.associatedDisplay.value}</em>
          </div>
        </div>
      </button>
      <div className="anomaly-card-actions">
        <span className="anomaly-note">{costs.note}</span>
        <div className="anomaly-card-buttons">
          {onOpenSession && (
            <button className="text-button" onClick={onOpenSession}>打开会话 ↗</button>
          )}
          {anomaly.candidateCallIds.length > 0 && (
            <button
              className={'necessary-button' + (allNecessary ? ' is-necessary' : '')}
              onClick={() => onToggleNecessary(anomaly.candidateCallIds)}
              aria-pressed={allNecessary}
            >
              {allNecessary ? '已标记必要' : '标记为必要'}
            </button>
          )}
        </div>
      </div>
      {selected && (
        <div className="anomaly-evidence">
          <div className="evidence-heading">证据链</div>
          {anomaly.evidence.map((item) => (
            <div className="evidence-row" key={item.eventId ?? item.label + item.detail}>
              <span className="evidence-index">{item.sourceLine ?? '·'}</span>
              <div>
                <strong>{item.label}</strong>
                <p>{item.detail}</p>
                <small>{item.sourceFile ?? '来源未知'}</small>
              </div>
            </div>
          ))}
          <div className="evidence-footnote">
            {anomaly.confidence === 'high'
              ? '模式证据完整；这不代表该操作没有价值。疑似可优化与关联调用费用不可相加。'
              : '证据不足以确认必要性，金额不会自动进入候选汇总。'}
          </div>
          {anomaly.recommendation && (
            <div className="anomaly-recommendation">
              <strong>优化建议（手动执行）</strong>
              <p>{anomaly.recommendation}</p>
            </div>
          )}
        </div>
      )}
    </article>
  );
}

function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="empty-state">
      <span className="empty-icon" aria-hidden="true">◌</span>
      <strong>{title}</strong>
      <p>{description}</p>
      {action}
    </div>
  );
}

function Pagination({ page, pageCount, total, start, end, onChange, label, unit = '条' }: {
  page: number; pageCount: number; total: number; start: number; end: number;
  onChange: (page: number) => void; label: string; unit?: string;
}) {
  return <nav className="pagination" aria-label={label}>
    <span role="status">第 {start}–{end} {unit}，共 {total} {unit}</span>
    <div>
      <button className="button secondary" disabled={page <= 1} onClick={() => onChange(1)} aria-label="第一页">«</button>
      <button className="button secondary" disabled={page <= 1} onClick={() => onChange(page - 1)}>上一页</button>
      <span>{page} / {pageCount} 页</span>
      <button className="button secondary" disabled={page >= pageCount} onClick={() => onChange(page + 1)}>下一页</button>
      <button className="button secondary" disabled={page >= pageCount} onClick={() => onChange(pageCount)} aria-label="最后一页">»</button>
    </div>
  </nav>;
}

function EventContent({ event, content, expanded = false }: { event: AnalysisEvent; content?: CallContent; expanded?: boolean }) {
  const fields = event.kind === 'model'
    ? [
        { label: '用户请求（上下文）', text: content?.prompt },
        { label: 'Agent 回复', text: content?.reply },
        { label: '邻近工具操作', text: content?.operations.join('\n') },
      ].filter((field) => field.text)
    : [
        { label: event.kind === 'user' ? '用户请求' : event.kind === 'assistant' ? 'Agent 回复' : '记录内容', text: event.text },
        { label: '工具输入', text: event.toolInput },
        { label: '工具结果', text: event.toolOutput },
      ].filter((field) => field.text);
  const preview = event.kind === 'model' ? content?.reply || content?.operations.join('\n') || content?.prompt : fields[0]?.text;
  if (!preview) return <p className="call-content-empty">来源未记录可关联的内容摘录</p>;
  const body = <div className="call-content-body">
      {fields.map((field) => <section key={field.label}><strong>{field.label}</strong><pre>{field.text}</pre></section>)}
      <small>日志原文摘录；邻近记录不代表精确的 Token 归属。较长内容可能已截断。</small>
    </div>;
  if (expanded) return body;
  return <details className="call-content">
    <summary><span className="call-content-preview">{preview}</span><span className="call-content-toggle">内容摘录 ▾</span></summary>
    {body}
  </details>;
}

function SessionContextPanel({ inventory, category, onCategory }: {
  inventory?: SessionContextInventory; category: ContextCategory; onCategory: (category: ContextCategory) => void;
}) {
  const [pageNumber, setPageNumber] = useState(1);
  const event = inventory?.[category];
  const snapshot = event?.contextSnapshot;
  const components = snapshot?.components ?? [];
  const page = paginate(components, pageNumber, 15);
  return <section className="context-panel" aria-label="Tools 和 Skills 上下文组成">
    <div className="context-category-cards" role="group" aria-label="上下文类型">
      {(['tools', 'skills'] as const).map((kind) => {
        const current = inventory?.[kind]?.contextSnapshot;
        return <button key={kind} aria-pressed={category === kind} onClick={() => { onCategory(kind); setPageNumber(1); }}>
          <span>{kind === 'tools' ? 'Tools 定义' : 'Skills 目录'}</span>
          <strong>{current ? current.chars.toLocaleString('en-US') + ' 字符' : '长度未知'}</strong>
          <small>{current ? current.components.filter((part) => !part.overhead).length + ' 个条目 · 含公共说明' : '日志未记录定义 / 目录'}</small>
        </button>;
      })}
    </div>
    <p className="context-scope-note">仅展示本会话最近一份已记录定义 / 目录，不含子会话，不累计重复注入。字符数不是 Token 数；目录不等于已加载的 SKILL.md 全文，也不保证仍驻留在当前模型上下文中。</p>
    {snapshot && event ? <>
      <div className="context-snapshot-source"><strong>{category === 'tools' ? 'Tools' : 'Skills'} 组成 · {snapshot.format === 'json' ? 'JSON 序列化字符数' : '日志原文字符数'}</strong><span>{formatDateTime(event.timestamp)} · 已记录 {inventory?.observations[category]} 份</span><small>{event.sourceFile} · 第 {event.sourceLine} 行</small></div>
      <Pagination {...page} onChange={setPageNumber} label="上下文组成分页" />
      <div className="context-components">
        {page.items.map((part, index) => <details className="context-component" key={page.start + index}>
          <summary><span>{part.name}{part.overhead && <small>公共说明 / 格式</small>}</span><span className="context-part-size">{part.chars.toLocaleString('en-US')} 字符<small>{snapshot.chars ? (part.chars / snapshot.chars * 100).toFixed(1) : '0.0'}%</small></span></summary>
          <pre>{part.text}{part.truncated ? '\n… [展示摘录已截断；上方长度按完整原文计算]' : ''}</pre>
        </details>)}
      </div>
    </> : <EmptyState title={category === 'tools' ? '未记录完整 Tools 定义' : '未记录 Skills 目录'} description="无法从 Token 总量、工具调用次数或本机当前安装列表反推历史上下文长度。未知不表示没有使用。" />}
    {category === 'tools' && !!inventory?.usedTools.size && <div className="observed-tools"><h3>实际调用过的工具（{inventory.usedTools.size} 种）</h3><p>仅作为调用证据，不代表工具定义清单或上下文占用。</p><div>{[...inventory.usedTools].sort((a, b) => b[1] - a[1]).map(([name, count]) => <span key={name}>{name}<small>{count.toLocaleString('en-US')} 次</small></span>)}</div></div>}
  </section>;
}

function SessionCostTree({
  session,
  childSessions,
  rates,
  currency,
}: {
  session: AnalysisSession;
  childSessions: AnalysisSession[];
  rates: RateSnapshot[];
  currency: Currency;
}) {
  const breakdown = behaviorShares(session.ownCalls);
  const inclusiveCost = displayCost(session.inclusiveCost, currency);
  const ownCost = displayCost(session.ownCost, currency);
  return (
    <section className="cost-tree-panel" aria-label="成本树">
      <div className="cost-tree-heading">
        <div><h3>成本树</h3><p>自身用量与含子会话合计分开列出，不可再相加</p></div>
        <strong title={inclusiveCost.note}>{inclusiveCost.value}</strong>
      </div>
      <div className="cost-tree-rows">
        <div className="cost-tree-row cost-tree-root">
          <span><i>└─</i>{sessionDisplayName(session)}</span>
          <b title={formatExactTokenCount(session.inclusiveUsage.totalTokens)}>{formatTokenCount(session.inclusiveUsage.totalTokens)}</b>
          <em>{inclusiveCost.value}</em>
        </div>
        <div className="cost-tree-row cost-tree-leaf">
          <span><i>├─</i>自身调用</span>
          <b title={formatExactTokenCount(session.ownUsage.totalTokens)}>{formatTokenCount(session.ownUsage.totalTokens)}</b>
          <em>{ownCost.value}</em>
        </div>
        {breakdown.filter((item) => item.tokens > 0).map((item) => {
          const calls = session.ownCalls.filter((call) => behaviorKey(call.behavior) === item.key);
          const cost = displayCost(costForCalls(calls, rates), currency);
          return (
            <div className="cost-tree-row cost-tree-leaf" key={item.key}>
              <span><i>│  ├─</i>{item.label}</span>
              <b title={formatExactTokenCount(item.tokens)}>{formatSharePercent(item.percent, item.tokens)} · {formatTokenCount(item.tokens)}</b>
              <em>{cost.value}</em>
            </div>
          );
        })}
        {childSessions.length > 0 && <div className="cost-tree-row cost-tree-child">
          <span>└─ {childSessions.length} 个直属子会话</span>
          <b>在“子会话”中分页查看</b>
        </div>}
      </div>
    </section>
  );
}

export default function Home() {
  const initialDemo = useMemo(() => createDemoAnalysis(), []);
  const [view, setView] = useState<View>('overview');
  const [analysisMode, setAnalysisMode] = useState<'demo' | 'history' | 'live'>('demo');
  const [sourceLabel, setSourceLabel] = useState('合成演示数据');
  const [sourceEvents, setSourceEvents] = useState<AnalysisEvent[]>(initialDemo.events);
  const [sourceErrors, setSourceErrors] = useState(initialDemo.errors);
  const [providerFilter, setProviderFilter] = useState<Provider | 'all'>('all');
  const [currency, setCurrency] = useState<Currency>('usd');
  const [preferences, setPreferences] = useState<Preferences>({ customRates: [], currency: 'usd', livePath: '' });
  const [preferencesReady, setPreferencesReady] = useState(false);
  const [necessaryCallIds, setNecessaryCallIds] = useState<Set<string>>(new Set());
  const [selectedSessionKey, setSelectedSessionKey] = useState<string | null>(null);
  const [selectedAnomalyId, setSelectedAnomalyId] = useState<string | null>(null);
  const [sessionPage, setSessionPage] = useState(1);
  const [sessionTimeRange, setSessionTimeRange] = useState<SessionTimeRange>('all');
  const [sessionRangeNow, setSessionRangeNow] = useState(0);
  const [overviewTimeRange, setOverviewTimeRange] = useState<SessionTimeRange>('all');
  const [overviewRangeNow, setOverviewRangeNow] = useState(0);
  const [subagentPage, setSubagentPage] = useState(1);
  const [timelinePage, setTimelinePage] = useState(1);
  const [expandedCallId, setExpandedCallId] = useState<string | null>(null);
  const [childPage, setChildPage] = useState(1);
  const [detailSection, setDetailSection] = useState<'summary' | 'calls' | 'children' | 'evidence' | 'context'>('summary');
  const [contextCategory, setContextCategory] = useState<ContextCategory>('skills');
  const [timelineScope, setTimelineScope] = useState<'model' | 'all'>('model');
  const [collectorStatus, setCollectorStatus] = useState<CollectorStatus>('idle');
  const [collectorMessage, setCollectorMessage] = useState('本地服务已就绪');
  const [trendMetric, setTrendMetric] = useState<Currency | 'tokens'>('usd');
  const [sessionSort, setSessionSort] = useState<SessionSort>('updated');
  const [sessionQuery, setSessionQuery] = useState('');
  const [clockMs, setClockMs] = useState(0);
  const [collectorReachable, setCollectorReachable] = useState<boolean | null>(null);
  const [collapsedSessionIds, setCollapsedSessionIds] = useState<Set<string>>(new Set());
  const [livePath, setLivePath] = useState('');
  const [rateDraft, setRateDraft] = useState({
    provider: 'codex' as Provider,
    modelPattern: '*',
    unit: 'usd' as Currency,
    input: '',
    cached: '',
    output: '',
    source: '用户自定义费率',
  });
  const fileInputRef = useRef<HTMLInputElement>(null);
  const sessionSearchRef = useRef<HTMLInputElement>(null);
  const collectorRevision = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (view !== 'sessions' || sessionTimeRange === 'all') return;
    const refresh = () => setSessionRangeNow(Date.now());
    const initial = window.setTimeout(refresh, 0);
    const timer = window.setInterval(refresh, 60_000);
    return () => { window.clearTimeout(initial); window.clearInterval(timer); };
  }, [view, sessionTimeRange]);

  useEffect(() => {
    if (view !== 'overview' || overviewTimeRange === 'all') return;
    const refresh = () => setOverviewRangeNow(Date.now());
    const initial = window.setTimeout(refresh, 0);
    const timer = window.setInterval(refresh, 60_000);
    return () => { window.clearTimeout(initial); window.clearInterval(timer); };
  }, [view, overviewTimeRange]);

  const rates = useMemo(
    () => [
      ...preferences.customRates,
      ...(analysisMode === 'demo' ? demoRateSnapshots : defaultRateSnapshots),
    ],
    [analysisMode, preferences.customRates],
  );

  useEffect(() => {
    const tick = () => setClockMs(Date.now());
    tick();
    const timer = window.setInterval(tick, 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const loaded = loadPreferences();
      setPreferences(loaded);
      setCurrency(loaded.currency);
      setLivePath(loaded.livePath);
      setPreferencesReady(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!preferencesReady) return;
    savePreferences({ ...preferences, livePath });
  }, [preferences, preferencesReady, livePath]);

  const analysis = useMemo<AnalysisResult>(() => buildAnalysis(sourceEvents, rates, {
      mode: analysisMode,
      sourceLabel,
      errors: sourceErrors,
      necessaryCallIds,
    }), [analysisMode, necessaryCallIds, rates, sourceErrors, sourceEvents, sourceLabel]);

  const applyServerSnapshot = useCallback((
    payload: {
      revision?: string;
      status?: CollectorStatus;
      message?: string;
      events?: AnalysisEvent[];
      errors?: AnalysisResult['errors'];
      sourceLabel?: string;
      path?: string;
    },
    preserveSelection = true,
  ) => {
    if (payload.path) setLivePath(payload.path);
    if (payload.events) {
      setSessionRangeNow(Date.now());
      setOverviewRangeNow(Date.now());
      setSourceEvents(payload.events);
      setSourceErrors(payload.errors ?? []);
      collectorRevision.current = payload.revision;
    }
    if (payload.status === 'collecting' || payload.status === 'stopped' || payload.status === 'error') {
      setAnalysisMode('live');
      setSourceLabel(payload.sourceLabel ?? (payload.path ? '实时目录 · ' + payload.path : '实时采集'));
    }
    if (payload.status) setCollectorStatus(payload.status);
    if (payload.message) setCollectorMessage(payload.message);
    if (!preserveSelection) {
      setSelectedSessionKey(null);
      setSelectedAnomalyId(null);
    }
  }, []);

  useEffect(() => {
    let active = true;
    fetch(COLLECTOR_URL)
      .then(async (response) => {
        if (!active || !response.ok) return;
        const payload = (await response.json()) as {
          status?: CollectorStatus;
          message?: string;
          events?: AnalysisEvent[];
          errors?: AnalysisResult['errors'];
          sourceLabel?: string;
          path?: string;
        };
        if (payload.status === 'collecting' || payload.status === 'stopped') {
          applyServerSnapshot(payload, true);
        } else {
          setCollectorMessage(payload.message ?? '本地只读服务已连接');
        }
        if (active) setCollectorReachable(true);
      })
      .catch(() => {
        if (active) {
          setCollectorReachable(false);
          setCollectorMessage('本机采集服务未连接。请运行 npm run collector，关闭网页也不会停止它');
        }
      });
    return () => {
      active = false;
    };
  }, [applyServerSnapshot]);

  useEffect(() => {
    if (collectorStatus !== 'collecting') return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    async function refresh() {
      try {
        const since = collectorRevision.current;
        const response = await fetch(COLLECTOR_URL + (since ? '?since=' + encodeURIComponent(since) : ''), { signal: controller.signal });
        if (response.ok) {
          const payload = await response.json() as Parameters<typeof applyServerSnapshot>[0];
          if (active) {
            setCollectorReachable(true);
            applyServerSnapshot(payload, true);
          }
        }
      } catch {
        if (active) {
          setCollectorReachable(false);
          setCollectorMessage('采集服务暂时无法连接，服务仍可能在本机运行');
        }
      } finally {
        // A slow snapshot must finish before another request is sent.
        if (active) timer = setTimeout(() => { void refresh(); }, 2000);
      }
    }
    timer = setTimeout(() => { void refresh(); }, 2000);
    return () => { active = false; clearTimeout(timer); controller.abort(); };
  }, [applyServerSnapshot, collectorStatus]);

  const applyDocuments = useCallback(
    async (documents: SourceDocument[], mode: 'history' | 'live', label: string, preserveSelection = false) => {
      const parsed = documents.map((document) =>
        parseJsonl(document.content, {
          provider: document.provider === 'unknown' ? undefined : document.provider,
          sourceFile: document.relativePath ?? document.name,
        }),
      );
      const events = parsed.flatMap((item) => item.events);
      const errors = [
        ...parsed.flatMap((item) => item.errors),
        ...documents
          .filter((document) => document.error)
          .map((document) => ({
            sourceFile: document.relativePath ?? document.name,
            line: 0,
            message: document.error ?? '无法读取文件',
          })),
      ];
      if (!events.length) {
        setSourceEvents([]);
        setSourceErrors(errors.length ? errors : [{ sourceFile: label, line: 0, message: '文件中没有可识别事件' }]);
        setAnalysisMode(mode);
        setSourceLabel(label);
        if (!preserveSelection) {
          setSelectedSessionKey(null);
          setSelectedAnomalyId(null);
        }
        setCollectorStatus('error');
        setCollectorMessage('没有找到可分析的 JSONL 记录');
        return;
      }
      setSourceEvents(events);
      setSourceErrors(errors);
      setAnalysisMode(mode);
      setSourceLabel(label);
      if (!preserveSelection) {
        setSelectedSessionKey(null);
        setSelectedAnomalyId(null);
      }
      setCollectorStatus(mode === 'live' ? 'collecting' : 'stopped');
      setCollectorMessage(errors.length ? '已导入，但有部分记录无法解析' : mode === 'live' ? '实时采集运行中' : '历史复盘已加载');
    },
    [],
  );

  const handleFiles = useCallback(
    async (files: FileList | File[]) => {
      const list = Array.from(files);
      if (!list.length) return;
      setCollectorStatus('loading');
      setCollectorMessage('正在读取所选日志（仅在本机处理）');
      try {
        const documents = await readFileDocuments(list);
        await applyDocuments(documents, 'history', '历史日志 · ' + String(documents.length) + ' 个文件');
      } catch (error) {
        setCollectorStatus('error');
        setCollectorMessage(error instanceof Error ? error.message : '读取日志失败');
      }
    },
    [applyDocuments],
  );

  const handleLiveStart = useCallback(async () => {
    const path = livePath.trim();
    if (!path) {
      setCollectorStatus('error');
      setCollectorMessage('请输入本机日志目录路径，例如 ~/.codex（含 sessions 与 archived_sessions）');
      return;
    }
    setCollectorStatus('loading');
    setCollectorMessage('正在启动本机只读采集');
    try {
      const response = await fetch(COLLECTOR_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'start', path }),
      });
      const payload = (await response.json()) as Parameters<typeof applyServerSnapshot>[0];
      applyServerSnapshot(payload, false);
      setCollectorReachable(true);
      setPreferences((current) => ({ ...current, livePath: path }));
    } catch (error) {
      setCollectorReachable(false);
      setCollectorStatus('error');
      setCollectorMessage(error instanceof Error ? error.message : '无法连接本机采集服务。请先运行 npm run collector');
    }
  }, [applyServerSnapshot, livePath]);

  const stopCollection = useCallback(() => {
    void fetch(COLLECTOR_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'stop' }),
    })
      .then(async (response) => applyServerSnapshot((await response.json()) as Parameters<typeof applyServerSnapshot>[0], true))
      .catch(() => {
        setCollectorStatus('stopped');
        setCollectorMessage('采集已停止；当前结果仍可查看');
      });
  }, [applyServerSnapshot]);

  const clearSession = useCallback(() => {
    void fetch(COLLECTOR_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'clear' }),
    }).catch(() => undefined);
    setSourceEvents([]);
    setSourceErrors([]);
    setAnalysisMode('history');
    setSourceLabel('暂无会话');
    setNecessaryCallIds(new Set());
    setSelectedSessionKey(null);
    setSelectedAnomalyId(null);
    setCollectorStatus('idle');
    setCollectorMessage('本次临时数据已清除；费率偏好仍保留');
    clearSessionOnly();
  }, []);

  const toggleNecessary = useCallback((callIds: string[]) => {
    setNecessaryCallIds((current) => {
      const next = new Set(current);
      const allMarked = callIds.length > 0 && callIds.every((id) => next.has(id));
      callIds.forEach((id) => {
        if (allMarked) next.delete(id);
        else next.add(id);
      });
      return next;
    });
  }, []);

  const setCurrencyAndSave = useCallback((next: Currency) => {
    setCurrency(next);
    setPreferences((current) => ({ ...current, currency: next }));
  }, []);

  const toggleCollapse = useCallback((session: AnalysisSession) => {
    const key = sessionCollapseKey(session);
    setCollapsedSessionIds((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === '/' && shouldHandleEscape(event.target) && !event.metaKey && !event.ctrlKey && !event.altKey) {
        setView('sessions');
        window.setTimeout(() => sessionSearchRef.current?.focus(), 0);
        event.preventDefault();
        return;
      }
      if (event.key !== 'Escape') return;
      if (!shouldHandleEscape(event.target)) return;
      if (expandedCallId) {
        setExpandedCallId(null);
        event.preventDefault();
        return;
      }
      if (selectedAnomalyId) {
        setSelectedAnomalyId(null);
        event.preventDefault();
        return;
      }
      if (selectedSessionKey) {
        setSelectedSessionKey(null);
        event.preventDefault();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [expandedCallId, selectedAnomalyId, selectedSessionKey]);

  const visibleSessions = useMemo(() => {
    const filtered = analysis.sessions.filter(
      (session) => providerFilter === 'all' || session.provider === providerFilter,
    );
    return [...filtered].sort((left, right) => {
      if (sessionSort === 'tokens') {
        return compareDescending(left.inclusiveUsage.totalTokens, right.inclusiveUsage.totalTokens);
      }
      if (sessionSort === 'cost') {
        return compareDescending(left.inclusiveCost[currency], right.inclusiveCost[currency]);
      }
      if (sessionSort === 'growth') {
        return compareSessionGrowth(left, right);
      }
      return compareDescending(
        left.lastDataAt ? Date.parse(left.lastDataAt) : undefined,
        right.lastDataAt ? Date.parse(right.lastDataAt) : undefined,
      );
    });
  }, [analysis.sessions, currency, providerFilter, sessionSort]);
  const visibleAnomalies = useMemo(
    () =>
      analysis.anomalies.filter(
        (anomaly) => providerFilter === 'all' || anomaly.provider === providerFilter,
      ),
    [analysis.anomalies, providerFilter],
  );
  const selectedSession = findSessionByKey(analysis.sessions, selectedSessionKey);
  const contextInventories = useMemo(() => contextInventoryIndex(analysis.events), [analysis.events]);
  const callContents = useMemo(
    () => callContentIndex(eventsForSession(analysis.events, selectedSession)),
    [analysis.events, selectedSession],
  );
  const candidateCost = displayCost(analysis.candidateCost, currency);
  const overviewAnalysis = useMemo(() => {
    const hours = SESSION_TIME_RANGES.find((range) => range.value === overviewTimeRange)?.hours;
    return scopeAnalysis(analysis, {
      provider: providerFilter === 'all' ? undefined : providerFilter,
      ...(hours === undefined ? {} : { since: overviewRangeNow - hours * 3_600_000, until: overviewRangeNow }),
    });
  }, [analysis, overviewTimeRange, overviewRangeNow, providerFilter]);

  const composition = useMemo(() => aggregateTokenComposition(overviewAnalysis.calls), [overviewAnalysis.calls]);
  const behaviors = useMemo(() => behaviorShares(overviewAnalysis.calls), [overviewAnalysis.calls]);

  const trend = useMemo(() => {
    const suspectIds = optimizableCallIds(overviewAnalysis.anomalies, overviewAnalysis.necessaryCallIds);
    const hourly = overviewTimeRange === '5h' || overviewTimeRange === '1d';
    const bucketMap = new Map<string, AnalysisEvent[]>();
    for (const call of overviewAnalysis.calls) {
      const parsed = call.timestamp ? new Date(call.timestamp) : null;
      if (!parsed || Number.isNaN(parsed.getTime())) continue;
      const day = [parsed.getFullYear(), String(parsed.getMonth() + 1).padStart(2, '0'), String(parsed.getDate()).padStart(2, '0')].join('-');
      const key = hourly ? day + ' ' + String(parsed.getHours()).padStart(2, '0') + ':00' : day;
      const current = bucketMap.get(key) ?? [];
      current.push(call);
      bucketMap.set(key, current);
    }
    const entries = [...bucketMap.entries()].sort(([left], [right]) => left.localeCompare(right));
    const values = entries.map(([key, calls]) => {
      const usage = calls.reduce((sum, call) => sum + usageTokenCount(call.usage), 0);
      const cost = costForCalls(calls, rates);
      const amount = trendMetric === 'tokens' ? usage : cost[trendMetric];
      const known = trendMetric === 'tokens' || amount !== undefined;
      const suspectUsage = calls
        .filter((call) => suspectIds.has(call.id))
        .reduce((sum, call) => sum + usageTokenCount(call.usage), 0);
      return {
        key,
        label: hourly ? key.slice(11) : key.slice(5).replace('-', '/'),
        calls,
        value: amount,
        known,
        usage,
        cost,
        suspectShare: usage ? suspectUsage / usage : 0,
      };
    });
    const max = Math.max(...values.map((item) => (item.known ? item.value ?? 0 : 0)), 1);
    return values.map((item) => {
      const numeric = item.known ? (item.value ?? 0) : 0;
      const height = item.known && numeric > 0 ? Math.max(2, Math.round((numeric / max) * 100)) : 0;
      return {
        ...item,
        height,
        suspectHeight: Math.round(height * item.suspectShare),
      };
    });
  }, [overviewAnalysis.anomalies, overviewAnalysis.calls, overviewAnalysis.necessaryCallIds, rates, trendMetric, overviewTimeRange]);

  const modeLabel = analysisMode === 'demo' ? '演示数据' : analysisMode === 'live' ? '实时采集' : '历史复盘';
  const navAnomalyCount = visibleAnomalies.length;
  const collectorConnection: CollectorConnection =
    collectorReachable === false && collectorStatus === 'collecting' ? 'error'
      : collectorReachable === false && collectorStatus !== 'loading' ? 'unreachable'
        : collectorStatus;
  const freshness = dataFreshness(analysis.lastDataAt, clockMs);
  const connectionKind = collectorConnection === 'collecting' ? 'live'
    : collectorConnection === 'error' || collectorConnection === 'unreachable' ? 'error'
      : collectorConnection === 'loading' ? 'warn'
        : collectorConnection === 'stopped' ? 'quiet'
          : 'idle';
  const freshnessReady = clockMs > 0;
  const freshnessKind = !freshnessReady ? 'unknown'
    : freshness === 'live' ? 'live'
      : freshness === 'quiet' ? 'quiet'
        : freshness === 'stale' ? 'stale'
          : 'unknown';
  const freshnessChipLabel = !freshnessReady
    ? (analysis.lastDataAt ? '最后数据 ' + formatRelativeTime(analysis.lastDataAt) : '尚无数据时间')
    : dataFreshnessLabel(freshness, collectorStatus === 'collecting');
  function openSession(session: AnalysisSession, context?: ContextCategory, section?: typeof detailSection) {
    setExpandedCallId(null);
    setSelectedSessionKey(sessionCollapseKey(session));
    setDetailSection(context ? 'context' : section ?? 'summary');
    if (context) setContextCategory(context);
    setTimelinePage(1);
    setChildPage(1);
    setTimelineScope('model');
    setView('sessions');
    window.scrollTo({ top: 0 });
  }

  function openAnomalySession(anomaly: Anomaly) {
    const session = analysis.sessions.find((item) => item.id === anomaly.sessionId && item.provider === anomaly.provider);
    setSelectedAnomalyId(anomaly.id);
    if (session) openSession(session, undefined, 'evidence');
    else setView('insights');
  }

  function filterProvider(provider: Provider | 'all') {
    setProviderFilter(provider);
    setSessionPage(1);
    setSubagentPage(1);
    setSelectedSessionKey(null);
  }

  function renderSessionTable(
    sessions: AnalysisSession[],
    forest?: SessionForest<AnalysisSession>,
    roots?: AnalysisSession[],
    options?: { present?: { has(key: string): boolean }; childList?: boolean },
  ) {
    const tree = forest ?? sessionForest(sessions);
    const rows = sessionTreeRows(sessions, collapsedSessionIds, tree, roots);
    const present = options?.present ?? tree.byKey;
    return <div className="table-wrap session-table-viewport"><table role="treegrid" aria-label="会话树">
      <thead><tr><th>目录 - Session</th><th>Agent</th><th>自身 Token</th><th>含子会话</th><th>预估费用</th><th>最近增速</th><th>Tools 字符</th><th>Skills 字符</th><th>最近数据</th></tr></thead>
      <tbody>{rows.length ? rows.map(({ session, depth, childCount }) => {
        const cost = displayCost(session.inclusiveCost, currency);
        const active = sessionIsActive(session, clockMs);
        const growth = formatGrowthDisplay(sessionGrowthRate(session), active);
        const collapsed = collapsedSessionIds.has(sessionCollapseKey(session));
        const parentPresent = sessionParentPresent(session, present);
        const role = sessionRoleLabel(session, depth, { parentPresent, childList: options?.childList });
        return <tr key={sessionCollapseKey(session)} className={depth ? 'child-session-row' : undefined} role="row" aria-level={depth + 1} aria-expanded={childCount > 0 ? !collapsed : undefined}>
          <td>
            <div className={'session-name-cell' + (depth ? ' child-session' : '')} style={depth > 1 ? { paddingLeft: 22 + (depth - 1) * 16 } : undefined}>
              {childCount > 0
                ? <button className={'tree-toggle' + (collapsed ? '' : ' expanded')} aria-expanded={!collapsed} aria-label={collapsed ? '展开子会话' : '折叠子会话'} onClick={() => toggleCollapse(session)}>▸</button>
                : <span className="tree-branch">{depth ? '└' : ''}</span>}
              <button className="session-link" title={sessionDisplayName(session)} onClick={() => openSession(session)}>
                <strong>{sessionDisplayName(session)}</strong>
                <small>{role} · {session.id}{sessionCompletenessCaption(session.completeness) ? ' · ' + sessionCompletenessCaption(session.completeness) : ''}</small>
              </button>
            </div>
          </td>
          <td><SourceBadge provider={session.provider} /></td>
          <td className="mono" title={formatExactTokenCount(session.ownUsage.totalTokens)} aria-label={formatExactTokenCount(session.ownUsage.totalTokens)}><TokenFigure value={session.ownUsage.totalTokens} /></td>
          <td className="mono" title={formatExactTokenCount(session.inclusiveUsage.totalTokens)} aria-label={formatExactTokenCount(session.inclusiveUsage.totalTokens)}><TokenFigure value={session.inclusiveUsage.totalTokens} /></td>
          <td className={'mono cost-' + cost.tone} title={cost.note}>{cost.value}<small>{cost.note}</small></td>
          <td className={'mono growth-cell' + (growth.badge === '当前' ? ' growth-live' : '')} title={growth.caption} aria-label={growth.caption}>
            {clockMs > 0 && growth.badge && <span className={'growth-badge growth-' + (growth.badge === '当前' ? 'live' : 'past')}>{growth.badge}</span>}
            {growth.value}
          </td>
          {(['tools', 'skills'] as const).map((category) => {
            const snapshot = contextInventories.get(contextSessionKey(session.provider, session.id))?.[category]?.contextSnapshot;
            return <td key={category}><button className="context-length-link mono" title="最近记录的定义 / 目录字符数，点击查看组成；非 Token 用量" aria-label={category + ' 上下文 · ' + sessionDisplayName(session)} onClick={() => openSession(session, category)}>{snapshot ? snapshot.chars.toLocaleString('en-US') : '未知'}<small>查看组成 ↗</small></button></td>;
          })}
          <td>{formatRelativeTime(session.lastDataAt)}</td>
        </tr>;
      }) : <tr><td colSpan={9}><EmptyState title="还没有会话" description="导入日志或开始本机采集后查看。" /></td></tr>}</tbody>
    </table></div>;
  }

  function renderSessionRows(sessions: AnalysisSession[], forest?: SessionForest<AnalysisSession>) {
    if (!sessions.length) return <EmptyState title="当前范围内没有会话" description="请选择更长的时间范围、切换 Agent 或导入会话日志。" />;
    const tree = forest ?? sessionForest(sessions);
    const recentRoots = tree.roots.slice(0, 8);
    return <>
      {renderSessionTable(sessions, tree, recentRoots)}
      {tree.roots.length > recentRoots.length && <p className="table-more-note">已显示最近 {recentRoots.length} 个入口会话（共 {tree.roots.length} 个）。子会话按归属展开，不能再与含子会话合计相加。</p>}
    </>;
  }

  function renderCallDetails(session?: Pick<AnalysisSession, 'id' | 'provider'>) {
    const events = eventsForSession(analysis.events, session).filter((event) => timelineScope === 'all' || event.kind === 'model').reverse();
    const page = paginate(events, timelinePage, 20);
    if (!events.length) return <EmptyState title="暂无调用明细" description="当前来源还没有可辨识的模型调用记录。" />;
    const hasCacheWrites = events.some((event) => (event.usage?.cacheCreationInputTokens ?? 0) > 0);
    const columnCount = hasCacheWrites ? 10 : 9;
    const trendValues = page.items.filter((event) => event.kind === 'model' && event.usage).map((event) => tokenComposition(event.usage)!.total).reverse();
    const maximum = Math.max(...trendValues, 1);
    const points = trendValues.map((value, index) => ((index / Math.max(1, trendValues.length - 1)) * 160) + ',' + (32 - value / maximum * 28)).join(' ');
    const count = (value?: number) => value === undefined ? '—' : value.toLocaleString('en-US');
    const time = (timestamp: string) => {
      const date = new Date(timestamp);
      return Number.isNaN(date.getTime()) ? '时间未知' : date.toLocaleTimeString('zh-CN', { hour12: false });
    };
    return <section className="call-ledger" aria-label="调用明细表">
      <div className="call-ledger-heading">
        <div><h3>{timelineScope === 'model' ? '模型调用' : '事件'} ({events.length})</h3>
          {trendValues.length > 1 && <svg className="call-sparkline" viewBox="0 0 160 36" role="img" aria-label="当前页 Token 趋势，时间从左到右"><polyline points={points} /></svg>}
        </div>
        <div className="token-legend"><span><i className="token-uncached" />未缓存</span><span><i className="token-cached" />缓存</span>{hasCacheWrites && <span><i className="token-cache-write" />缓存写入</span>}<span><i className="token-output" />输出</span></div>
      </div>
      <Pagination {...page} onChange={(next) => { setTimelinePage(next); setExpandedCallId(null); }} label="调用明细分页" />
      <div className="call-table-viewport" key={page.page} tabIndex={0} role="region" aria-label="调用明细，可横向滚动">
        <table className="call-table">
          <thead><tr><th scope="col">时间</th><th scope="col">工具</th><th scope="col">内容 / 提示</th><th scope="col">构成</th><th scope="col">未缓存</th><th scope="col">缓存</th>{hasCacheWrites && <th scope="col">缓存写入</th>}<th scope="col">输出</th><th scope="col">Credits</th><th scope="col">$</th></tr></thead>
          <tbody>{page.items.map((event) => {
            const content = callContents.get(event.id);
            const composition = tokenComposition(event.usage);
            const cost = event.kind === 'model' ? costForCalls([event], rates) : undefined;
            const summary = content?.prompt || content?.reply || event.text || event.toolInput || content?.operations.join('; ') || '来源未记录内容摘录';
            const tools = event.toolName || [...new Set(content?.operations.map((operation) => operation.split(' · ')[0]) ?? [])].join(', ') || '—';
            const open = expandedCallId === event.id;
            const parts = composition ? [
              { name: '未缓存', key: 'uncached', value: composition.uncached },
              { name: '缓存', key: 'cached', value: composition.cached },
              { name: '缓存写入', key: 'cache-write', value: composition.cacheWrite },
              { name: '输出', key: 'output', value: composition.output },
            ] : [];
            return <Fragment key={event.id}>
              <tr className={'call-data-row' + (open ? ' row-selected' : '')}>
                <td className="mono" title={formatDateTime(event.timestamp)}>{time(event.timestamp)}</td>
                <td className="call-tool-cell" title={tools}>{tools}</td>
                <td className="call-prompt-cell"><button className="call-prompt" title={summary} aria-expanded={open} aria-controls={'call-excerpt-' + event.id} onClick={() => setExpandedCallId(open ? null : event.id)}><span aria-hidden="true">{open ? '▾' : '▸'}</span>{summary}</button></td>
                <td>{composition ? <div className="token-stack" role="img" aria-label={parts.map((part) => part.name + ' ' + count(part.value)).join('，')} title={parts.map((part) => part.name + ': ' + count(part.value)).join(' · ')}>
                  {parts.filter((part) => part.value > 0).map((part) => <i key={part.key} className={'token-' + part.key} style={{ width: (composition.total ? part.value / composition.total * 100 : 0) + '%' }} />)}
                </div> : <span className="muted">—</span>}</td>
                <td className="mono numeric">{count(composition?.uncached)}</td>
                <td className="mono numeric">{count(composition?.cached)}</td>
                {hasCacheWrites && <td className="mono numeric">{count(composition?.cacheWrite)}</td>}
                <td className="mono numeric">{count(composition?.output)}</td>
                <td className="mono numeric" title={cost?.basis || '无可计价用量'}>{formatCallAmount(cost?.credits, 'credits')}</td>
                <td className="mono numeric" title={cost?.usd === undefined ? '暂无适用的美元费率或来源费用' : cost.basis}>{formatCallAmount(cost?.usd, 'usd')}</td>
              </tr>
              {open && <tr className="call-expanded-row"><td colSpan={columnCount}><div id={'call-excerpt-' + event.id}>
                <div className="call-excerpt-heading"><strong>{eventLabel(event)} · {event.model || '模型未记录'}</strong><span>{formatDateTime(event.timestamp)}</span><button className="text-button" onClick={() => setExpandedCallId(null)}>收起摘录</button></div>
                <EventContent event={event} content={content} expanded />
                <p className="call-source">{event.sourceFile} · 第 {event.sourceLine} 行</p>
              </div></td></tr>}
            </Fragment>;
          })}</tbody>
        </table>
      </div>
      <p className="call-ledger-note">每行是一条可辨识调用，不等同于一次用户提问。费用为估算；— 表示未记录或费率未知。输出已包含可计费推理，缓存不重复相加。</p>
    </section>;
  }

  function renderOverview() {
    const sessions = [...overviewAnalysis.sessions].sort((left, right) =>
      (Date.parse(right.lastDataAt ?? '') || 0) - (Date.parse(left.lastDataAt ?? '') || 0));
    const overviewTotal = displayCost(overviewAnalysis.cost, currency);
    const overviewCandidate = displayCost(overviewAnalysis.candidateCost, currency);
    const share = candidateShare(overviewAnalysis.cost, overviewAnalysis.candidateCost, currency);
    const compositionParts = composition.parts.filter((part) => part.tokens > 0);
    const compositionStops = compositionParts.map((part) => part.percent).reduce<number[]>((parts, percent) => [...parts, (parts.at(-1) ?? 0) + percent], []);
    const donut = composition.total > 0
      ? compositionParts.map((part, index) => {
          const start = index === 0 ? 0 : compositionStops[index - 1];
          return TOKEN_PART_COLORS[part.key] + ' ' + String(start) + '% ' + String(compositionStops[index]) + '%';
        }).join(', ')
      : '#273022 0% 100%';
    const behaviorTotal = behaviors.reduce((sum, item) => sum + item.tokens, 0);
    const forest = sessionForest(sessions);
    const counts = sessionEntryCounts(sessions, forest);
    const chartMode = trendChartMode(trend);
    const sessionCaption = [
      '入口 ' + String(counts.entries),
      '主会话 ' + String(counts.primary),
      counts.children ? '子会话 ' + String(counts.children) + '（已发现不等于全部）' : '',
      counts.detached ? String(counts.detached) + ' 个父会话不在范围内' : '',
      sourceLabel,
    ].filter(Boolean).join(' · ');
    return <><div className="session-date-filter overview-date-filter">
      <div className="segmented" role="group" aria-label="总览日期筛选">
        {[...SESSION_TIME_RANGES.slice(1), SESSION_TIME_RANGES[0]].map((range) => <button key={range.value} className={overviewTimeRange === range.value ? 'selected' : ''} aria-pressed={overviewTimeRange === range.value} onClick={() => { setOverviewTimeRange(range.value); setOverviewRangeNow(Date.now()); }}>{range.label}</button>)}
      </div>
      <p>按调用记录时间统计所选范围内的消耗，1 天为过去 24 小时；实时范围每分钟更新。{overviewTimeRange !== 'all' && '无有效时间的调用及整会话汇总费用不计入；进入会话详情可查看完整历史。'}</p>
    </div>
    <section className="metrics-grid">
      <MetricCard label="预估总费用" value={overviewTotal.value} caption={costCaption(overviewAnalysis.cost, currency)} icon="◈" title={overviewAnalysis.cost.basis} tone={overviewTotal.tone} badge={completenessLabel(overviewAnalysis)} />
      <MetricCard label="总 Token 用量" value={formatTokenCount(overviewAnalysis.usage.totalTokens)} caption={formatExactTokenCount(overviewAnalysis.usage.totalTokens) + ' · ' + String(overviewAnalysis.calls.length) + ' 个模型调用'} icon="◎" title={'未缓存 ' + formatExactTokenCount(composition.uncached) + ' · 缓存 ' + formatExactTokenCount(composition.cached) + ' · 输出 ' + formatExactTokenCount(composition.output)} />
      <MetricCard label="疑似可优化费用" value={overviewCandidate.value} caption={share.percent === undefined ? share.note : String(share.percent) + '% ' + share.note} icon="↗" accent title="仅计入可计价的纯异常调用，混合、基线与必要操作不在内" tone={overviewCandidate.tone} />
      <MetricCard label="入口会话" value={String(counts.entries)} caption={sessionCaption} icon="▤" />
    </section>
    <section className="charts-grid">
      <article className="panel trend-panel">
        <div className="panel-heading">
          <div><h2>消耗趋势</h2><p>所选范围 · 本地时间 · 未知费用显示为缺口，不按零绘制</p></div>
          <div className="chart-toggle" role="group" aria-label="趋势单位">
            <button className={trendMetric === 'usd' ? 'selected' : ''} onClick={() => setTrendMetric('usd')}>费用</button>
            <button className={trendMetric === 'tokens' ? 'selected' : ''} onClick={() => setTrendMetric('tokens')}>Tokens</button>
            <button className={trendMetric === 'credits' ? 'selected' : ''} onClick={() => setTrendMetric('credits')}>Credits</button>
          </div>
        </div>
        <div className="chart-legend">
          <span><i className="legend-work" />已记录用量</span>
          <span><i className="legend-suspect" />疑似可优化调用</span>
          <span><i className="legend-unknown" />费用未知</span>
          <span className="chart-unit">{trendMetric === 'tokens' ? 'tokens' : trendMetric === 'credits' ? 'credits' : 'USD'}</span>
        </div>
        {chartMode === 'chart' ? <div className="bar-chart" aria-label="所选时间范围消耗趋势">
          <div className="bar-grid"><i /><i /><i /><i /><i /></div>
          <div className="bar-series" style={{ minWidth: trend.length * 38 }}>
            {trend.map((item) => {
              const title = item.key + ' · ' + formatExactTokenCount(item.usage) + ' tokens'
                + (item.known && item.value !== undefined
                  ? ' · ' + (trendMetric === 'tokens' ? formatTokenCount(item.value) : displayCost(item.cost, trendMetric === 'credits' ? 'credits' : 'usd').value)
                  : ' · 费用未知');
              return <div className="bar-column-wrap" key={item.key} title={title}>
                {item.known
                  ? <div className="bar-column" style={{ height: item.height + '%', minHeight: 0 }}><span className="bar-suspect" style={{ height: item.suspectHeight + '%' }} /><span className="bar-work" /></div>
                  : <div className="bar-column bar-unknown" aria-label="费用未知" />}
                <small>{item.label}</small>
              </div>;
            })}
          </div>
        </div> : <EmptyState title={chartMode === 'unknown-only' ? '当前范围费用未知' : '当前范围暂无可绘制数据'} description="可切换 Tokens、延长时间范围或检查适用费率；未知费用不按零费用或 Credits 替代。" />}
        <div className="chart-footnote"><span className="status-dot" />最后数据：{formatRelativeTime(overviewAnalysis.lastDataAt)}<button className="text-button" onClick={() => setView('sessions')}>查看每轮明细 ↗</button></div>
      </article>
      <article className="panel allocation-panel">
        <div className="panel-heading">
          <div><h2>Token 构成</h2><p>未缓存 / 缓存读取 / 缓存写入 / 输出，互斥分项</p></div>
          <span className="info-icon" title="缓存读取不重复计入未缓存输入；推理已含在输出中时不再加一次">i</span>
        </div>
        <div className="allocation-content">
          <div className="donut" style={{ background: 'conic-gradient(' + donut + ')' }} title={formatExactTokenCount(overviewAnalysis.usage.totalTokens) + ' tokens'}>
            <div><span>总用量</span><strong><TokenFigure value={overviewAnalysis.usage.totalTokens} /></strong><span>tokens</span></div>
          </div>
          <div className="allocation-legend">
            {composition.parts.filter((part) => part.tokens > 0 || composition.total === 0).map((part) => (
              <div key={part.key}><span><i style={{ background: TOKEN_PART_COLORS[part.key] }} />{part.label}</span><strong title={formatExactTokenCount(part.tokens)}>{formatSharePercent(part.percent, part.tokens)}</strong></div>
            ))}
          </div>
        </div>
        <div className="behavior-stack" aria-label="行为归因，非互斥账单分类">
          <div className="behavior-stack-label">行为归因（推断，百分比合计 100%，不是账单分类）</div>
          <div className="behavior-bar">
            {behaviors.filter((item) => item.tokens > 0).map((item) => (
              <span key={item.key} style={{ width: item.percent + '%', background: BEHAVIOR_COLORS[item.key] }} title={item.label + ' · ' + formatExactTokenCount(item.tokens) + ' · ' + formatSharePercent(item.percent, item.tokens)} />
            ))}
          </div>
          <div className="behavior-legend">
            {behaviors.filter((item) => item.tokens > 0).map((item) => (
              <span key={item.key}><i style={{ background: BEHAVIOR_COLORS[item.key] }} />{item.label} {formatSharePercent(item.percent, item.tokens)}</span>
            ))}
            {!behaviorTotal && <span className="muted">暂无已记录用量</span>}
          </div>
        </div>
        <div className="allocation-note">{overviewAnalysis.completeness === 'complete' ? '当前分析范围内可确认' : '部分记录缺失，百分比只覆盖已知用量'}</div>
      </article>
    </section>
    <section className="section-block">
      <div className="section-heading"><h2><span className="section-icon amber">⌁</span> 值得关注 <span className="count-badge">{overviewAnalysis.anomalies.length} 类异常</span></h2><button className="text-button" onClick={() => setView('insights')}>查看全部洞察 ↗</button></div>
      {overviewAnalysis.anomalies.length ? <div className="insight-grid">{overviewAnalysis.anomalies.slice(0, 3).map((anomaly) => <AnomalyCard key={anomaly.id} anomaly={anomaly} analysis={overviewAnalysis} currency={currency} onToggleNecessary={toggleNecessary} onSelect={() => { setSelectedAnomalyId(anomaly.id); setView('insights'); }} selected={selectedAnomalyId === anomaly.id} onOpenSession={() => openAnomalySession(anomaly)} />)}</div> : <div className="panel"><EmptyState title="暂无已确认异常" description="满足完整证据条件的重复读取、轮询或压缩循环会在这里出现。" /></div>}
    </section>
    <section className="panel sessions-panel">
      <div className="panel-heading"><div className="inline-heading"><h2>范围内最近会话</h2><span className="count-badge">{counts.entries} 入口</span></div><button className="text-button" onClick={() => { setSelectedSessionKey(null); setView('sessions'); }}>查看所有会话 ↗</button></div>
      {renderSessionRows(sessions, forest)}
    </section></>;
  }

  function renderSessionsView() {
    const filteredSessions = sessionsInTimeRange(visibleSessions, sessionTimeRange, sessionRangeNow);
    const forest = sessionForest(filteredSessions);
    const matchingRoots = rootsMatchingQuery(filteredSessions, sessionQuery, forest);
    const page = paginate(matchingRoots, sessionPage, 15);
    if (!selectedSession) return <section className="view-stack">
      <div className="view-intro">
        <div><span className="eyebrow">SESSION LEDGER</span><h2>会话记录</h2><p>按入口会话分页。子会话可展开。点击名称进入详情；/ 搜索，Esc 返回列表。</p></div>
        <div className="view-intro-actions">
          <label className="session-search">
            <span className="visually-hidden">搜索会话</span>
            <input ref={sessionSearchRef} value={sessionQuery} onChange={(event) => { setSessionQuery(event.target.value); setSessionPage(1); }} placeholder="搜索目录、标题或 ID" aria-label="搜索会话" />
          </label>
          <label className="sort-control">排序<select aria-label="会话排序" value={sessionSort} onChange={(event) => { setSessionSort(event.target.value as SessionSort); setSessionPage(1); setSubagentPage(1); }}>
            <option value="updated">最近数据</option><option value="tokens">含子会话 Token</option><option value="cost">可计价费用</option><option value="growth">最近增速</option>
          </select></label>
        </div>
      </div>
      <div className="session-date-filter">
        <div className="segmented" role="group" aria-label="会话日期筛选">
          {SESSION_TIME_RANGES.map((range) => <button key={range.value} className={sessionTimeRange === range.value ? 'selected' : ''} aria-pressed={sessionTimeRange === range.value} onClick={() => { setSessionTimeRange(range.value); setSessionRangeNow(Date.now()); setSessionPage(1); }}>{range.label}</button>)}
        </div>
        <p>按最后记录时间筛选，1 天为过去 24 小时；每分钟更新范围，不裁剪会话用量。</p>
      </div>
      <div className="panel sessions-panel">
        <Pagination {...page} onChange={setSessionPage} label="会话列表分页" unit="个入口会话" />
        {sessionQuery.trim() && !matchingRoots.length
          ? <EmptyState title="没有匹配的会话" description="试试目录名、会话标题或 ID。搜索不会扩大已选日志范围。" />
          : page.items.length || sessionTimeRange === 'all'
            ? renderSessionTable(filteredSessions, forest, page.items)
            : <EmptyState title="当前时间范围内没有会话" description="请选择更长的时间范围或“全部”。没有有效时间的会话仅在“全部”中显示。" />}
      </div>
    </section>;

    const children = analysis.sessions.filter((session) => session.parentSessionId === selectedSession.id && session.provider === selectedSession.provider);
    const childRows = paginate(children, childPage, 15);
    const anomalies = visibleAnomalies.filter((anomaly) => anomalyBelongsToSession(anomaly, selectedSession));
    return <section className="view-stack session-detail">
      <button className="text-button back-to-sessions" onClick={() => { setSelectedSessionKey(null); window.scrollTo({ top: 0 }); }}>← 返回会话列表（第 {page.page} 页）· Esc</button>
      <article className="panel detail-panel">
        <div className="panel-heading session-detail-heading">
          <div><span className="eyebrow">SESSION DETAIL</span><h2 title={sessionDisplayName(selectedSession)}>{sessionDisplayName(selectedSession)}</h2>
            <details className="session-metadata"><summary>会话信息 · {selectedSession.id.slice(0, 8)}</summary>
              <div><p>{selectedSession.title === selectedSession.id ? '未命名会话' : selectedSession.title}</p><p>目录：{selectedSession.cwd || '来源未记录'}</p><p>ID：{selectedSession.id}</p></div>
            </details>
          </div><SourceBadge provider={selectedSession.provider} />
        </div>
        <div className="detail-stats">
          <div><span>自身 Token</span><strong aria-label={formatExactTokenCount(selectedSession.ownUsage.totalTokens)}><TokenFigure value={selectedSession.ownUsage.totalTokens} /></strong></div>
          <div><span>含子会话 Token</span><strong aria-label={formatExactTokenCount(selectedSession.inclusiveUsage.totalTokens)}><TokenFigure value={selectedSession.inclusiveUsage.totalTokens} /></strong></div>
          <div><span>预估费用 · 含子会话</span><strong>{displayCost(selectedSession.inclusiveCost, currency).value}</strong><small>{displayCost(selectedSession.inclusiveCost, currency).note}</small></div>
        </div>
        {sessionCompletenessCaption(selectedSession.completeness) && <p className="detail-note">{sessionCompletenessCaption(selectedSession.completeness)}：已知小计仍可查看，未知内容不会被填成零。</p>}
        <div className="detail-navigation" role="group" aria-label="会话详情分区">
          <button aria-pressed={detailSection === 'summary'} onClick={() => setDetailSection('summary')}>概览</button>
          <button aria-pressed={detailSection === 'calls'} onClick={() => setDetailSection('calls')}>调用明细</button>
          <button aria-pressed={detailSection === 'context'} onClick={() => setDetailSection('context')}>Tools / Skills 上下文</button>
          <button aria-pressed={detailSection === 'children'} onClick={() => setDetailSection('children')}>子会话 ({children.length})</button>
          <button aria-pressed={detailSection === 'evidence'} onClick={() => setDetailSection('evidence')}>异常证据 ({anomalies.length})</button>
        </div>
        {detailSection === 'summary' && <div className="detail-summary">
          <SessionCostTree session={selectedSession} childSessions={children} rates={rates} currency={currency} />
          <p className="detail-note">行为归因仅用于解释自身消耗，不代表每项都能优化。含子会话合计不可再与子会话明细相加。</p>
        </div>}
        {detailSection === 'context' && <SessionContextPanel key={sessionCollapseKey(selectedSession)} inventory={contextInventories.get(contextSessionKey(selectedSession.provider, selectedSession.id))} category={contextCategory} onCategory={setContextCategory} />}
        {detailSection === 'calls' && <div className="timeline-wrap">
          <div className="timeline-controls"><span>仅当前会话 · 最新记录在前 · 每页 20 条</span>
            <label className="sort-control">类型<select aria-label="明细事件类型" value={timelineScope} onChange={(event) => { setTimelineScope(event.target.value as 'model' | 'all'); setTimelinePage(1); setExpandedCallId(null); }}>
              <option value="model">模型调用</option><option value="all">全部事件</option>
            </select></label>
          </div>{renderCallDetails(selectedSession)}
        </div>}
        {detailSection === 'children' && <div className="sessions-panel">
          <Pagination {...childRows} onChange={setChildPage} label="直属子会话分页" unit="个子会话" />
          {children.length ? renderSessionTable(childRows.items, undefined, undefined, { present: new Set(analysis.sessions.map(sessionCollapseKey)), childList: true }) : <EmptyState title="没有直属子会话" description="仅展示日志中有明确归属记录的子会话。" />}
        </div>}
        {detailSection === 'evidence' && <div className="compact-anomalies detail-scroll">
          {anomalies.map((anomaly) => <AnomalyCard key={anomaly.id} anomaly={anomaly} analysis={analysis} currency={currency} onToggleNecessary={toggleNecessary} onSelect={() => setSelectedAnomalyId(anomaly.id)} selected={selectedAnomalyId === anomaly.id} />)}
          {!anomalies.length && <EmptyState title="暂无异常证据" description="正常工作、证据不足或数据不完整都不会被强行标记。" />}
        </div>}
      </article>
    </section>;
  }

  function renderInsightsView() {
    return <section className="view-stack">
      <div className="view-intro">
        <div><span className="eyebrow">EVIDENCE FIRST</span><h2>异常洞察</h2><p>重复并不等于浪费。卡片上的「疑似可优化」才进入汇总；「关联调用费用」含基线与混合，二者不可相加。</p></div>
        <div className="inline-summary"><span>{visibleAnomalies.length} 个模式</span><span>{candidateCost.value} 疑似可优化</span></div>
      </div>
      <div className="insight-list">{visibleAnomalies.length ? visibleAnomalies.map((anomaly) => (
        <AnomalyCard
          key={anomaly.id}
          anomaly={anomaly}
          analysis={analysis}
          currency={currency}
          onToggleNecessary={toggleNecessary}
          onSelect={() => setSelectedAnomalyId(selectedAnomalyId === anomaly.id ? null : anomaly.id)}
          selected={selectedAnomalyId === anomaly.id}
          onOpenSession={() => openAnomalySession(anomaly)}
        />
      )) : <div className="panel"><EmptyState title="暂无完整异常模式" description="导入日志后，满足初始规则的模式会带着证据出现在这里。" /></div>}</div>
    </section>;
  }

  function renderSubagentsView() {
    const children = visibleSessions.filter((session) => session.parentSessionId);
    const page = paginate(children, subagentPage, 15);
    return <section className="view-stack">
      <div className="view-intro"><div><span className="eyebrow">CHILD SESSIONS</span><h2>子 Agent</h2><p>每页 15 个子会话。仅按明确归属证据展示，不按目录或时间猜测关系。</p></div></div>
      <div className="panel sessions-panel"><Pagination {...page} onChange={setSubagentPage} label="子 Agent 分页" unit="个子会话" />{renderSessionTable(page.items, undefined, undefined, { present: new Set(visibleSessions.map(sessionCollapseKey)), childList: true })}</div>
      <div className="panel callout-panel"><span className="callout-icon">i</span><div><strong>自身用量与含子会话合计是两个视图</strong><p>含子会话的费用不能再与子会话明细相加。</p></div></div>
    </section>;
  }

  function renderSettingsView() {
    const allRates = [...preferences.customRates, ...(analysisMode === 'demo' ? demoRateSnapshots : defaultRateSnapshots)];
    function addRate(event: React.FormEvent<HTMLFormElement>) {
      event.preventDefault();
      const inputText = rateDraft.input.trim();
      const cachedText = rateDraft.cached.trim();
      const outputText = rateDraft.output.trim();
      const input = Number(inputText);
      const cached = Number(cachedText);
      const output = Number(outputText);
      if (!rateDraft.modelPattern.trim() || !inputText || !cachedText || !outputText || !Number.isFinite(input) || !Number.isFinite(cached) || !Number.isFinite(output) || input < 0 || cached < 0 || output < 0) {
        setCollectorMessage('请填写有效的非负费率');
        return;
      }
      const next: RateSnapshot = {
        id: 'custom-' + String(Date.now()),
        provider: rateDraft.provider,
        modelPattern: rateDraft.modelPattern.trim(),
        source: rateDraft.source.trim() || '用户自定义费率',
        checkedDate: new Date().toISOString().slice(0, 10),
        applicability: '用户提供的适用条件',
        kind: 'custom',
        ...(rateDraft.unit === 'usd' ? { inputUsdPerMillion: input, cachedInputUsdPerMillion: cached, outputUsdPerMillion: output } : { inputCreditsPerMillion: input, cachedInputCreditsPerMillion: cached, outputCreditsPerMillion: output }),
      };
      setPreferences((current) => ({ ...current, customRates: [next, ...current.customRates] }));
      setRateDraft((current) => ({ ...current, input: '', cached: '', output: '' }));
      setCollectorMessage('自定义费率已保存；它只影响后续本地估算');
    }
    return <section className="view-stack"><div className="view-intro"><div><span className="eyebrow">LOCAL PREFERENCES</span><h2>计费与规则</h2><p>费用是基于已记录用量和适用费率的估算，不是官方账单。</p></div><div className="currency-switch" role="group" aria-label="默认货币单位"><button className={currency === 'usd' ? 'selected' : ''} onClick={() => setCurrencyAndSave('usd')}>USD</button><button className={currency === 'credits' ? 'selected' : ''} onClick={() => setCurrencyAndSave('credits')}>Credits</button></div></div><div className="settings-grid"><article className="panel settings-panel"><div className="panel-heading"><div><h2>费率快照</h2><p>官方快照与用户自定义依据分开显示</p></div></div><div className="rate-list">{allRates.map((rate) => <div className="rate-row" key={rate.id}><div><SourceBadge provider={rate.provider} /><strong>{rate.modelPattern}</strong><small>{rate.source} · 核对于 {rate.checkedDate}</small></div><div className="rate-values">{rate.inputUsdPerMillion !== undefined && <span>{'$' + String(rate.inputUsdPerMillion)}/M input</span>}{rate.inputCreditsPerMillion !== undefined && <span>{rate.inputCreditsPerMillion} credits/M input</span>}<small>{rate.kind === 'custom' ? '自定义' : '官方快照'}</small></div>{rate.kind === 'custom' && <button className="icon-button" onClick={() => setPreferences((current) => ({ ...current, customRates: current.customRates.filter((item) => item.id !== rate.id) }))} aria-label={'删除 ' + rate.modelPattern}>×</button>}</div>)}{!allRates.length && <EmptyState title="暂无费率" description="未知费率仍可查看 Token 和异常证据。" />}</div></article><article className="panel settings-panel"><div className="panel-heading"><div><h2>添加自定义费率</h2><p>金额按每百万 Token 录入</p></div></div><form className="rate-form" onSubmit={addRate}><label>来源<select value={rateDraft.provider} onChange={(event) => setRateDraft((current) => ({ ...current, provider: event.target.value as Provider }))}><option value="codex">Codex</option><option value="claude">Claude Code</option><option value="unknown">未知来源</option></select></label><label>模型匹配<input value={rateDraft.modelPattern} onChange={(event) => setRateDraft((current) => ({ ...current, modelPattern: event.target.value }))} placeholder="例如 claude-sonnet-4 或 *" /></label><label>单位<select value={rateDraft.unit} onChange={(event) => setRateDraft((current) => ({ ...current, unit: event.target.value as Currency }))}><option value="usd">USD / M</option><option value="credits">Credits / M</option></select></label><div className="rate-input-grid"><label>输入<input inputMode="decimal" value={rateDraft.input} onChange={(event) => setRateDraft((current) => ({ ...current, input: event.target.value }))} placeholder="1.00" /></label><label>缓存输入<input inputMode="decimal" value={rateDraft.cached} onChange={(event) => setRateDraft((current) => ({ ...current, cached: event.target.value }))} placeholder="0.10" /></label><label>输出<input inputMode="decimal" value={rateDraft.output} onChange={(event) => setRateDraft((current) => ({ ...current, output: event.target.value }))} placeholder="5.00" /></label></div><label>依据说明<input value={rateDraft.source} onChange={(event) => setRateDraft((current) => ({ ...current, source: event.target.value }))} /></label><button className="button primary full-button" type="submit">保存费率</button></form></article></div><div className="settings-grid"><article className="panel settings-panel"><div className="panel-heading"><div><h2>初始异常规则</h2><p>规则命中代表值得检查，不代表已经证明浪费</p></div></div><div className="rule-list"><div><span className="rule-number">01</span><div><strong>疑似重复读取</strong><p>同一主体、文件、范围与内容，5 分钟内至少 3 次。</p></div></div><div><span className="rule-number">02</span><div><strong>疑似轮询空转</strong><p>同一目标连续 3 次纯 wait/poll，间隔不超过 60 秒且无状态变化。</p></div></div><div><span className="rule-number">03</span><div><strong>疑似压缩循环</strong><p>10 分钟内至少两轮“压缩 → 重读相同内容”。</p></div></div></div></article><article className="panel settings-panel privacy-panel"><div className="privacy-large-icon">◇</div><h2>本地优先</h2><p>原始日志只在设备内读取与分析。关闭网页不会停止本地服务；停止采集会保留当前结果，清除会话才会丢弃临时内容。</p><div className="service-actions"><span className="service-state"><i />{collectorMessage}</span><button className="button secondary" onClick={clearSession}>清除本次数据</button></div></article></div><article className="panel compatibility-panel"><div className="panel-heading"><div><h2>解析范围与证据边界</h2><p>支持声明只覆盖已实现的通用字段；实际日志版本仍需样本验证。</p></div><span className="count-badge">本地只读</span></div><div className="compatibility-grid"><div><strong>Codex JSONL</strong><p>识别 token_count 累计快照、function_call / output、用户请求、父会话和常见文件范围。</p></div><div><strong>Claude Code JSONL</strong><p>识别 assistant usage、tool_use / tool_result、result 汇总、缓存字段和上下文压缩标记。</p></div><div><strong>缺失与未知</strong><p>坏行、截断输出、未匹配费率或无法确认归属会保留证据并标为部分/未知，不静默填零。</p></div></div></article></section>;
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Link className="brand" href="/" aria-label="TokenScope 首页">
          <span className="brand-symbol">t</span>
          <span className="brand-name">tokenscope</span>
          <span className="brand-dot">.</span>
        </Link>
        <div className="workspace-switch" title="当前仅支持本机工作空间">
          <span className="workspace-icon">本</span>
          <div><strong>本机工作空间</strong><small>日志不离开这台设备</small></div>
        </div>
        <div className="nav-label">工作空间</div>
        <nav aria-label="主导航">
          {NAV_ITEMS.map((item) => (
            <button key={item.id} className={'nav-item ' + (view === item.id ? 'active' : '')} onClick={() => { setView(item.id); if (item.id === 'sessions') setSelectedSessionKey(null); }}>
              <span className="nav-glyph" aria-hidden="true">{item.icon}</span>
              {item.label}
              {item.id === 'insights' && navAnomalyCount > 0 && <span className="nav-count">{navAnomalyCount}</span>}
            </button>
          ))}
        </nav>
        <div className="nav-label nav-label-settings">偏好设置</div>
        <button className={'nav-item ' + (view === 'settings' ? 'active' : '')} onClick={() => setView('settings')}>
          <span className="nav-glyph" aria-hidden="true">⚙</span>计费与规则
        </button>
        <div className="sidebar-bottom">
          <div className="privacy-note">
            <span className="privacy-icon">◇</span>
            <strong>你的代码，只属于你</strong>
            <p>会话在浏览器本地分析。<br />不上传日志，不需要 API Key。</p>
            <span className="local-status"><i />本地优先 · 隐私安全</span>
          </div>
          <div className="sidebar-footer"><span>TokenScope</span><span>v0.2.0</span></div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumbs">工作空间 <span>/</span><strong>{NAV_ITEMS.find((item) => item.id === view)?.label ?? '计费与规则'}</strong></div>
          <div className="topbar-right">
            <span className={'data-mode mode-' + analysisMode}><i />{modeLabel}</span>
            <span className="topbar-divider" />
            <span className="collector-state">
              <i className={collectorConnection === 'collecting' ? 'pulse' : ''} />
              {collectorConnectionLabel(collectorConnection)}
            </span>
            <IntegrityBadge completeness={analysis.completeness} />
            <span className="avatar" title="本机">本</span>
          </div>
        </header>
        <main className="main-content">
          {collectorStatus === 'loading' && <div className="loading-banner" role="status">正在读取所选日志（仅在本机处理）…</div>}
          <div className="page-heading">
            <div>
              <div className="eyebrow">LESS WASTE. MORE BUILDING.</div>
              <h1>{view === 'overview' ? '成本总览' : NAV_ITEMS.find((item) => item.id === view)?.label ?? '计费与规则'}<span className="heading-dot">.</span></h1>
              <p>{view === 'overview' ? '看清哪次会话在消耗、增长有多快、哪里值得检查。' : '保留记录、估算和证据，让每个判断都能回到原始会话。'}</p>
            </div>
          </div>
          <div className="source-bar">
            <input className="path-input" value={livePath} onChange={(event) => setLivePath(event.target.value)} placeholder="~/.codex（含 sessions 与 archived_sessions）或 Claude 日志目录" aria-label="本机日志目录路径" />
            <button className="button secondary" onClick={analysisMode === 'live' && collectorStatus === 'collecting' ? stopCollection : handleLiveStart} disabled={collectorStatus === 'loading'}>
              {analysisMode === 'live' && collectorStatus === 'collecting' ? '■ 停止采集' : '◉ 开始本机采集'}
            </button>
            <button className="button primary" onClick={() => fileInputRef.current?.click()} disabled={collectorStatus === 'loading'}>＋ 导入 Session</button>
            <input ref={fileInputRef} className="visually-hidden" type="file" accept=".jsonl,.json,.ndjson,.log" multiple onChange={(event) => { if (event.target.files) void handleFiles(event.target.files); event.currentTarget.value = ''; }} />
          </div>
          <div className="filter-row">
            <div className="segmented" role="group" aria-label="Agent 筛选">
              <button className={providerFilter === 'all' ? 'selected' : ''} onClick={() => filterProvider('all')}>全部 Agent</button>
              <button className={providerFilter === 'codex' ? 'selected' : ''} onClick={() => filterProvider('codex')}>Codex</button>
              <button className={providerFilter === 'claude' ? 'selected' : ''} onClick={() => filterProvider('claude')}>Claude Code</button>
            </div>
            <div className="filter-row-end">
              <div className="currency-switch" role="group" aria-label="费用单位">
                <button className={currency === 'usd' ? 'selected' : ''} onClick={() => setCurrencyAndSave('usd')}>USD</button>
                <button className={currency === 'credits' ? 'selected' : ''} onClick={() => setCurrencyAndSave('credits')}>Credits</button>
              </div>
              <div className="status-cluster" aria-label="采集与数据状态">
                <StatusChip kind={connectionKind} label={collectorConnectionLabel(collectorConnection)} title={collectorMessage} />
                <StatusChip kind={freshnessKind} label={freshnessChipLabel} title={'最后数据 ' + formatRelativeTime(analysis.lastDataAt)} />
                <StatusChip kind={analysis.completeness === 'complete' ? 'ok' : analysis.completeness === 'partial' ? 'warn' : 'unknown'} label={completenessLabel(analysis)} />
              </div>
            </div>
          </div>
          <p className="status-message">{collectorMessage} · 最后数据 {formatRelativeTime(analysis.lastDataAt)}</p>
          {analysisMode === 'demo' && (
            <div className="demo-banner" role="status">
              <span>演示</span>
              <div>
                <strong>当前是合成演示数据，未与真实来源混合汇总</strong>
                <p>导入 JSONL 或启动本机采集后，这里会替换为你选择的日志。</p>
              </div>
            </div>
          )}
          {analysis.errors.length > 0 && (
            <div className="warning-banner">
              <span>!</span>
              <div>
                <strong>部分来源未能完整解析</strong>
                <p>{analysis.errors.length} 条记录被隔离；已知小计仍可查看，未知内容不会被填成零。</p>
                <details className="error-details">
                  <summary>查看受影响记录</summary>
                  <ul>{analysis.errors.slice(0, 8).map((error, index) => <li key={(error.sourceFile ?? 'error') + error.line + String(index)}>{error.sourceFile ?? '来源未知'} · {error.line > 0 ? '第 ' + String(error.line) + ' 行' : '文件级'} · {error.message}</li>)}</ul>
                  {analysis.errors.length > 8 && <small>其余 {analysis.errors.length - 8} 条错误已折叠。</small>}
                </details>
              </div>
              <button onClick={() => setView('sessions')}>查看会话 ↗</button>
            </div>
          )}
          {view === 'overview' && renderOverview()}
          {view === 'sessions' && renderSessionsView()}
          {view === 'insights' && renderInsightsView()}
          {view === 'subagents' && renderSubagentsView()}
          {view === 'settings' && renderSettingsView()}
          <footer className="page-footer">
            <span><i className="tiny-dot" />所有数据仅在本地处理</span>
            <span>{analysisMode === 'demo' ? '演示数据 · 合成费率' : '费用为估算 · 数据不代表真实账单'}</span>
            <span>关闭网页不会停止本机采集；退出服务后才清空</span>
          </footer>
        </main>
      </div>
    </div>
  );
}
