import { z } from 'zod';

const text = z.string().max(16000);
const nodeId = z.string().min(1).max(400);
const fileRef = z.object({ slug: z.string(), rel: z.string() }).strict();
const quote = { evidence_quote: z.string().min(8).max(2000) };
const applicability = z.enum(['current', 'changed_since', 'not_on_main', 'unknown', 'unanchored']);
const provenance = z.object({
  kind: z.enum(['session_excerpt', 'git_observation', 'record_quote', 'synthetic']),
  source_id: z.string().min(1).max(300),
  locator: z.string().min(1).max(500),
  excerpt: z.string().min(8).max(40000),
  observed_at: z.iso.datetime(),
}).strict();

const schemas = {
  Repo: z.object({ slug: z.string(), clones: z.number().optional() }).strict(),
  Dir: z.object({ slug: z.string(), path: z.string() }).strict(),
  File: z.object({ slug: z.string(), rel: z.string(), fingerprint: z.string().regex(/^[a-f0-9]{64}$/).optional() }).strict(),
  Session: z.object({ project: z.string() }).strict(),
  Person: z.object({ email: z.string() }).strict(),
  Thing: z.object({ name: z.string() }).strict(),
  Commit: z.object({ sha: z.string(), slug: z.string(), landed: z.boolean(), ts: z.number(), subject: text }).strict(),
  Work: z.object({
    repos: z.array(z.string()), title: text, significance: z.number().min(1).max(5), goal: text,
    what_was_done: text, status: z.string(), things: z.array(z.string()), started: z.string(),
    ended: z.string(), person: z.string().nullable(), session: z.string(), project: z.string(),
    prompts: z.tuple([z.number(), z.number()]), verification: z.object({ commit: z.string(), tests: z.string() }).strict(),
  }).strict(),
  Decision: z.object({
    choice: text, why: text, ...quote, status: z.enum(['active', 'superseded', 'retracted']),
    work: nodeId, at: z.string(), file_status: applicability,
  }).strict(),
  Problem: z.object({ symptom: text, cause: text, resolution: text, ...quote, work: nodeId, at: z.string() }).strict(),
  Fact: z.object({
    statement: text, evidence_quote: z.string().max(2000).optional(), status: z.enum(['current', 'changed_since', 'not_on_main', 'unknown', 'unanchored', 'superseded', 'retracted']),
    work: nodeId.optional(), at: z.string(), kind: z.literal('config_history').optional(),
    key: z.string().optional(), path: z.string().optional(), changes: z.array(z.object({
      from: z.string().nullable(), to: z.string().nullable(), sha: z.string(), ts: z.number(), subject: text,
    }).strict()).max(5).optional(),
    origin: z.literal('git').optional(), check_id: z.enum(['legacy-token-contract']).optional(),
    assertion: z.object({ subject: nodeId, predicate: z.enum(['requires', 'depends_on', 'supports_format', 'has_status']), object: nodeId }).strict().optional(),
  }).strict(),
};

const typedNode = <T extends keyof typeof schemas>(type: T) =>
  z.object({ id: nodeId, type: z.literal(type), props: schemas[type], source: provenance.optional() }).strict();
export const NodeSchema = z.discriminatedUnion('type', [
  typedNode('Repo'), typedNode('Dir'), typedNode('File'), typedNode('Session'), typedNode('Person'),
  typedNode('Thing'), typedNode('Commit'), typedNode('Work'), typedNode('Decision'), typedNode('Problem'), typedNode('Fact'),
]);

export const RelationSchema = z.enum([
  'CONTAINS', 'IN_SESSION', 'AUTHORED_BY', 'MENTIONS', 'TOUCHED', 'REFERENCED', 'PRODUCED',
  'CHANGED', 'DECIDED', 'HIT', 'LEARNED', 'ABOUT', 'CO_CHANGED', 'SUPERSEDES',
]);
export const SnapshotSchema = z.object({
  repository: z.string().regex(/^[\w.-]+\/[\w.-]+$/),
  nodes: z.array(NodeSchema).min(1).max(3000),
  edges: z.array(z.object({ src: nodeId, rel: RelationSchema, dst: nodeId, w: z.number().min(0).max(100000).default(1) }).strict()).max(15000),
  expected_version: z.string().optional(),
}).strict();
export type Snapshot = z.infer<typeof SnapshotSchema>;
export type MemoryNode = Snapshot['nodes'][number];

