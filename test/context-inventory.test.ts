import assert from 'node:assert/strict';
import test from 'node:test';
import { buildAnalysis, parseJsonl } from '../lib/analysis';
import { contextInventoryIndex, contextSessionKey, extractContextSnapshots } from '../lib/context-inventory';

test('skills catalog components reconcile Unicode character lengths without unrelated instructions', () => {
  const section = '## Skills\n说明😀\n### Available skills\n- browser:control: 浏览器 (file: /skills/browser/SKILL.md)\n- tdd: 测试驱动\n';
  const snapshots = extractContextSnapshots({ type: 'response_item', payload: { role: 'developer', content: [{ type: 'input_text', text: '<skills_instructions>\n' + section + '</skills_instructions>\n## Permissions\nNot skills' }] } });
  assert.equal(snapshots.length, 1);
  const snapshot = snapshots[0];
  assert.equal(snapshot.category, 'skills');
  assert.equal(snapshot.chars, [...section].length);
  assert.equal(snapshot.components.reduce((sum, item) => sum + item.chars, 0), snapshot.chars);
  assert.deepEqual(snapshot.components.map((part) => part.name), ['公共说明与格式', 'browser:control', 'tdd']);
  assert.ok(!snapshot.components.some((part) => part.text.includes('Not skills')));
});

test('tool schema JSON records retain definitions and count formatting with explicit empty support', () => {
  const tools = [{ type: 'function', function: { name: 'read_file', description: '读取文件', parameters: { type: 'object' } } }];
  const snapshot = extractContextSnapshots({ type: 'request', tools })[0];
  assert.equal(snapshot.components[0].name, 'read_file');
  assert.equal(snapshot.chars, [...JSON.stringify(tools)].length);
  assert.equal(snapshot.components.reduce((sum, part) => sum + part.chars, 0), snapshot.chars);
  const empty = extractContextSnapshots({ type: 'turn_context', tools: [] })[0];
  assert.equal(empty.chars, 2);
  assert.equal(empty.components.filter((part) => !part.overhead).length, 0);
});

test('user quotations, tool results and generic skill instructions are not catalogs', () => {
  assert.deepEqual(extractContextSnapshots({ type: 'user', content: '## Skills\n- invented: do things' }), []);
  assert.deepEqual(extractContextSnapshots({ type: 'response_item', payload: { type: 'function_call_output', output: '# Tools\n### shell' } }), []);
  assert.deepEqual(extractContextSnapshots({ type: 'session_meta', payload: { base_instructions: { text: '# Using skills\nRead SKILL.md files' } } }), []);
});

test('long definition previews truncate without truncating measured lengths', () => {
  const definition = '## Tools\n### read_file\n' + '文😀'.repeat(4000);
  const snapshot = extractContextSnapshots({ type: 'system', text: definition })[0];
  assert.equal(snapshot.chars, [...definition].length);
  assert.equal(snapshot.components[1].truncated, true);
  assert.equal([...snapshot.components[1].text].length, 4000);
  assert.equal(snapshot.components.reduce((sum, part) => sum + part.chars, 0), snapshot.chars);
});

test('session inventory uses the latest snapshot without adding injections or altering cost', () => {
  const rows = [
    { type: 'session_meta', payload: { id: 's', base_instructions: { text: '## Skills\n- old: description' } } },
    { type: 'assistant', message: { id: 'call', model: 'gpt-5.6-sol', usage: { input_tokens: 100, output_tokens: 20 } } },
    { type: 'response_item', payload: { role: 'developer', content: [{ text: '## Skills\n- new: latest' }] } },
    { type: 'turn_context', payload: { tools: [], skills: [] } },
  ];
  const parsed = parseJsonl(rows.map((row, index) => JSON.stringify({ ...row, timestamp: new Date(1_000_000 + index * 1000).toISOString() })).join('\n'), { provider: 'codex', sourceFile: 'context.jsonl', sessionId: 's' });
  const result = buildAnalysis(parsed.events);
  const inventory = contextInventoryIndex(result.events).get(contextSessionKey('codex', 's'))!;
  assert.equal(inventory.skills?.contextSnapshot?.chars, 2);
  assert.equal(inventory.tools?.contextSnapshot?.chars, 2);
  assert.equal(inventory.observations.skills, 3);
  assert.equal(result.calls.length, 1);
  const without = buildAnalysis(parsed.events.filter((event) => event.kind !== 'context'));
  assert.deepEqual(result.usage, without.usage);
  assert.deepEqual(result.cost, without.cost);
  const claude = parsed.events.filter((event) => event.kind === 'context').slice(0, 1).map((event) => ({ ...event, provider: 'claude' as const }));
  assert.equal(contextInventoryIndex([...result.events, ...claude]).size, 2);
  assert.equal(contextInventoryIndex(result.events).get(contextSessionKey('codex', 'child')), undefined);
});
