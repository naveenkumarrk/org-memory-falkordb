import test from 'node:test';
import assert from 'node:assert/strict';
import { app } from '../worker/index.ts';
import { validateSnapshot } from '../worker/schema.ts';
import { demoSnapshot } from '../fixtures/memory.ts';
import { mergeSnapshot } from '../worker/merge.ts';

test('strict schema admits the synthetic baseline and explicit supersession', () => {
  assert.equal(validateSnapshot(demoSnapshot()).nodes.length, 8);
  assert.equal(validateSnapshot(demoSnapshot(true)).edges.filter(e => e.rel === 'SUPERSEDES').length, 2);
});
test('a writer cannot supply its own verification flag', () => {
  const s: any = demoSnapshot(); s.nodes.find((n: any) => n.type === 'Fact').props.verified = true;
  assert.throws(() => validateSnapshot(s));
});
test('quotes must occur in source evidence', () => {
  const s: any = demoSnapshot(); s.nodes.find((n: any) => n.type === 'Fact').source.excerpt = 'An unrelated source sentence.';
  assert.throws(() => validateSnapshot(s), /Evidence quote/);
});
test('cross-repository nodes and dangling edges are rejected', () => {
  const s: any = demoSnapshot(); s.nodes.find((n: any) => n.type === 'File').props.slug = 'private/other';
  assert.throws(() => validateSnapshot(s), /declared repository/);
  const edge: any = demoSnapshot(); edge.edges[0].dst = 'missing';
  assert.throws(() => validateSnapshot(edge), /endpoint/);
});
test('supersession cannot leave an active replacement target', () => {
  const s: any = demoSnapshot(true); s.nodes.find((n: any) => n.id === 'F-client-contract').props.status = 'current';
  assert.throws(() => validateSnapshot(s), /marked superseded/);
});
test('local publication preserves teammates and does not resurrect superseded facts', () => {
  const shared = demoSnapshot(true);
  shared.nodes.push({ id: 'thing:teammate', type: 'Thing', props: { name: 'Teammate discovery' } });
  const merged = mergeSnapshot({ version: 'previous', nodes: shared.nodes, edges: shared.edges }, demoSnapshot());
  assert.ok(merged.nodes.some(n => n.id === 'thing:teammate'));
  assert.equal((merged.nodes.find(n => n.id === 'F-client-contract')!.props as any).status, 'superseded');
  assert.equal(merged.expected_version, 'previous');
});

const env: any = { FALKORDB_URL: 'redis://127.0.0.1:1', ORG_MEMORY_API_KEYS: JSON.stringify({ testkey: { org: 'test', repos: ['demo/commerce'], role: 'reader' } }), DEMO_ENABLED: 'false' };
test('API rejects missing credentials before accessing a database', async () => {
  const response = await app.request('/v1/graph?repository=demo/commerce', {}, env);
  assert.equal(response.status, 401);
});
test('API enforces repository membership and read-only keys', async () => {
  const headers = { Authorization: 'Bearer testkey', 'Content-Type': 'application/json' };
  assert.equal((await app.request('/v1/graph?repository=private/other', { headers }, env)).status, 403);
  assert.equal((await app.request('/v1/ingest', { method: 'POST', headers, body: JSON.stringify(demoSnapshot()) }, env)).status, 403);
});
test('malformed requests and disabled public demo are handled', async () => {
  const response = await app.request('/v1/recall', { method: 'POST', headers: { Authorization: 'Bearer testkey', 'Content-Type': 'application/json' }, body: '{}' }, env);
  assert.equal(response.status, 400);
  assert.equal((await app.request('/demo/graph', {}, env)).status, 404);
});