export const RecallSchema = z.object({
  repository: z.string().min(1).max(200),
  query: z.string().max(2000).default(''),
  files: z.array(z.string().min(1).max(400)).max(12).default([]),
  fingerprints: z.record(z.string(), z.string().regex(/^[a-f0-9]{64}$/)).default({}),
  exclude_session: z.string().max(200).optional(),
  limit: z.number().int().min(1).max(12).default(4),
  max_chars: z.number().int().min(200).max(12000).default(6000),
  graph_expansion: z.boolean().default(true),
  types: z.array(z.enum(['Fact', 'Decision', 'Problem'])).max(3).default([]),
}).strict();
export type Recall = z.infer<typeof RecallSchema>;
export const PrincipalSchema = z.object({ org: z.string().min(1), repos: z.array(z.string()).min(1), role: z.enum(['reader', 'writer']) }).strict();
export type Principal = z.infer<typeof PrincipalSchema>;
export const KNOWLEDGE = new Set(['Decision', 'Problem', 'Fact']);

export function validateSnapshot(input: unknown): Snapshot {
  const snapshot = SnapshotSchema.parse(input);
  const nodes = new Map(snapshot.nodes.map(n => [n.id, n]));
  if (nodes.size !== snapshot.nodes.length) throw new Error('Duplicate node IDs');
  for (const node of snapshot.nodes) {
    const p = node.props as Record<string, any>;
    if (p.slug && p.slug !== snapshot.repository || p.repos?.some((r: string) => r !== snapshot.repository))
      throw new Error('A snapshot may contain only its declared repository');
    if (node.type === 'File' && node.id !== `file:${snapshot.repository}:${p.rel}`)
      throw new Error('File identity does not match repository/path');
    if (KNOWLEDGE.has(node.type)) {
      if (!node.source) throw new Error('Knowledge nodes require source provenance');
      const evidence = p.evidence_quote ?? p.statement;
      if (!evidence || !normalize(node.source.excerpt).includes(normalize(evidence)))
        throw new Error('Evidence quote is absent from the supplied source excerpt');
      if (p.work && nodes.get(p.work)?.type !== 'Work') throw new Error('Knowledge parent is missing');
    }
  }
  for (const edge of snapshot.edges) if (!nodes.has(edge.src) || !nodes.has(edge.dst))
    throw new Error('Edge endpoint is missing');
  for (const node of snapshot.nodes) {
    const assertion = (node.props as any).assertion;
    if (assertion && (!nodes.has(assertion.subject) || !nodes.has(assertion.object)))
      throw new Error('Assertion endpoint is missing');
  }
  for (const edge of snapshot.edges.filter(e => e.rel === 'SUPERSEDES')) {
    if (!KNOWLEDGE.has(nodes.get(edge.src)!.type) || !KNOWLEDGE.has(nodes.get(edge.dst)!.type))
      throw new Error('Supersession must connect knowledge nodes');
    if ((nodes.get(edge.dst)!.props as any).status !== 'superseded')
      throw new Error('Superseded targets must be marked superseded');
  }
  const replacements = new Map<string, string[]>();
  for (const e of snapshot.edges.filter(e => e.rel === 'SUPERSEDES')) replacements.set(e.src, [...(replacements.get(e.src) ?? []), e.dst]);
  const visiting = new Set<string>(), visited = new Set<string>();
  const visit = (id: string) => {
    if (visiting.has(id)) throw new Error('Supersession cycle');
    if (visited.has(id)) return;
    visiting.add(id);
    for (const target of replacements.get(id) ?? []) visit(target);
    visiting.delete(id); visited.add(id);
  };
  for (const id of replacements.keys()) visit(id);
  return snapshot;
}

export const normalize = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();
export function knowledgeStatus(node: MemoryNode): string {
  const p = node.props as Record<string, any>;
  if (['superseded', 'retracted'].includes(p.status)) return p.status;
  if (node.type === 'Decision') return p.file_status;
  if (node.type === 'Fact') return p.status;
  if (node.type === 'Problem') return /not resolved|unresolved/i.test(p.resolution) ? 'unresolved' : 'current';
  return 'structural';
}
