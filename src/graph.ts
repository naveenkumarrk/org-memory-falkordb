// Work records + git -> graph.db: nodes(id, type, props) and edges(src, rel, dst, w), plus an FTS index.
// Node ids are deterministic and readable, so the same File/Commit/Person always merges into one node.
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { CORPUS, dataDir } from './config.ts';
import type { Corpus } from './config.ts';
import { loadRecords } from './backfill.ts';
import type { FileRef } from './repo.ts';
import { findClones, RepoIndex } from './git.ts';
import { loadSettings } from './settings.ts';
import { configHistory, historyStatement } from './confighistory.ts';
import crypto from 'node:crypto';

export const id = {
  repo: (slug: string) => `repo:${slug}`,
  dir: (slug: string, d: string) => `dir:${slug}:${d}`,
  file: (f: FileRef) => `file:${f.slug}:${f.rel}`,
  commit: (slug: string, sha: string) => `commit:${slug}:${sha}`,
  person: (email: string) => `person:${email.toLowerCase()}`,
  session: (s: string) => `session:${s}`,
  thing: (t: string) => `thing:${t.trim().toLowerCase()}`,
};

const SCHEMA = `
CREATE TABLE nodes(id TEXT PRIMARY KEY, type TEXT NOT NULL, props TEXT NOT NULL);
CREATE TABLE edges(src TEXT NOT NULL, rel TEXT NOT NULL, dst TEXT NOT NULL, w REAL NOT NULL DEFAULT 1, PRIMARY KEY (src, rel, dst));
CREATE INDEX edges_dst ON edges(dst, rel);
CREATE INDEX nodes_type ON nodes(type);
CREATE VIRTUAL TABLE fts USING fts5(id UNINDEXED, type UNINDEXED, text, tokenize='porter unicode61');
CREATE TABLE meta(k TEXT PRIMARY KEY, v TEXT);
`;

export function graphPath(corpus: Corpus): string {
  return path.join(dataDir(corpus), 'graph.db');
}

export function openGraph(corpus: Corpus): DatabaseSync {
  return new DatabaseSync(graphPath(corpus), { readOnly: true });
}

