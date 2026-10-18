import fs from 'node:fs';
import path from 'node:path';
import { build } from './graph.ts';
import { loadRecords } from './backfill.ts';
import { dataDir } from './config.ts';
import type { Corpus } from './config.ts';
import { remoteConfig, remoteRequest } from './remote.ts';
import { KNOWLEDGE, validateSnapshot } from '../worker/schema.ts';
import { mergeSnapshot } from '../worker/merge.ts';

export async function publish(corpus: Corpus, log: (s: string) => void = () => {}) {
  const config = remoteConfig();
  if (!config) throw new Error('Configure remote.json or ORG_MEMORY_API_URL / ORG_MEMORY_API_TOKEN first');
  const compiled = build(corpus, log, { collect: true }).snapshot!;
  const records = new Map(loadRecords(corpus).map(r => [r.id, r]));
  const repositories = compiled.nodes.filter(n => n.type === 'Repo').map(n => n.props.slug as string);
  const results = [];
  for (const repository of repositories) {
    // Build a single-repository view. Mixed-repository work is omitted rather than leaking its other scope.
    const workIds = new Set(compiled.nodes.filter(n => n.type === 'Work' && n.props.repos.length === 1 && n.props.repos[0] === repository).map(n => n.id));
    const selected = new Set(compiled.nodes.filter(n => n.props.slug === repository || workIds.has(n.id) || workIds.has(n.props.work)).map(n => n.id));
    for (const e of compiled.edges) if (workIds.has(e.src) && ['IN_SESSION', 'AUTHORED_BY', 'MENTIONS'].includes(e.rel)) selected.add(e.dst);
    const nodes = compiled.nodes.filter(n => selected.has(n.id)).map(n => {
      if (!KNOWLEDGE.has(n.type)) return n;
      const record = records.get(n.props.work);
      let excerpt: string | undefined;
      if (record) try { excerpt = fs.readFileSync(path.join(dataDir(corpus), 'cache', 'extract', 'sources', `${record.extractor.chunk}.txt`), 'utf8'); } catch { /* legacy record */ }
      const evidence = n.props.evidence_quote ?? n.props.statement;
      return { ...n, source: {
        kind: excerpt ? 'session_excerpt' : 'record_quote',
        source_id: record ? `session:${record.session}:${record.extractor.chunk}` : `record:${n.id}`,
        locator: record ? `session://${record.session}/prompts/${record.prompts.join('-')}` : `record://${n.id}`,
        excerpt: excerpt ?? evidence,
        observed_at: n.props.at,
      } };
    });
    const snapshot = validateSnapshot({ repository, nodes, edges: compiled.edges.filter(e => selected.has(e.src) && selected.has(e.dst)) });
    const current = await remoteRequest(config, `/v1/graph?repository=${encodeURIComponent(repository)}`);
    results.push({ repository, ...(await remoteRequest(config, '/v1/ingest', mergeSnapshot(current, snapshot), 20000)) });
  }
  return results;
}
