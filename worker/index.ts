import { Hono } from 'hono';
import { FalkorDB } from 'falkordb';
import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { bodyLimit } from 'hono/body-limit';
import { MemoryGraph, Conflict, connect } from './graph.ts';
import { PrincipalSchema, RecallSchema, validateSnapshot, KNOWLEDGE } from './schema.ts';
import type { Principal } from './schema.ts';
import { redact } from '../src/redact.ts';

export type Bindings = {
  FALKORDB_URL: string;
  ORG_MEMORY_API_KEYS: string;
  DEMO_ENABLED?: string;
  ASSETS: { fetch(request: Request): Promise<Response> };
};

export const app = new Hono<{ Bindings: Bindings; Variables: { principal: Principal } }>();
app.use('*', bodyLimit({ maxSize: 2 * 1024 * 1024, onError: c => c.json({ error: 'Request too large' }, 413) }));
app.use('/v1/*', async (c, next) => {
  if (!c.env.ORG_MEMORY_API_KEYS) return c.json({ error: 'API credentials are not configured' }, 503);
  const token = c.req.header('Authorization')?.replace(/^Bearer /, '') ?? '';
  let principal: Principal | undefined;
  try {
    const entries = JSON.parse(c.env.ORG_MEMORY_API_KEYS);
    for (const [expected, value] of Object.entries(entries)) {
      const a = new TextEncoder().encode(expected), b = new TextEncoder().encode(token);
      if (a.length === b.length && timingSafeEqual(a, b)) principal = PrincipalSchema.parse(value);
    }
  } catch { return c.json({ error: 'API credential configuration is invalid' }, 503); }
  if (!principal) return c.json({ error: 'Unauthorized' }, 401);
  c.set('principal', principal); await next();
});

async function useGraph<T>(env: Bindings, principal: Principal, repository: string, fn: (graph: MemoryGraph) => Promise<T>) {
  if (!principal.repos.includes(repository)) throw new Error('Repository access denied');
  const db = await connect(env.FALKORDB_URL);
  try { return await fn(new MemoryGraph(db, principal, repository)); }
  finally { await db.close(); }
}

app.post('/v1/ingest', async c => {
  const principal = c.get('principal');
  if (principal.role !== 'writer') return c.json({ error: 'Write access required' }, 403);
  const snapshot = validateSnapshot(await c.req.json());
  if (principal.org === 'demo' && snapshot.nodes.some(n => KNOWLEDGE.has(n.type) && n.source?.kind !== 'synthetic'))
    return c.json({ error: 'The public demo namespace accepts synthetic evidence only' }, 400);
  return c.json(await useGraph(c.env, principal, snapshot.repository, g => g.publish(snapshot)));
});
app.post('/v1/recall', async c => {
  const input = RecallSchema.parse(await c.req.json());
  return c.json(await useGraph(c.env, c.get('principal'), input.repository, g => g.recall(input)));
});
app.get('/v1/graph', async c => {
  const repo = c.req.query('repository') ?? '';
  return c.json(await useGraph(c.env, c.get('principal'), repo, g => g.snapshot()));
});
app.post('/v1/outcomes', async c => {
  const input = z.object({ repository: z.string(), kind: z.literal('synthetic_fixture_run'), check_id: z.literal('legacy-token-contract'),
    memory_version: z.string(), removal_exit: z.number().int(), compatible_exit: z.number().int(), output: z.string().max(12000) }).strict().parse(await c.req.json());
  const principal = c.get('principal');
  if (principal.role !== 'writer') return c.json({ error: 'Write access required' }, 403);
  return c.json(await useGraph(c.env, principal, input.repository, async g => {
    const version = await g.version();
    if (input.memory_version !== version) throw new Conflict('The memory version changed during the run');
    const report = { ...input, output: redact(input.output), evidence_level: 'client_reported_execution', recorded_at: new Date().toISOString() };
    await g.graph.query("CREATE (r:AgentOutcome {payload:$payload,at:$at}) RETURN r.at AS at", { params: { payload: JSON.stringify(report), at: report.recorded_at } });
    return { recorded: true, evidence_level: report.evidence_level };
  }));
});

const demoPrincipal: Principal = { org: 'demo', repos: ['demo/commerce'], role: 'reader' };
app.post('/demo/recall', async c => {
  if (c.env.DEMO_ENABLED !== 'true') return c.notFound();
  const input = RecallSchema.parse({ ...(await c.req.json()), repository: 'demo/commerce' });
  return c.json(await useGraph(c.env, demoPrincipal, 'demo/commerce', g => g.recall(input)));
});
app.get('/demo/graph', async c => {
  if (c.env.DEMO_ENABLED !== 'true') return c.notFound();
  return c.json(await useGraph(c.env, demoPrincipal, 'demo/commerce', g => g.snapshot()));
});
app.get('/demo/outcomes', async c => {
  if (c.env.DEMO_ENABLED !== 'true') return c.notFound();
  return c.json(await useGraph(c.env, demoPrincipal, 'demo/commerce', async g => {
    const result = await g.graph.roQuery<any>('MATCH (r:AgentOutcome) RETURN r.payload AS payload ORDER BY r.at DESC LIMIT 5');
    return { runs: (result.data ?? []).map(r => JSON.parse(r.payload)) };
  }));
});
app.get('/health', async (c) => {
  if (!c.env.FALKORDB_URL) return c.json({ ok: false, error: 'FALKORDB_URL is missing' }, 503);
  let db: FalkorDB | undefined;
  try {
    db = await connect(c.env.FALKORDB_URL);
    const result = await db.selectGraph('orgmem_health').query('RETURN 1 AS connected');
    return c.json({ ok: true, database: 'FalkorDB', connected: result.data });
  } catch {
    return c.json({ ok: false, error: 'FalkorDB connection failed' }, 503);
  } finally { await db?.close(); }
});
app.onError((error, c) => {
  if (error instanceof z.ZodError) return c.json({ error: 'Invalid request', issues: error.issues.map(i => ({ path: i.path, message: i.message })) }, 400);
  if (error instanceof Conflict) return c.json({ error: error.message }, 409);
  if (error.message === 'Repository access denied') return c.json({ error: error.message }, 403);
  const validation = /Duplicate node|snapshot may|identity does|Knowledge|Evidence quote|parent is missing|endpoint is missing|Supersession|Superseded/;
  if (validation.test(error.message)) return c.json({ error: error.message }, 400);
  if (error instanceof SyntaxError) return c.json({ error: 'Invalid JSON' }, 400);
  console.error('Memory request failed:', error.name);
  return c.json({ error: 'Memory service unavailable; check its database connection' }, 503);
});
app.all('/v1/*', c => c.json({ error: 'Not found' }, 404));
app.all('/demo/*', c => c.json({ error: 'Not found' }, 404));
app.all('*', (c) => c.env.ASSETS.fetch(c.req.raw));
export default app;
