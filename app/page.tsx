'use client';

import Link from 'next/link';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  behaviorLabel,
  buildAnalysis,
  createDemoAnalysis,
  defaultRateSnapshots,
  demoRateSnapshots,
  formatDateTime,
  formatMoney,
  formatRelativeTime,
  formatTokenCount,
  parseJsonl,
  providerLabel,
  usageTokenCount,
  type AnalysisEvent,
  type AnalysisResult,
  type Anomaly,
  type Behavior,
  type CostSummary,
  type Provider,
  type RateSnapshot,
} from '@/lib/analysis';
import {
  chooseDirectoryDocuments,
  readFileDocuments,
  startDirectoryWatcher,
  supportsDirectoryPicking,
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
  other: '#dd8c87',
};

const BEHAVIOR_KEYS: Array<{ key: Behavior; label: string }> = [
  { key: 'code', label: '代码与执行' },
  { key: 'subagent', label: '子 Agent' },
  { key: 'read', label: '读取' },
  { key: 'wait', label: '等待 / 轮询' },
  { key: 'planning', label: '规划与思考' },
  { key: 'other', label: '其他 / 未知' },
];

function displayCost(
  summary: CostSummary,
  currency: Currency,
): { value: string; note: string; tone: 'known' | 'partial' | 'unknown' } {
  if (currency === 'usd' && summary.usd !== undefined) {
    return {
      value: formatMoney(summary.usd, 'USD'),
      note: summary.complete ? 'USD 估算' : 'USD 已知小计',
      tone: summary.complete ? 'known' : 'partial',
    };
  }
  if (currency === 'credits' && summary.credits !== undefined) {
    return {
      value: formatMoney(summary.credits, 'credits'),
      note: summary.complete ? 'credits 估算' : 'credits 已知小计',
      tone: summary.complete ? 'known' : 'partial',
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
    value: summary.hasKnownAmount ? '部分' : '未知',
    note: summary.hasKnownAmount ? '缺少完整费率' : '暂无适用费率',
    tone: 'unknown',
  };
}

function providerClass(provider: Provider): string {
  return provider === 'claude' ? 'claude' : provider === 'codex' ? 'codex' : 'unknown';
}

function completenessLabel(result: AnalysisResult): string {
  if (result.completeness === 'complete') return '数据完整';
  if (result.completeness === 'partial') return '部分数据';
  return '数据未知';
}

function eventLabel(event: AnalysisEvent): string {
  if (event.kind === 'model') return event.scope === 'summary' ? '来源费用汇总' : '模型调用';
  if (event.kind === 'tool') return event.toolName || '工具执行';
  if (event.kind === 'wait') return '等待 / 轮询';
  if (event.kind === 'compaction') return '上下文压缩';
  if (event.kind === 'user') return '用户请求';
  return '未知记录';
}

function callCost(call: AnalysisEvent, rates: RateSnapshot[], currency: Currency): string {
  const result = buildAnalysis([call], rates);
  return displayCost(result.cost, currency).value;
}

function metricSubtext(summary: CostSummary): string {
  if (summary.complete) return '可追溯费率估算';
  if (summary.hasKnownAmount) return '已知小计 · 仍有缺口';
  return '等待可匹配费率';
}

function compareDescending(left: number | undefined, right: number | undefined): number {
  if (left === undefined && right === undefined) return 0;
  if (left === undefined) return 1;
  if (right === undefined) return -1;
  return right - left;
}

function sessionGrowth(session: AnalysisResult['sessions'][number]): number | undefined {
  const calls = session.ownCalls
    .filter((call) => call.timestamp && call.usage)
    .sort((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp));
  if (calls.length < 2) return undefined;
  const previous = calls.at(-2);
  const latest = calls.at(-1);
  if (!previous || !latest) return undefined;
  const elapsed = Date.parse(latest.timestamp) - Date.parse(previous.timestamp);
  if (!Number.isFinite(elapsed) || elapsed <= 0) return undefined;
  const tokens = usageTokenCount(latest.usage);
  return tokens / (elapsed / 60_000);
}

function MetricCard({
  label,
  value,
  caption,
  icon,
  accent,
}: {
  label: string;
  value: string;
  caption: string;
  icon: string;
  accent?: boolean;
}) {
  return (
    <article className={'metric-card' + (accent ? ' metric-card-accent' : '')}>
      <div className="metric-label">
        <span>{label}</span>
        <span className="metric-icon" aria-hidden="true">{icon}</span>
      </div>
      <div className="metric-value">{value}</div>
      <div className="metric-caption">{caption}</div>
      <div className="mini-spark" aria-hidden="true">
        <i style={{ height: '18%' }} />
        <i style={{ height: '36%' }} />
        <i style={{ height: '28%' }} />
        <i style={{ height: '54%' }} />
        <i style={{ height: '45%' }} />
        <i style={{ height: '70%' }} />
        <i style={{ height: '58%' }} />
        <i style={{ height: '88%' }} />
      </div>
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
  return <span className={'confidence confidence-' + confidence}>{confidence} 置信度</span>;
}

function AnomalyCard({
  anomaly,
  analysis,
  currency,
  onToggleNecessary,
  onSelect,
  selected,
}: {
  anomaly: Anomaly;
  analysis: AnalysisResult;
  currency: Currency;
  onToggleNecessary: (callIds: string[]) => void;
  onSelect: () => void;
  selected: boolean;
}) {
  const allNecessary =
    anomaly.candidateCallIds.length > 0 &&
    anomaly.candidateCallIds.every((id) => analysis.necessaryCallIds.has(id));
  const associated = buildAnalysis(
    analysis.calls.filter((call) => anomaly.callIds.includes(call.id)),
    analysis.rates,
  ).cost;
  const associatedDisplay = displayCost(associated, currency);
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
        <div className="anomaly-card-bottom">
          <span>{anomaly.callIds.length} 个关联调用</span>
          <strong>{associatedDisplay.value}</strong>
        </div>
      </button>
      <div className="anomaly-card-actions">
        <span className="anomaly-note">{anomaly.mixed ? '混合调用 · 不计入候选汇总' : associatedDisplay.note}</span>
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
              ? '模式证据完整；这不代表该操作没有价值。'
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

export default function Home() {
  const initialDemo = useMemo(() => createDemoAnalysis(), []);
  const [view, setView] = useState<View>('overview');
  const [analysisMode, setAnalysisMode] = useState<'demo' | 'history' | 'live'>('demo');
  const [sourceLabel, setSourceLabel] = useState('合成演示数据');
  const [sourceEvents, setSourceEvents] = useState<AnalysisEvent[]>(initialDemo.events);
  const [sourceErrors, setSourceErrors] = useState(initialDemo.errors);
  const [providerFilter, setProviderFilter] = useState<Provider | 'all'>('all');
  const [currency, setCurrency] = useState<Currency>('usd');
  const [preferences, setPreferences] = useState<Preferences>({ customRates: [], currency: 'usd' });
  const [preferencesReady, setPreferencesReady] = useState(false);
  const [necessaryCallIds, setNecessaryCallIds] = useState<Set<string>>(new Set());
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [selectedAnomalyId, setSelectedAnomalyId] = useState<string | null>(null);
  const [expandedSessionIds, setExpandedSessionIds] = useState<Set<string>>(new Set());
  const [collectorStatus, setCollectorStatus] = useState<CollectorStatus>('idle');
  const [collectorMessage, setCollectorMessage] = useState('本地服务已就绪');
  const [trendMetric, setTrendMetric] = useState<Currency | 'tokens'>('usd');
  const [sessionSort, setSessionSort] = useState<SessionSort>('updated');
  const [liveSupported, setLiveSupported] = useState(false);
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
  const stopWatcherRef = useRef<(() => void) | null>(null);

  const rates = useMemo(
    () => [
      ...preferences.customRates,
      ...(analysisMode === 'demo' ? demoRateSnapshots : defaultRateSnapshots),
    ],
    [analysisMode, preferences.customRates],
  );

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const loaded = loadPreferences();
      setPreferences(loaded);
      setCurrency(loaded.currency);
      setLiveSupported(supportsDirectoryPicking());
      setPreferencesReady(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!preferencesReady) return;
    savePreferences(preferences);
  }, [preferences, preferencesReady]);

  const analysis = useMemo<AnalysisResult>(() => buildAnalysis(sourceEvents, rates, {
      mode: analysisMode,
      sourceLabel,
      errors: sourceErrors,
      necessaryCallIds,
    }), [analysisMode, necessaryCallIds, rates, sourceErrors, sourceEvents, sourceLabel]);

  useEffect(() => {
    let active = true;
    fetch('/api/health')
      .then((response) => {
        if (active && response.ok) setCollectorMessage('本地只读服务已连接');
      })
      .catch(() => {
        if (active) setCollectorMessage('本地服务状态待确认');
      });
    return () => {
      active = false;
      stopWatcherRef.current?.();
    };
  }, []);

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
          setSelectedSessionId(null);
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
        setSelectedSessionId(null);
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

  const handleDirectory = useCallback(async () => {
    stopWatcherRef.current?.();
    setCollectorStatus('loading');
    setCollectorMessage('等待选择本地日志目录');
    try {
      const picked = await chooseDirectoryDocuments();
      await applyDocuments(picked.documents, 'live', '实时目录 · ' + (picked.directory.name ?? '已选择目录'));
      stopWatcherRef.current = startDirectoryWatcher(
        picked.directory,
        async (documents) => {
          await applyDocuments(documents, 'live', '实时目录 · ' + (picked.directory.name ?? '已选择目录'), true);
        },
        5000,
        (error) => {
          setCollectorStatus('error');
          setCollectorMessage(error instanceof Error ? error.message : '实时目录读取失败，等待恢复');
        },
      );
    } catch (error) {
      setCollectorStatus('error');
      setCollectorMessage(error instanceof Error ? error.message : '目录选择已取消或失败');
    }
  }, [applyDocuments]);

  const stopCollection = useCallback(() => {
    stopWatcherRef.current?.();
    stopWatcherRef.current = null;
    setCollectorStatus('stopped');
    setCollectorMessage('采集已停止；当前结果仍可查看');
  }, []);

  const clearSession = useCallback(() => {
    stopWatcherRef.current?.();
    stopWatcherRef.current = null;
    setSourceEvents([]);
    setSourceErrors([]);
    setAnalysisMode('history');
    setSourceLabel('暂无会话');
    setNecessaryCallIds(new Set());
    setSelectedSessionId(null);
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
        return compareDescending(sessionGrowth(left), sessionGrowth(right));
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
        (anomaly) =>
          providerFilter === 'all' ||
          analysis.sessions.find((session) => session.id === anomaly.sessionId)?.provider === providerFilter,
      ),
    [analysis.anomalies, analysis.sessions, providerFilter],
  );
  const selectedSession = analysis.sessions.find((session) => session.id === selectedSessionId);
  const totalCost = displayCost(analysis.cost, currency);
  const candidateCost = displayCost(analysis.candidateCost, currency);
  const candidatePercent =
    analysis.cost.usd && analysis.candidateCost.usd !== undefined
      ? Math.round((analysis.candidateCost.usd / analysis.cost.usd) * 100)
      : analysis.cost.credits && analysis.candidateCost.credits !== undefined
        ? Math.round((analysis.candidateCost.credits / analysis.cost.credits) * 100)
        : 0;

  const allocation = useMemo(() => {
    const totals = new Map<string, number>();
    for (const call of analysis.calls) {
      const behavior = call.behavior;
      const key =
        behavior === 'code' ||
        behavior === 'subagent' ||
        behavior === 'read' ||
        behavior === 'wait' ||
        behavior === 'planning'
          ? behavior
          : 'other';
      totals.set(key, (totals.get(key) ?? 0) + usageTokenCount(call.usage));
    }
    const total = [...totals.values()].reduce((sum, value) => sum + value, 0);
    return BEHAVIOR_KEYS.map((item) => ({
      ...item,
      value: totals.get(item.key) ?? 0,
      percent: total ? Math.round(((totals.get(item.key) ?? 0) / total) * 100) : 0,
    }));
  }, [analysis.calls]);

  const trend = useMemo(() => {
    const bucketMap = new Map<string, AnalysisEvent[]>();
    for (const call of analysis.calls) {
      const parsed = call.timestamp ? new Date(call.timestamp) : null;
      if (!parsed || Number.isNaN(parsed.getTime())) continue;
      const key = parsed.toISOString().slice(0, 10);
      const current = bucketMap.get(key) ?? [];
      current.push(call);
      bucketMap.set(key, current);
    }
    const entries = [...bucketMap.entries()].sort(([left], [right]) => left.localeCompare(right)).slice(-7);
    const values = entries.map(([key, calls]) => {
      const usage = calls.reduce((sum, call) => sum + usageTokenCount(call.usage), 0);
      const cost = buildAnalysis(calls, rates).cost;
      const value =
        trendMetric === 'tokens'
          ? usage
          : trendMetric === 'usd'
            ? cost.usd ?? cost.credits ?? 0
            : cost.credits ?? cost.usd ?? 0;
      return { key, calls, value, usage, cost };
    });
    const max = Math.max(...values.map((item) => item.value), 1);
    return values.map((item) => ({ ...item, height: Math.max(8, Math.round((item.value / max) * 100)) }));
  }, [analysis.calls, rates, trendMetric]);

  const modeLabel = analysisMode === 'demo' ? '演示数据' : analysisMode === 'live' ? '实时采集' : '历史复盘';
  const navAnomalyCount = visibleAnomalies.length;
  function toggleSession(sessionId: string) {
    setExpandedSessionIds((current) => {
      const next = new Set(current);
      if (next.has(sessionId)) next.delete(sessionId);
      else next.add(sessionId);
      return next;
    });
  }

  function renderSessionRows() {
    const visibleIds = new Set(visibleSessions.map((session) => session.id));
    // A child whose parent log was not selected remains in the ledger as an
    // orphan. It is shown at the top level with a partial-coverage cue rather
    // than disappearing from the total.
    const rows = visibleSessions.filter((session) => !session.parentSessionId || !visibleIds.has(session.parentSessionId));
    if (!rows.length) {
      return (
        <tbody>
          <tr><td colSpan={6}><EmptyState title="还没有可显示的会话" description="导入一份 Codex 或 Claude Code JSONL 日志开始复盘。" /></td></tr>
        </tbody>
      );
    }
    const anomalyCalls = new Set(visibleAnomalies.flatMap((anomaly) => anomaly.candidateCallIds));
    return (
      <>
        {rows.map((session) => {
          const suspectCount = session.ownCalls.filter((call) => anomalyCalls.has(call.id)).length;
          const suspectPercent = session.ownCalls.length ? Math.round((suspectCount / session.ownCalls.length) * 100) : 0;
          const cost = displayCost(session.inclusiveCost, currency);
          const expanded = expandedSessionIds.has(session.id);
          const children = visibleSessions.filter((item) => item.parentSessionId === session.id);
          return (
            <tbody key={session.id} className="session-group">
              <tr className={selectedSessionId === session.id ? 'row-selected' : ''}>
                <td><div className="session-name-cell">{children.length > 0 && <button className={'tree-toggle' + (expanded ? ' expanded' : '')} onClick={() => toggleSession(session.id)} aria-label={expanded ? '收起子会话' : '展开子会话'}>›</button>}<button className="session-link" onClick={() => setSelectedSessionId(session.id)}><strong>{session.title}</strong><small>{session.id}</small></button></div></td>
                <td><SourceBadge provider={session.provider} /></td>
                <td className="mono">{formatTokenCount(session.inclusiveUsage.totalTokens)}</td>
                <td className={'mono cost-' + cost.tone}>{cost.value}<small>{cost.note}</small></td>
                <td>{suspectPercent > 0 ? <span className="suspect-meter"><i style={{ width: suspectPercent + '%' }} /><em>{suspectPercent}%</em></span> : <span className="muted">—</span>}</td>
                <td><span className="session-freshness">{session.lastDataAt ? '已记录' : '待更新'}</span></td>
              </tr>
              {expanded && children.map((child) => {
                const childCost = displayCost(child.inclusiveCost, currency);
                return <tr key={child.id} className="child-row"><td><div className="session-name-cell child-session"><span className="tree-branch">└</span><button className="session-link" onClick={() => setSelectedSessionId(child.id)}><strong>{child.title}</strong><small>{child.id}</small></button></div></td><td><SourceBadge provider={child.provider} /></td><td className="mono">{formatTokenCount(child.inclusiveUsage.totalTokens)}</td><td className={'mono cost-' + childCost.tone}>{childCost.value}<small>{childCost.note}</small></td><td><span className="muted">子会话</span></td><td><span className="session-freshness">已记录</span></td></tr>;
              })}
            </tbody>
          );
        })}
      </>
    );
  }

  function renderTimeline(sessionId?: string) {
    const events = analysis.events.filter((event) => !sessionId || event.sessionId === sessionId || event.parentSessionId === sessionId).slice(-80).reverse();
    if (!events.length) return <EmptyState title="暂无调用明细" description="当前来源还没有可辨识的模型调用记录。" />;
    return <div className="timeline">{events.map((event) => <div className="timeline-row" key={event.id}><span className={'timeline-marker marker-' + event.kind} aria-hidden="true" /><div className="timeline-main"><div className="timeline-head"><strong>{eventLabel(event)}</strong><span>{formatDateTime(event.timestamp)}</span></div><div className="timeline-detail">{event.kind === 'model' && event.usage ? formatTokenCount(usageTokenCount(event.usage)) + ' tokens · ' + (event.model ?? '模型未知') : event.kind === 'model' && event.scope === 'summary' ? '来源报告费用 · ' + formatMoney(event.reportedCostUsd, 'USD') : event.kind === 'tool' ? (event.toolName ?? '工具') + (event.filePath ? ' · ' + event.filePath : '') : event.kind === 'wait' ? (event.target ?? '目标未知') + ' · 状态 ' + (event.stateHash ? '未变化' : '未知') : event.kind === 'compaction' ? '上下文阶段发生压缩' : event.text?.slice(0, 120) || '来源记录无可显示摘要'}</div>{event.kind === 'model' && <span className="timeline-behavior" title={buildAnalysis([event], rates).cost.basis}>{event.scope === 'summary' ? '来源汇总' : behaviorLabel(event.behavior)} · {callCost(event, rates, currency)}</span>}</div></div>)}</div>;
  }

  function renderOverview() {
    const allocationParts = allocation.map((item) => item.percent).reduce<number[]>((parts, percent) => [...parts, (parts.at(-1) ?? 0) + percent], []);
    const donut = allocationParts.length ? allocation.map((item, index) => { const start = index === 0 ? 0 : allocationParts[index - 1]; return BEHAVIOR_COLORS[item.key] + ' ' + String(start) + '% ' + String(allocationParts[index]) + '%'; }).join(', ') : '#273022 0% 100%';
    return <><section className="metrics-grid"><MetricCard label="预估总费用" value={totalCost.value} caption={metricSubtext(analysis.cost)} icon="◈" /><MetricCard label="总 Token 用量" value={formatTokenCount(analysis.usage.totalTokens)} caption={String(analysis.calls.length) + ' 个可辨识模型调用'} icon="◎" /><MetricCard label="疑似可优化费用" value={candidateCost.value} caption={String(candidatePercent) + '% 的已知费用值得检查'} icon="↗" accent /><MetricCard label="已分析会话" value={String(visibleSessions.length)} caption={completenessLabel(analysis) + ' · ' + sourceLabel} icon="▤" /></section><section className="charts-grid"><article className="panel trend-panel"><div className="panel-heading"><div><h2>消耗趋势</h2><p>基于已记录用量，不代表逐 Token 实时扣费</p></div><div className="chart-toggle" role="group" aria-label="趋势单位"><button className={trendMetric === 'usd' ? 'selected' : ''} onClick={() => setTrendMetric('usd')}>费用</button><button className={trendMetric === 'tokens' ? 'selected' : ''} onClick={() => setTrendMetric('tokens')}>Tokens</button><button className={trendMetric === 'credits' ? 'selected' : ''} onClick={() => setTrendMetric('credits')}>Credits</button></div></div><div className="chart-legend"><span><i className="legend-work" />已记录用量</span><span><i className="legend-suspect" />包含异常关联</span><span className="chart-unit">{trendMetric === 'tokens' ? 'tokens' : trendMetric === 'credits' ? 'credits' : 'USD'}</span></div>{trend.length ? <div className="bar-chart" aria-label="最近数据日消耗趋势"><div className="bar-grid"><i /><i /><i /><i /><i /></div><div className="bar-series">{trend.map((item) => <div className="bar-column-wrap" key={item.key} title={item.key + ' · ' + formatTokenCount(item.usage)}><div className="bar-column" style={{ height: item.height + '%' }}><span className="bar-suspect" style={{ height: Math.min(70, Math.max(16, item.cost.complete ? 22 : 40)) + '%' }} /><span className="bar-work" /></div><small>{item.key.slice(5).replace('-', '/')}</small></div>)}</div></div> : <EmptyState title="没有可绘制的时间" description="来源缺少时间戳，趋势会保留为空。" />}<div className="chart-footnote"><span className="status-dot" />最后数据：{formatRelativeTime(analysis.lastDataAt)}<button className="text-button" onClick={() => setView('sessions')}>查看每轮明细 ↗</button></div></article><article className="panel allocation-panel"><div className="panel-heading"><div><h2>Token 花在哪里？</h2><p>按行为归因，不等同于服务商账单分类</p></div><span className="info-icon" title="行为归因可能包含推断">i</span></div><div className="allocation-content"><div className="donut" style={{ background: 'conic-gradient(' + donut + ')' }}><div><span>总用量</span><strong>{formatTokenCount(analysis.usage.totalTokens)}</strong><span>tokens</span></div></div><div className="allocation-legend">{allocation.map((item) => <div key={item.key}><span><i style={{ background: BEHAVIOR_COLORS[item.key] }} />{item.label}</span><strong>{item.percent}<small>%</small></strong></div>)}</div></div><div className="allocation-note">{analysis.completeness === 'complete' ? '当前分析范围内可确认' : '部分记录缺失，百分比可能不完整'}</div></article></section><section className="section-block"><div className="section-heading"><h2><span className="section-icon amber">⌁</span> 值得关注 <span className="count-badge">{navAnomalyCount} 类异常</span></h2><button className="text-button" onClick={() => setView('insights')}>查看全部洞察 ↗</button></div>{visibleAnomalies.length ? <div className="insight-grid">{visibleAnomalies.slice(0, 3).map((anomaly) => <AnomalyCard key={anomaly.id} anomaly={anomaly} analysis={analysis} currency={currency} onToggleNecessary={toggleNecessary} onSelect={() => { setSelectedAnomalyId(anomaly.id); setView('insights'); }} selected={selectedAnomalyId === anomaly.id} />)}</div> : <div className="panel"><EmptyState title="暂无已确认异常" description="满足完整证据条件的重复读取、轮询或压缩循环会在这里出现。" /></div>}</section><section className="panel sessions-panel"><div className="panel-heading"><div className="inline-heading"><h2>最近会话</h2><span className="count-badge">{visibleSessions.length}</span></div><button className="text-button" onClick={() => setView('sessions')}>查看所有会话 ↗</button></div><div className="table-wrap"><table><thead><tr><th>任务 / Session</th><th>Agent</th><th>Token 用量</th><th>预估费用</th><th>可优化占比</th><th>状态</th></tr></thead>{renderSessionRows()}</table></div></section></>;
  }

  function renderSessionsView() {
    return <section className="view-stack"><div className="view-intro"><div><span className="eyebrow">SESSION LEDGER</span><h2>会话记录</h2><p>逐个分析单元查看模型调用、自身用量和含子会话合计。</p></div><div className="view-intro-actions"><div className="inline-summary"><span>{visibleSessions.length} 个会话</span><span>{formatTokenCount(analysis.usage.totalTokens)} tokens</span><span>{completenessLabel(analysis)}</span></div><label className="sort-control">排序<select aria-label="会话排序" value={sessionSort} onChange={(event) => setSessionSort(event.target.value as SessionSort)}><option value="updated">最近数据</option><option value="tokens">含子会话 Token</option><option value="cost">可计价费用</option><option value="growth">最近增速</option></select></label></div></div><div className="panel sessions-panel full-table"><div className="panel-heading"><div className="inline-heading"><h2>分析单元</h2><span className="count-badge">{visibleSessions.length}</span></div><span className="panel-hint">点击任务查看时间线和成本树</span></div><div className="table-wrap"><table><thead><tr><th>任务 / Session</th><th>Agent</th><th>自身 Token</th><th>含子会话</th><th>费用</th><th>最近数据</th></tr></thead><tbody>{visibleSessions.length ? visibleSessions.map((session) => { const cost = displayCost(session.inclusiveCost, currency); return <tr key={session.id} className={selectedSessionId === session.id ? 'row-selected' : ''}><td><button className="session-link" onClick={() => setSelectedSessionId(session.id)}><strong>{session.title}</strong><small>{session.id}</small></button></td><td><SourceBadge provider={session.provider} /></td><td className="mono">{formatTokenCount(session.ownUsage.totalTokens)}</td><td className="mono">{formatTokenCount(session.inclusiveUsage.totalTokens)}</td><td className={'mono cost-' + cost.tone}>{cost.value}<small>{cost.note}</small></td><td>{formatRelativeTime(session.lastDataAt)}</td></tr>; }) : <tr><td colSpan={6}><EmptyState title="还没有会话" description="从右上角导入日志，或选择一个目录开始实时采集。" /></td></tr>}</tbody></table></div></div><div className="detail-grid"><article className="panel detail-panel"><div className="panel-heading"><div><h2>{selectedSession ? selectedSession.title : '选择一个会话'}</h2><p>{selectedSession ? selectedSession.id : '时间线会显示在这里'}</p></div></div>{selectedSession ? <><div className="detail-stats"><div><span>自身用量</span><strong>{formatTokenCount(selectedSession.ownUsage.totalTokens)}</strong></div><div><span>含子会话</span><strong>{formatTokenCount(selectedSession.inclusiveUsage.totalTokens)}</strong></div><div><span>费用</span><strong>{displayCost(selectedSession.inclusiveCost, currency).value}</strong></div></div><div className="timeline-wrap">{renderTimeline(selectedSession.id)}</div></> : <EmptyState title="尚未选择分析单元" description="点击上方任意会话以查看模型调用与证据。" />}</article><article className="panel detail-panel"><div className="panel-heading"><div><h2>异常证据</h2><p>只显示与当前会话有关的可疑模式</p></div></div>{selectedSession ? <div className="compact-anomalies">{visibleAnomalies.filter((anomaly) => anomaly.sessionId === selectedSession.id).map((anomaly) => <AnomalyCard key={anomaly.id} anomaly={anomaly} analysis={analysis} currency={currency} onToggleNecessary={toggleNecessary} onSelect={() => setSelectedAnomalyId(anomaly.id)} selected={selectedAnomalyId === anomaly.id} />)}{!visibleAnomalies.some((anomaly) => anomaly.sessionId === selectedSession.id) && <EmptyState title="暂无异常证据" description="正常工作、证据不足或数据不完整都不会被强行标记。" />}</div> : <EmptyState title="选择会话后查看" description="证据会链接回具体调用和来源记录。" />}</article></div></section>;
  }

  function renderInsightsView() {
    return <section className="view-stack"><div className="view-intro"><div><span className="eyebrow">EVIDENCE FIRST</span><h2>异常洞察</h2><p>重复并不等于浪费；每个提示都保留命中规则、证据和置信度。</p></div><div className="inline-summary"><span>{visibleAnomalies.length} 个模式</span><span>{candidateCost.value} 疑似可优化</span></div></div><div className="insight-list">{visibleAnomalies.length ? visibleAnomalies.map((anomaly) => <AnomalyCard key={anomaly.id} anomaly={anomaly} analysis={analysis} currency={currency} onToggleNecessary={toggleNecessary} onSelect={() => setSelectedAnomalyId(selectedAnomalyId === anomaly.id ? null : anomaly.id)} selected={selectedAnomalyId === anomaly.id} />) : <div className="panel"><EmptyState title="暂无完整异常模式" description="导入日志后，满足初始规则的模式会带着证据出现在这里。" /></div>}</div></section>;
  }

  function renderSubagentsView() {
    const children = visibleSessions.filter((session) => session.parentSessionId);
    return <section className="view-stack"><div className="view-intro"><div><span className="eyebrow">CHILD SESSION TREE</span><h2>子 Agent</h2><p>只按明确归属证据展示子会话，目录相同或时间接近不会自动合并。</p></div><div className="inline-summary"><span>{children.length} 个已发现子会话</span><span>缺失日志会显示缺口</span></div></div><div className="panel sessions-panel full-table"><div className="panel-heading"><div className="inline-heading"><h2>主子会话成本树</h2><span className="count-badge">{children.length}</span></div></div><div className="table-wrap"><table><thead><tr><th>执行主体</th><th>归属</th><th>自身 Token</th><th>含下级</th><th>费用</th><th>完整性</th></tr></thead><tbody>{children.length ? children.map((session) => { const cost = displayCost(session.inclusiveCost, currency); const parent = visibleSessions.find((item) => item.id === session.parentSessionId); return <tr key={session.id}><td><div className="session-name-cell child-session"><span className="tree-branch">└</span><button className="session-link" onClick={() => setSelectedSessionId(session.id)}><strong>{session.title}</strong><small>{session.id}</small></button></div></td><td>{parent ? parent.title : '归属未知'}</td><td className="mono">{formatTokenCount(session.ownUsage.totalTokens)}</td><td className="mono">{formatTokenCount(session.inclusiveUsage.totalTokens)}</td><td className={'mono cost-' + cost.tone}>{cost.value}<small>{cost.note}</small></td><td><span className={'integrity-pill integrity-' + session.completeness}>{session.completeness === 'complete' ? '完整' : '有缺口'}</span></td></tr>; }) : <tr><td colSpan={6}><EmptyState title="尚未发现子会话" description="父子关系需要来源中的明确归属证据；没有可靠分母时不会显示覆盖率。" /></td></tr>}</tbody></table></div></div><div className="panel callout-panel"><span className="callout-icon">i</span><div><strong>自身用量与含子会话合计是两个视图</strong><p>含子会话的费用不能再与子会话明细相加。来源只提供整树汇总时，页面会保留汇总但不虚构子节点。</p></div></div></section>;
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

  return <div className="app-shell"><aside className="sidebar"><Link className="brand" href="/" aria-label="TokenScope 首页"><span className="brand-symbol">t</span><span className="brand-name">tokenscope</span><span className="brand-dot">.</span></Link><div className="workspace-switch"><span className="workspace-icon">W</span><div><strong>我的工作空间</strong><small>Local workspace</small></div><span className="muted">⌄</span></div><div className="nav-label">工作空间</div><nav aria-label="主导航">{NAV_ITEMS.map((item) => <button key={item.id} className={'nav-item ' + (view === item.id ? 'active' : '')} onClick={() => setView(item.id)}><span className="nav-glyph" aria-hidden="true">{item.icon}</span>{item.label}{item.id === 'insights' && navAnomalyCount > 0 && <span className="nav-count">{navAnomalyCount}</span>}</button>)}</nav><div className="nav-label nav-label-settings">偏好设置</div><button className={'nav-item ' + (view === 'settings' ? 'active' : '')} onClick={() => setView('settings')}><span className="nav-glyph" aria-hidden="true">⚙</span>计费与规则</button><div className="sidebar-bottom"><div className="privacy-note"><span className="privacy-icon">◇</span><strong>你的代码，只属于你</strong><p>会话在浏览器本地分析。<br />不上传日志，不需要 API Key。</p><span className="local-status"><i />本地优先 · 隐私安全</span></div><div className="sidebar-footer"><span>TokenScope</span><span>v0.2.0</span></div></div></aside><div className="main-shell"><header className="topbar"><div className="breadcrumbs">工作空间 <span>/</span><strong>{NAV_ITEMS.find((item) => item.id === view)?.label ?? '计费与规则'}</strong></div><div className="topbar-right"><span className={'data-mode mode-' + analysisMode}><i />{modeLabel}</span><span className="topbar-divider" /><span className="collector-state"><i className={collectorStatus === 'collecting' ? 'pulse' : ''} />{collectorStatus === 'collecting' ? '采集中' : collectorStatus === 'stopped' ? '已停止' : collectorStatus === 'error' ? '需检查' : '本地服务'}</span><span className="avatar">W</span></div></header><main className="main-content"><div className="page-heading"><div><div className="eyebrow">LESS WASTE. MORE BUILDING.</div><h1>{view === 'overview' ? '成本总览' : NAV_ITEMS.find((item) => item.id === view)?.label ?? '计费与规则'}<span className="heading-dot">.</span></h1><p>{view === 'overview' ? '看清每一枚 Token 的去向，把预算花在真正的工作上。' : '保留记录、估算和证据，让每个判断都能回到原始会话。'}</p></div><div className="heading-actions"><button className="button secondary" onClick={analysisMode === 'live' && collectorStatus === 'collecting' ? stopCollection : handleDirectory} disabled={collectorStatus === 'loading'}>{analysisMode === 'live' && collectorStatus === 'collecting' ? '■ 停止采集' : '◉ 选择日志目录'}</button><button className="button primary" onClick={() => fileInputRef.current?.click()} disabled={collectorStatus === 'loading'}>＋ 导入 Session</button><input ref={fileInputRef} className="visually-hidden" type="file" accept=".jsonl,.json,.ndjson,.log" multiple onChange={(event) => { if (event.target.files) void handleFiles(event.target.files); event.currentTarget.value = ''; }} /></div></div><div className="filter-row"><div className="segmented" role="group" aria-label="Agent 筛选"><button className={providerFilter === 'all' ? 'selected' : ''} onClick={() => setProviderFilter('all')}>全部 Agent</button><button className={providerFilter === 'codex' ? 'selected' : ''} onClick={() => setProviderFilter('codex')}>Codex</button><button className={providerFilter === 'claude' ? 'selected' : ''} onClick={() => setProviderFilter('claude')}>Claude Code</button></div><div className="data-caption"><span className={'status-dot status-' + collectorStatus} />{collectorMessage}<span>·</span>最后数据 {formatRelativeTime(analysis.lastDataAt)}</div></div>{analysis.errors.length > 0 && <div className="warning-banner"><span>!</span><div><strong>部分来源未能完整解析</strong><p>{analysis.errors.length} 条记录被隔离；已知小计仍可查看，未知内容不会被填成零。</p><details className="error-details"><summary>查看受影响记录</summary><ul>{analysis.errors.slice(0, 8).map((error, index) => <li key={(error.sourceFile ?? 'error') + error.line + String(index)}>{error.sourceFile ?? '来源未知'} · {error.line > 0 ? '第 ' + String(error.line) + ' 行' : '文件级'} · {error.message}</li>)}</ul>{analysis.errors.length > 8 && <small>其余 {analysis.errors.length - 8} 条错误已折叠。</small>}</details></div><button onClick={() => setView('sessions')}>查看会话 ↗</button></div>}{view === 'overview' && renderOverview()}{view === 'sessions' && renderSessionsView()}{view === 'insights' && renderInsightsView()}{view === 'subagents' && renderSubagentsView()}{view === 'settings' && renderSettingsView()}<footer className="page-footer"><span><i className="tiny-dot" />所有数据仅在本地处理</span><span>{analysisMode === 'demo' ? '演示数据 · 合成费率' : '费用为估算 · 数据不代表真实账单'}</span><span>{liveSupported ? '目录实时采集可用' : '当前浏览器请使用文件导入'}</span></footer></main></div></div>;
}