export type GraphData = { nodes: Array<{ id: string; type: string; props: Record<string, any> }>; edges: Array<{ src: string; rel: string; dst: string; w: number }> };
export function build(corpus: Corpus, log: (s: string) => void = () => {}, opts: { before?: string; out?: string; collect?: boolean } = {}) {
  const t0 = Date.now();
  // --before builds a time-split graph (only work that ended before the cutoff) for replay tests
  const excluded = new Set(loadSettings().excludedSessions);
  const records = loadRecords(corpus).filter((r) => (!opts.before || r.ended < opts.before) && !excluded.has(r.session));
  const target = opts.out ?? graphPath(corpus);
  const tmp = `${target}.tmp`;
  if (!opts.collect) { fs.mkdirSync(path.dirname(target), { recursive: true }); fs.rmSync(tmp, { force: true }); }
  // The shared backend consumes a snapshot compiled in memory. No SQLite file is its data store.
  const db = new DatabaseSync(opts.collect ? ':memory:' : tmp);
  db.exec(SCHEMA);
  const insNode = db.prepare('INSERT OR REPLACE INTO nodes(id, type, props) VALUES (?, ?, ?)');
  const insEdge = db.prepare('INSERT INTO edges(src, rel, dst, w) VALUES (?, ?, ?, ?) ON CONFLICT(src, rel, dst) DO UPDATE SET w = max(w, excluded.w)');
  const insFts = db.prepare('INSERT INTO fts(id, type, text) VALUES (?, ?, ?)');
  const seen = new Set<string>();
  const node = (nid: string, type: string, props: Record<string, unknown> = {}) => {
    if (seen.has(nid) && Object.keys(props).length === 0) return nid;
    seen.add(nid);
    insNode.run(nid, type, JSON.stringify(props));
    return nid;
  };
  const edge = (src: string, rel: string, dst: string, w = 1) => insEdge.run(src, rel, dst, w);

  const clones = findClones(CORPUS[corpus].repoRoot);
  const repos = new Map<string, RepoIndex>();
  const repoIdx = (slug: string) => {
    if (!repos.has(slug)) repos.set(slug, new RepoIndex(slug, clones.get(slug) ?? []));
    return repos.get(slug)!;
  };
  const fileNode = (f: FileRef) => {
    const fid = id.file(f);
    if (seen.has(fid)) return fid;
    node(id.repo(f.slug), 'Repo', { slug: f.slug, clones: (clones.get(f.slug) ?? []).length });
    let parent = id.repo(f.slug);
    const parts = f.rel.split('/');
    for (let i = 1; i < parts.length; i++) {
      const did = id.dir(f.slug, parts.slice(0, i).join('/'));
      if (!seen.has(did)) { node(did, 'Dir', { slug: f.slug, path: parts.slice(0, i).join('/') }); edge(parent, 'CONTAINS', did); }
      parent = did;
    }
    const root = repoIdx(f.slug).roots[0];
    let fingerprint: string | undefined;
    try { if (root) fingerprint = crypto.createHash('sha256').update(fs.readFileSync(path.join(root, f.rel))).digest('hex'); } catch { /* unavailable file */ }
    node(fid, 'File', { slug: f.slug, rel: f.rel, ...(fingerprint ? { fingerprint } : {}) });
    edge(parent, 'CONTAINS', fid);
    return fid;
  };
  const anchoredStatus = (files: FileRef[], since: string, ownShas: string[] = []): string => {
    if (!files.length) return 'unanchored';
    const states = files.map((f) => (repoIdx(f.slug).roots.length ? repoIdx(f.slug).fileState(f.rel, since, ownShas) : 'unknown'));
    return states.includes('changed_since') ? 'changed_since' : states.includes('unknown') ? 'unknown' : states.every((s) => s === 'not_on_main') ? 'not_on_main' : 'current';
  };

  db.exec('BEGIN');
  const touchedFiles = new Map<string, Set<string>>();
  const noteTouched = (f: FileRef) => { if (!touchedFiles.has(f.slug)) touchedFiles.set(f.slug, new Set()); touchedFiles.get(f.slug)!.add(f.rel); };
  let commitsLinked = 0;
  // work items with no file link inherit the author seen elsewhere in the same session
  const sessionPerson = new Map<string, string>();
  for (const r of records) if (r.person && !sessionPerson.has(r.session)) sessionPerson.set(r.session, r.person);
  for (const r of records) {
    r.person = r.person ?? sessionPerson.get(r.session) ?? null;
    // verification from git: linked commits and test runs
    // a commit attributed to the wrong repo (multi-repo work) is looked up in the other known repos and re-attributed
    const commitInfos = r.commits.map((c) => {
      let info = repoIdx(c.slug).commit(c.sha);
      if (!info) for (const other of clones.keys()) if (other !== c.slug && (info = repoIdx(other).commit(c.sha))) { c = { ...c, slug: other }; break; }
      return { c, info };
    });
    const landed = commitInfos.some((x) => x.info?.landed);
    const committed = commitInfos.some((x) => x.info);
    const ownShas = commitInfos.map((x) => x.info?.full ?? x.c.sha);
    const tests = r.tests.length ? (r.tests[r.tests.length - 1].pass ? 'passed' : 'failed') : 'none';
    const verification = { commit: landed ? 'landed' : committed ? 'committed' : r.commits.length ? 'not_found' : 'none', tests };
    const repos = [...new Set([...r.touched, ...r.referenced].map((f) => f.slug).concat(r.commits.map((c) => c.slug)))];
    const w = node(r.id, 'Work', {
      repos, title: r.title, significance: (r as any).significance ?? 3, goal: r.goal, what_was_done: r.what_was_done, status: r.status, things: r.things,
      started: r.started, ended: r.ended, person: r.person, session: r.session, project: r.project, prompts: r.prompts, verification,
    });
    insFts.run(r.id, 'Work', `${r.title}\n${r.goal}\n${r.what_was_done}\n${r.things.join(' ')}`);
    edge(w, 'IN_SESSION', node(id.session(r.session), 'Session', { project: r.project }));
    if (r.person) edge(w, 'AUTHORED_BY', node(id.person(r.person), 'Person', { email: r.person }));
    for (const t of r.things) if (t.trim()) edge(w, 'MENTIONS', node(id.thing(t), 'Thing', { name: t.trim() }));
    for (const f of r.touched) { edge(w, 'TOUCHED', fileNode(f), 1); noteTouched(f); }
    for (const f of r.referenced) { edge(w, 'REFERENCED', fileNode(f), 0.6); noteTouched(f); }
    for (const { c, info } of commitInfos) {
      if (!info) continue;
      commitsLinked++;
      const cid = node(id.commit(c.slug, info.full), 'Commit', { sha: info.full, slug: c.slug, landed: info.landed, ts: info.ts, subject: info.subject });
      edge(w, 'PRODUCED', cid);
      for (const rel of info.files) {
        const f = { slug: c.slug, rel };
        edge(cid, 'CHANGED', fileNode(f));
        edge(w, 'TOUCHED', fileNode(f), 0.9);
        noteTouched(f);
      }
    }
    for (const d of r.decisions) {
      const did = node(d.id, 'Decision', { choice: d.choice, why: d.why, evidence_quote: d.evidence_quote, status: 'active', work: r.id, at: r.ended, file_status: anchoredStatus(d.files, r.ended, ownShas) });
      edge(w, 'DECIDED', did);
      for (const f of d.files) edge(did, 'ABOUT', fileNode(f));
      insFts.run(d.id, 'Decision', `${d.choice}\n${d.why}`);
    }
    for (const p of r.problems) {
      const pid = node(p.id, 'Problem', { symptom: p.symptom, cause: p.cause, resolution: p.resolution, evidence_quote: p.evidence_quote, work: r.id, at: r.ended });
      edge(w, 'HIT', pid);
      for (const f of p.files) edge(pid, 'ABOUT', fileNode(f));
      insFts.run(p.id, 'Problem', `${p.symptom}\n${p.cause}\n${p.resolution}`);
    }
    for (const fa of r.facts) {
      const fid = node(fa.id, 'Fact', { statement: fa.statement, evidence_quote: fa.evidence_quote, status: anchoredStatus(fa.files, r.ended, ownShas), work: r.id, at: r.ended });
      edge(w, 'LEARNED', fid);
      for (const f of fa.files) edge(fid, 'ABOUT', fileNode(f));
      insFts.run(fa.id, 'Fact', fa.statement);
    }
  }
  // Config value history from git (respects the time split), one fact per changed key, attached to the config file
  let cfgFacts = 0;
  for (const [slug] of clones) {
    if (!(CORPUS[corpus].org === null || slug.startsWith(`${CORPUS[corpus].org}/`))) continue;
    const idx = repoIdx(slug);
    const root = idx.roots[0];
    const ref = root ? idx.ref(root) : null;
    if (!root || !ref) continue;
    for (const h of configHistory(root, ref, opts.before)) {
      const last = h.changes[h.changes.length - 1];
      const fid = `F-cfg-${crypto.createHash('sha1').update(`${slug}|${h.path}|${h.key}`).digest('hex').slice(0, 10)}`;
      const statement = historyStatement(h);
      node(fid, 'Fact', { statement, kind: 'config_history', key: h.key, path: h.path, changes: h.changes.slice(-5), status: 'current', origin: 'git', at: new Date(last.ts * 1000).toISOString() });
      edge(fid, 'ABOUT', fileNode({ slug, rel: h.path }));
      insFts.run(fid, 'Fact', `${statement}\n${h.key.split('.').join(' ')}`);
      cfgFacts++;
    }
  }

  // CO_CHANGED from git history, only around files that carry memory
  let co = 0;
  for (const [slug, rels] of touchedFiles) {
    const idx = repoIdx(slug);
    if (!idx.roots.length) continue;
    for (const rel of rels) {
      for (const [other, n] of idx.coChanged(rel)) {
        edge(fileNode({ slug, rel }), 'CO_CHANGED', fileNode({ slug, rel: other }), n);
        co++;
      }
    }
  }
  const counts = db.prepare('SELECT type, count(*) n FROM nodes GROUP BY type').all();
  const ecounts = db.prepare('SELECT rel, count(*) n FROM edges GROUP BY rel').all();
  db.prepare('INSERT INTO meta(k, v) VALUES (?, ?)').run('built', JSON.stringify({ at: new Date().toISOString(), records: records.length, commitsLinked, coChangeEdges: co, configFacts: cfgFacts, before: opts.before ?? null, ms: Date.now() - t0 }));
  db.exec('COMMIT');
  const snapshot: GraphData | undefined = opts.collect ? {
    nodes: (db.prepare('SELECT id,type,props FROM nodes').all() as any[]).map(n => ({ id: n.id, type: n.type, props: JSON.parse(n.props) })),
    edges: db.prepare('SELECT src,rel,dst,w FROM edges').all() as GraphData['edges'],
  } : undefined;
  db.close();
  if (!opts.collect) fs.renameSync(tmp, target);
  log(`graph built in ${Date.now() - t0} ms → ${opts.collect ? 'in-memory upload snapshot' : target}`);
  return { records: records.length, commitsLinked, configFacts: cfgFacts, nodes: counts, edges: ecounts, snapshot };
}
