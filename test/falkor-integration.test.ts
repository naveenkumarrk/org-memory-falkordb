import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { MemoryGraph, connect, Conflict } from '../worker/graph.ts';
import { RecallSchema } from '../worker/schema.ts';
import { demoSnapshot } from '../fixtures/memory.ts';

test('real FalkorDB: publication, traversal, invalidation, history isolation and writer conflicts', { skip: !process.env.FALKORDB_URL, timeout: 15000 }, async () => {
  const db = await connect(process.env.FALKORDB_URL!);
  const principal = { org: `test-${randomUUID()}`, repos: ['demo/commerce'], role: 'writer' as const };
  const graph = new MemoryGraph(db, principal, 'demo/commerce');
  const other = new MemoryGraph(db, { ...principal, org: `other-${randomUUID()}` }, 'demo/commerce');
  try {
    assert.deepEqual((await graph.snapshot()).nodes, [], 'first import can inspect an empty namespace without creating it');
    const published = await graph.publish(demoSnapshot());
    assert.equal((await graph.publish(demoSnapshot())).unchanged, true);
    const query = RecallSchema.parse({ repository: 'demo/commerce', files: ['src/authentication.ts'] });
    const recall = await graph.recall(query);
    assert.ok(recall.items.some(i => i.id === 'F-client-contract'));
    assert.equal(recall.backend, 'FalkorDB');
    assert.ok(recall.trace.some(q => q.cypher.includes('MATCH p=') && q.rows > 0));
    assert.deepEqual(recall.items.find(i => i.id === 'F-client-contract').path.relations, ['TOUCHED', 'LEARNED']);
    assert.equal((await graph.recall({ ...query, graph_expansion: false })).items.length, 0);
    const prompt = RecallSchema.parse({ repository: 'demo/commerce', query: 'Simplify src/authentication.ts' });
    assert.deepEqual((await graph.recall(prompt)).anchors, ['file:demo/commerce:src/authentication.ts']);
    assert.equal((await graph.recall({ ...prompt, graph_expansion: false })).items.length, 0);
    assert.equal((await graph.recall({ ...query, types: ['Problem'] })).items.length, 0);
    assert.equal((await other.recall(query)).items.length, 0);
    assert.equal((await graph.recall({ ...query, exclude_session: 'discovery' })).items.length, 0);
    const changed = await graph.recall({ ...query, fingerprints: { 'src/authentication.ts': '0'.repeat(64) } });
    assert.equal(changed.items.length, 0); assert.equal(changed.warnings.length, 1);
    const narrow = await graph.recall({ ...query, max_chars: 200 });
    assert.ok(narrow.context.length <= 200);
    const migrated = demoSnapshot(true); migrated.expected_version = published.version;
    await graph.publish(migrated);
    const after = await graph.recall(query);
    assert.deepEqual(after.items.map(i => i.id), ['F-migrated-client']);
    assert.equal((await graph.snapshot()).nodes.find(n => n.id === 'F-client-contract')?.props.status, 'superseded');
    const stale = demoSnapshot(); stale.expected_version = published.version;
    await assert.rejects(() => graph.publish(stale), Conflict);
  } finally {
    try { await graph.graph.delete(); }
    finally { await db.close(); }
  }
});
