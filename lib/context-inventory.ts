import type { AnalysisEvent, Provider } from './analysis';

export type ContextCategory = 'tools' | 'skills';
export interface ContextComponent {
  name: string;
  chars: number;
  text: string;
  truncated: boolean;
  overhead?: boolean;
}
export interface ContextSnapshot {
  category: ContextCategory;
  format: 'text' | 'json';
  chars: number;
  fingerprint: string;
  components: ContextComponent[];
}
export interface SessionContextInventory {
  tools?: AnalysisEvent;
  skills?: AnalysisEvent;
  observations: Record<ContextCategory, number>;
  usedTools: Map<string, number>;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}
function contentText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map((part) => typeof part === 'string' ? part : String(record(part)?.text ?? '')).join('\n');
  const object = record(value);
  return object ? contentText(object.content ?? object.text) : '';
}
function fingerprint(text: string): string {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  return (hash >>> 0).toString(16);
}
function component(name: string, text: string, overhead = false): ContextComponent {
  const characters = [...text];
  return { name, chars: characters.length, text: characters.slice(0, 4000).join(''), truncated: characters.length > 4000, overhead };
}

function textSnapshot(category: ContextCategory, text: string): ContextSnapshot {
  const entryPattern = category === 'skills' ? /^[-*] +([^\n]+?):[ \t]+/gm : /^### +([^\n]+)\r?$/gm;
  const entries = [...text.matchAll(entryPattern)];
  const components: ContextComponent[] = [];
  if (!entries.length) components.push(component('目录 / 定义正文', text, true));
  else {
    if (entries[0].index! > 0) components.push(component('公共说明与格式', text.slice(0, entries[0].index), true));
    entries.forEach((entry, index) => {
      components.push(component(entry[1].replace(/`/g, '').trim(), text.slice(entry.index, entries[index + 1]?.index ?? text.length)));
    });
  }
  return { category, format: 'text', chars: [...text].length, fingerprint: fingerprint(text), components };
}

/** Inspect explicit context records only, never user quotations or tool results. */
export function extractContextSnapshots(input: Record<string, unknown>): ContextSnapshot[] {
  const payload = record(input.payload) ?? input;
  const message = record(input.message);
  const type = String(input.type ?? '');
  const role = String(payload.role ?? message?.role ?? input.role ?? '');
  const permitted = ['system', 'developer'].includes(role) || ['system', 'developer', 'session_meta', 'turn_context', 'request', 'api_request', 'context'].includes(type);
  if (!permitted) return [];
  const result: ContextSnapshot[] = [];
  const text = type === 'session_meta' ? contentText(payload.base_instructions) : contentText(payload.content ?? message?.content ?? input.content ?? payload.text);
  const headings = [...text.matchAll(/^(#{1,6})[ \t]+(Tools|Skills)[ \t]*\r?$/gmi)];
  for (const heading of headings) {
    const start = heading.index!;
    const rest = text.slice(start + heading[0].length);
    const nextHeading = [...rest.matchAll(/^(#{1,6})[ \t]+[^\n]+/gm)].find((next) => next[1].length <= heading[1].length);
    const end = nextHeading ? start + heading[0].length + nextHeading.index! : text.length;
    // XML wrappers delimit injected skill blocks before subsequent instructions.
    const section = text.slice(start, end).split(/<\/(?:skills_instructions|tools)>/)[0];
    result.push(textSnapshot(heading[2].toLowerCase() as ContextCategory, section));
  }
  for (const category of ['tools', 'skills'] as const) {
    const definitions = payload[category] ?? input[category] ?? record(payload.request)?.[category];
    if (!Array.isArray(definitions)) continue;
    const serialized = JSON.stringify(definitions);
    const components = definitions.map((definition, index) => {
      const item = record(definition);
      const name = record(item?.function)?.name ?? item?.name ?? item?.type ?? category + ' ' + (index + 1);
      return component(String(name), JSON.stringify(definition));
    });
    // Account for array brackets and separators so component totals reconcile.
    components.push(component('JSON 数组格式', '[' + ','.repeat(Math.max(0, definitions.length - 1)) + ']', true));
    result.push({ category, format: 'json', chars: [...serialized].length, fingerprint: fingerprint(serialized), components });
  }
  return result;
}

export function contextSessionKey(provider: Provider, sessionId: string): string {
  return provider + ':' + sessionId;
}

export function contextInventoryIndex(events: readonly AnalysisEvent[]): Map<string, SessionContextInventory> {
  const result = new Map<string, SessionContextInventory>();
  for (const event of events) {
    if (!event.contextSnapshot && !event.toolName) continue;
    const key = contextSessionKey(event.provider, event.sessionId);
    const inventory = result.get(key) ?? { observations: { tools: 0, skills: 0 }, usedTools: new Map<string, number>() };
    if (event.toolName && (event.kind === 'tool' || event.kind === 'wait')) inventory.usedTools.set(event.toolName, (inventory.usedTools.get(event.toolName) ?? 0) + 1);
    if (event.contextSnapshot) {
      const category = event.contextSnapshot.category;
      inventory.observations[category]++;
      const previous = inventory[category];
      const previousTime = previous ? Date.parse(previous.timestamp) || 0 : -Infinity;
      const currentTime = Date.parse(event.timestamp) || 0;
      if (!previous || currentTime > previousTime || (currentTime === previousTime && event.sourceLine >= previous.sourceLine)) inventory[category] = event;
    }
    result.set(key, inventory);
  }
  return result;
}
