// Local UI server for org-memory. Binds 127.0.0.1 only — the data is company work history; never expose or publish it.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { dataDir, CORPUS } from './config.ts';
import type { Corpus } from './config.ts';
import { graphPath } from './graph.ts';
import { relatedToFiles, relatedToPrompt, renderCards, resolveTarget, knowledgeForFiles, knowledgeForPrompt, problemsForError, renderItems } from './query.ts';
import { loadSettings, saveSettings, loadOverrides, setOverride, loadTeam, saveTeam, repoIncluded, loadFeedback, addVote, feedbackByWork } from './settings.ts';
import { install, status as installStatus } from './install.ts';
import type { Settings } from './settings.ts';

const UI_DIR = path.join(path.dirname(new URL(import.meta.url).pathname), 'ui');
const CLI = path.join(path.dirname(new URL(import.meta.url).pathname), 'cli.ts');
type Row = Record<string, any>;
const J = (s: string) => JSON.parse(s);

const dbs = new Map<string, { db: DatabaseSync; mtime: number }>();
function db(corpus: Corpus): DatabaseSync | null {
  const p = graphPath(corpus);
  if (!fs.existsSync(p)) return null;
  const mtime = fs.statSync(p).mtimeMs;
  const cur = dbs.get(corpus);
  if (cur && cur.mtime === mtime) return cur.db;
  cur?.db.close();
  const d = new DatabaseSync(p, { readOnly: true });
  dbs.set(corpus, { db: d, mtime });
  return d;
}

const LABEL: Record<string, (p: Row, id: string) => string> = {
  Work: (p) => p.title, Decision: (p) => p.choice, Problem: (p) => p.symptom, Fact: (p) => p.statement,
  File: (p) => p.rel?.split('/').pop(), Dir: (p) => `${p.path}/`, Repo: (p) => p.slug, Commit: (p) => `${String(p.sha).slice(0, 7)}${p.landed ? ' ✓' : ''}`,
  Person: (p) => String(p.email).split('@')[0], Thing: (p) => p.name, Session: (_p, id) => `session ${id.slice(8, 16)}`,
};

function stats(d: DatabaseSync, corpus: Corpus) {
  const q = (sql: string, ...a: any[]) => d.prepare(sql).all(...a) as Row[];
  const ov = loadOverrides(corpus);
  const meta = q("SELECT v FROM meta WHERE k = 'built'")[0];
  const logFile = path.join(dataDir(corpus), 'logs', 'hook.jsonl');
  const events = fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8').trim().split('\n').slice(-2000).map(J) : [];
  const day = events.filter((e) => Date.now() - Date.parse(e.ts) < 86_400_000);
  const ms = day.map((e) => e.ms).sort((a, b) => a - b);
  return {
    built: meta ? J(meta.v) : null,
    nodes: Object.fromEntries(q('SELECT type, count(*) n FROM nodes GROUP BY type').map((r) => [r.type, r.n])),
    edges: Object.fromEntries(q('SELECT rel, count(*) n FROM edges GROUP BY rel').map((r) => [r.rel, r.n])),
    verification: Object.fromEntries(q("SELECT json_extract(props,'$.verification.commit') k, count(*) n FROM nodes WHERE type='Work' GROUP BY 1").map((r) => [r.k, r.n])),
    factStatus: Object.fromEntries(q("SELECT json_extract(props,'$.status') k, count(*) n FROM nodes WHERE type='Fact' GROUP BY 1").map((r) => [r.k, r.n])),
    byRepo: q("SELECT value AS repo, count(*) n FROM nodes n, json_each(json_extract(n.props,'$.repos')) WHERE n.type='Work' GROUP BY value ORDER BY n DESC"),
    byMonth: q("SELECT substr(json_extract(props,'$.ended'),1,10) d, count(*) n FROM nodes WHERE type='Work' GROUP BY 1 ORDER BY 1"),
    overrides: { hidden: ov.hidden.length, pinned: ov.pinned.length },
    hooks24h: { events: day.length, injected: day.filter((e) => e.cards.length && !e.shadow).length, wouldInject: day.filter((e) => e.cards.length).length, cards: day.reduce((n, e) => n + e.cards.length, 0), p50ms: ms[Math.floor(ms.length / 2)] ?? null, p95ms: ms[Math.floor(ms.length * 0.95)] ?? null },
  };
}

function works(d: DatabaseSync, corpus: Corpus, u: URLSearchParams) {
  const ov = loadOverrides(corpus);
  const where: string[] = ["n.type = 'Work'"];
  const args: any[] = [];
  const q = u.get('q')?.trim();
  if (q) {
    where.push("n.id IN (SELECT CASE WHEN f.type = 'Work' THEN f.id ELSE (SELECT src FROM edges WHERE dst = f.id AND rel IN ('DECIDED','HIT','LEARNED') LIMIT 1) END FROM fts f WHERE fts MATCH ?)");
    args.push(q.split(/\s+/).filter(Boolean).map((w) => `"${w.replace(/"/g, '')}"*`).join(' AND '));
  }
  if (u.get('repo')) { where.push("EXISTS (SELECT 1 FROM json_each(json_extract(n.props,'$.repos')) WHERE value = ?)"); args.push(u.get('repo')); }
  if (u.get('person')) { where.push("json_extract(n.props,'$.person') = ?"); args.push(u.get('person')); }
  if (u.get('status')) { where.push("json_extract(n.props,'$.status') = ?"); args.push(u.get('status')); }
  if (u.get('verif')) { where.push("json_extract(n.props,'$.verification.commit') = ?"); args.push(u.get('verif')); }
  if (u.get('minsig')) { where.push("coalesce(json_extract(n.props,'$.significance'), 3) >= ?"); args.push(Number(u.get('minsig'))); }
  const order = u.get('sort') === 'sig' ? "coalesce(json_extract(n.props,'$.significance'), 3) DESC, json_extract(n.props,'$.ended') DESC" : "json_extract(n.props,'$.ended') DESC";
  const limit = Math.min(200, Number(u.get('limit') ?? 50));
  const offset = Number(u.get('offset') ?? 0);
  let rows: Row[];
  try {
    rows = d.prepare(`SELECT n.id, n.props,
      (SELECT count(*) FROM edges e WHERE e.src = n.id AND e.rel = 'DECIDED') decisions,
      (SELECT count(*) FROM edges e WHERE e.src = n.id AND e.rel = 'HIT') problems,
      (SELECT count(*) FROM edges e WHERE e.src = n.id AND e.rel = 'LEARNED') facts,
      (SELECT count(*) FROM edges e WHERE e.src = n.id AND e.rel IN ('TOUCHED','REFERENCED')) files
      FROM nodes n WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT ? OFFSET ?`).all(...args, limit + 1, offset) as Row[];
  } catch { rows = []; }
  const showHidden = u.get('hidden') === '1';
  const list = rows.slice(0, limit).map((r) => ({ id: r.id, ...J(r.props), counts: { decisions: r.decisions, problems: r.problems, facts: r.facts, files: r.files }, hidden: ov.hidden.includes(r.id), pinned: ov.pinned.includes(r.id), note: ov.notes[r.id] }))
    .filter((w) => showHidden || !w.hidden);
  return { items: list, more: rows.length > limit };
}

function workDetail(d: DatabaseSync, corpus: Corpus, wid: string) {
  const n = d.prepare('SELECT props FROM nodes WHERE id = ?').get(wid) as Row | undefined;
  if (!n) return null;
  const ov = loadOverrides(corpus);
  const kids = d.prepare('SELECT e.rel, e.w, n.id, n.type, n.props FROM edges e JOIN nodes n ON n.id = e.dst WHERE e.src = ?').all(wid) as Row[];
  const about = d.prepare("SELECT dst FROM edges WHERE src = ? AND rel = 'ABOUT'");
  const kid = (rel: string) => kids.filter((k) => k.rel === rel).map((k) => ({ id: k.id, ...J(k.props), files: (about.all(k.id) as Row[]).map((a) => a.dst) }));
  return {
    id: wid, ...J(n.props), hidden: ov.hidden.includes(wid), pinned: ov.pinned.includes(wid), note: ov.notes[wid] ?? '',
    decisions: kid('DECIDED'), problems: kid('HIT'), facts: kid('LEARNED'), commits: kid('PRODUCED'),
    files: kids.filter((k) => k.rel === 'TOUCHED' || k.rel === 'REFERENCED').map((k) => ({ id: k.id, rel: k.rel, w: k.w })),
    things: kids.filter((k) => k.rel === 'MENTIONS').map((k) => J(k.props).name),
    feedback: feedbackByWork(corpus).get(wid) ?? { up: 0, down: 0 },
    // other work that changed the same files, most shared files first
    related: (d.prepare(`SELECT o.src AS id, count(*) AS shared, n.props FROM edges t JOIN edges o ON o.dst = t.dst AND o.rel = 'TOUCHED' AND o.src <> t.src
      JOIN nodes n ON n.id = o.src WHERE t.src = ? AND t.rel = 'TOUCHED' GROUP BY o.src ORDER BY shared DESC, json_extract(n.props,'$.ended') DESC LIMIT 6`).all(wid) as Row[])
      .map((r) => { const p = J(r.props); return { id: r.id, shared: r.shared, title: p.title, ended: p.ended, status: p.status }; }),
  };
}

function fileDetail(d: DatabaseSync, corpus: Corpus, fid: string) {
  const n = d.prepare('SELECT props FROM nodes WHERE id = ?').get(fid) as Row | undefined;
  if (!n) return null;
  const works = (d.prepare(`SELECT e.rel, e.w, w.id, w.props FROM edges e JOIN nodes w ON w.id = e.src WHERE e.dst = ? AND e.rel IN ('TOUCHED','REFERENCED')
    ORDER BY json_extract(w.props,'$.ended') DESC`).all(fid) as Row[]).map((r) => ({ id: r.id, rel: r.rel, ...J(r.props) }));
  const about = (d.prepare(`SELECT k.id, k.type, k.props FROM edges a JOIN nodes k ON k.id = a.src WHERE a.dst = ? AND a.rel = 'ABOUT'
    ORDER BY json_extract(k.props,'$.at') DESC`).all(fid) as Row[]).map((r) => ({ id: r.id, type: r.type, ...J(r.props) }));
  const co = (d.prepare("SELECT dst, w FROM edges WHERE src = ? AND rel = 'CO_CHANGED' ORDER BY w DESC LIMIT 12").all(fid) as Row[]).map((r) => ({ id: r.dst, commits: r.w }));
  const ov = loadOverrides(corpus);
  return { id: fid, ...J(n.props), works: works.map((w) => ({ ...w, hidden: ov.hidden.includes(w.id) })), about, cochanged: co };
}

function sessions(d: DatabaseSync, s: Settings) {
  const rows = d.prepare(`SELECT json_extract(props,'$.session') AS id, json_extract(props,'$.project') AS project, count(*) AS works,
      min(json_extract(props,'$.started')) AS started, max(json_extract(props,'$.ended')) AS ended,
      avg(json_extract(props,'$.significance')) AS sig FROM nodes WHERE type = 'Work' GROUP BY 1 ORDER BY ended DESC`).all() as Row[];
  const repoOf = d.prepare("SELECT DISTINCT j.value AS repo FROM nodes w, json_each(json_extract(w.props,'$.repos')) j WHERE w.type = 'Work' AND json_extract(w.props,'$.session') = ?");
  return rows.map((r) => ({ ...r, sig: r.sig ? Math.round(r.sig * 10) / 10 : null, repos: (repoOf.all(r.id) as Row[]).map((x) => x.repo), excluded: s.excludedSessions.includes(r.id) }));
}

function shadowEvents(d: DatabaseSync, corpus: Corpus, limit: number) {
  const fb = loadFeedback(corpus).votes;
  const getW = d.prepare('SELECT type, props FROM nodes WHERE id = ?');
  const events = tail(path.join(dataDir(corpus), 'logs', 'hook.jsonl'), 3000).map(J).filter((e) => e.cards?.length).reverse().slice(0, limit);
  return events.map((e) => ({
    ...e,
    cards: e.cards.map((c: Row) => {
      const w = getW.get(c.work) as Row | undefined;
      const raw = w ? J(w.props) : {};
      // knowledge items (decision/problem/fact) carry their text; work items their title
      const p = !w ? {} : w.type === 'Work' ? raw : { title: `[${raw.kind === 'config_history' ? 'Config history' : w.type}] ${String(LABEL[w.type]?.(raw, c.work) ?? '')}`, what_was_done: raw.why ? `why: ${raw.why}` : raw.resolution ? `resolution: ${raw.resolution}` : '', ended: raw.at };
      const mine = fb.find((v) => v.work === c.work && v.session === e.session && v.target === e.target);
      return { ...c, title: p.title ?? '(no longer in graph)', what: p.what_was_done, ended: p.ended, significance: p.significance, vote: mine?.vote ?? null };
    }),
  }));
}

// Hubs (a person, a topic, a session, a repo, a folder) connect to almost everything; they are shown but never
// expanded through, except when they are the starting node. This mirrors how retrieval walks the graph.
const HUBS = new Set(['Person', 'Thing', 'Session', 'Repo', 'Dir']);

// Relations in order of how much they explain; used to pick which neighbours to show when a node has many.
const REL_RANK: Record<string, number> = { DECIDED: 0, HIT: 1, LEARNED: 2, PRODUCED: 3, TOUCHED: 4, ABOUT: 5, CO_CHANGED: 6, CHANGED: 7, REFERENCED: 8, AUTHORED_BY: 9, MENTIONS: 10, CONTAINS: 11, IN_SESSION: 12 };

// Neighbourhood for the graph view: BFS from the start node with a fan-out cap per node (most explanatory relation
// first, then most recent), hubs not expanded, and each node's distance from the centre for a radial layout.
function neighborhood(d: DatabaseSync, start: string, depth: number, rels: string[] | null, cap = 140, fanStart = 14, fanOther = 6) {
  const nodes = new Map<string, Row>();
  const edges: Row[] = [];
  const getN = d.prepare('SELECT id, type, props FROM nodes WHERE id = ?');
  const out = d.prepare('SELECT src, rel, dst, w FROM edges WHERE src = ?');
  const inc = d.prepare('SELECT src, rel, dst, w FROM edges WHERE dst = ?');
  const deg = d.prepare('SELECT (SELECT count(*) FROM edges WHERE src = ?) + (SELECT count(*) FROM edges WHERE dst = ?) AS n');
  const load = (id: string) => {
    const n = getN.get(id) as Row | undefined;
    if (!n) return null;
    const p = J(n.props);
    const full = String(LABEL[n.type]?.(p, id) ?? id);
    return { id, type: n.type, label: full.length > 56 ? `${full.slice(0, 55)}…` : full, full, props: p };
  };
  const first = load(start);
  if (!first) return { nodes: [], edges: [] };
  nodes.set(start, { ...first, level: 0 });
  let frontier = [start];
  for (let level = 1; level <= depth; level++) {
    const next: string[] = [];
    for (const id of frontier) {
      if (id !== start && HUBS.has(nodes.get(id)?.type)) continue;
      const cands = [...(out.all(id) as Row[]), ...(inc.all(id) as Row[])]
        .filter((e) => !rels || rels.includes(e.rel))
        .map((e) => { const other = e.src === id ? e.dst : e.src; return { e, other, n: nodes.get(other) ?? load(other) }; })
        .filter((c) => c.n)
        .sort((a, b) => (REL_RANK[a.e.rel] ?? 99) - (REL_RANK[b.e.rel] ?? 99) || String(b.n!.props.ended ?? b.n!.props.at ?? '').localeCompare(String(a.n!.props.ended ?? a.n!.props.at ?? '')));
      let taken = 0;
      for (const c of cands) {
        if (nodes.has(c.other)) { edges.push(c.e); continue; }
        if (taken >= (id === start ? fanStart : fanOther) || nodes.size >= cap) continue;
        nodes.set(c.other, { ...c.n!, level });
        edges.push(c.e);
        next.push(c.other);
        taken++;
      }
    }
    frontier = next;
  }
  for (const n of nodes.values()) n.degree = (deg.get(n.id, n.id) as Row).n;
  const seenE = new Set<string>();
  return { nodes: [...nodes.values()], edges: edges.filter((e) => nodes.has(e.src) && nodes.has(e.dst)).filter((e) => { const k = `${e.src}|${e.rel}|${e.dst}`; if (seenE.has(k)) return false; seenE.add(k); return true; }) };
}

// Global graph (Obsidian-style): work items and the files they changed, plus co-change between those files;
// optionally the decisions/problems/facts of each work item. Light props only, capped for a smooth canvas.
function globalGraph(d: DatabaseSync, repo: string | null, withKnowledge: boolean, cap = 2600) {
  const works = (repo
    ? d.prepare("SELECT n.id, n.props FROM nodes n WHERE n.type = 'Work' AND EXISTS (SELECT 1 FROM json_each(json_extract(n.props,'$.repos')) WHERE value = ?) ORDER BY json_extract(n.props,'$.ended') DESC LIMIT 900").all(repo)
    : d.prepare("SELECT n.id, n.props FROM nodes n WHERE n.type = 'Work' ORDER BY json_extract(n.props,'$.ended') DESC LIMIT 900").all()) as Row[];
  const nodes = new Map<string, Row>();
  const edges: Row[] = [];
  const add = (id: string, type: string, label: string, extra: Row = {}) => { if (!nodes.has(id) && nodes.size < cap) nodes.set(id, { id, type, label: label.length > 56 ? `${label.slice(0, 55)}…` : label, ...extra }); return nodes.has(id); };
  const files = d.prepare("SELECT dst, rel FROM edges WHERE src = ? AND rel IN ('TOUCHED','REFERENCED')");
  const kids = d.prepare("SELECT e.rel, n.id, n.type, n.props FROM edges e JOIN nodes n ON n.id = e.dst WHERE e.src = ? AND e.rel IN ('DECIDED','HIT','LEARNED')");
  for (const w of works) {
    const p = J(w.props);
    add(w.id, 'Work', p.title, { ended: p.ended, significance: p.significance, status: p.status, landed: p.verification?.commit === 'landed' });
    for (const f of files.all(w.id) as Row[]) {
      if (repo && !String(f.dst).startsWith(`file:${repo}:`)) continue;
      if (add(f.dst, 'File', String(f.dst).split('/').pop())) edges.push({ src: w.id, rel: f.rel, dst: f.dst });
    }
    if (withKnowledge) for (const k of kids.all(w.id) as Row[]) {
      const kp = J(k.props);
      if (add(k.id, k.type, kp.statement ?? kp.choice ?? kp.symptom ?? k.id)) edges.push({ src: w.id, rel: k.rel, dst: k.id });
    }
  }
  const co = d.prepare("SELECT dst, w FROM edges WHERE src = ? AND rel = 'CO_CHANGED' AND w >= 3");
  for (const n of [...nodes.values()]) if (n.type === 'File') for (const c of co.all(n.id) as Row[]) if (nodes.has(c.dst) && n.id < c.dst) edges.push({ src: n.id, rel: 'CO_CHANGED', dst: c.dst, w: c.w });
  const degree = new Map<string, number>();
  for (const e of edges) { degree.set(e.src, (degree.get(e.src) ?? 0) + 1); degree.set(e.dst, (degree.get(e.dst) ?? 0) + 1); }
  return { nodes: [...nodes.values()].map((n) => ({ ...n, degree: degree.get(n.id) ?? 0 })), edges };
}

function repos(d: DatabaseSync, s: Settings) {
  const rows = d.prepare("SELECT r.id, json_extract(r.props,'$.clones') clones, (SELECT count(*) FROM nodes w, json_each(json_extract(w.props,'$.repos')) j WHERE w.type='Work' AND j.value = substr(r.id, 6)) works FROM nodes r WHERE r.type='Repo' ORDER BY works DESC").all() as Row[];
  return rows.map((r) => ({ slug: r.id.slice(5), clones: r.clones, works: r.works, include: repoIncluded(s, r.id.slice(5)) }));
}

function people(d: DatabaseSync) {
  return d.prepare("SELECT json_extract(p.props,'$.email') email, (SELECT count(*) FROM edges e WHERE e.dst = p.id AND e.rel = 'AUTHORED_BY') works FROM nodes p WHERE p.type = 'Person' ORDER BY works DESC").all() as Row[];
}

function tail(file: string, n: number): string[] {
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim().split('\n').slice(-n) : [];
}

const jobs = new Map<string, { started: string; done?: string; code?: number | null }>();
function runJob(corpus: Corpus, action: string) {
  if ([...jobs.values()].some((j) => !j.done)) return { error: 'a job is already running' };
  const args = action === 'build' ? ['build'] : action === 'backfill' ? ['backfill'] : null;
  if (!args) return { error: 'unknown action' };
  if (corpus === 'test') args.push('--test');
  const logDir = path.join(dataDir(corpus), 'logs');
  fs.mkdirSync(logDir, { recursive: true });
  const log = fs.openSync(path.join(logDir, `ui-${action}.log`), 'w');
  const key = `${corpus}:${action}`;
  jobs.set(key, { started: new Date().toISOString() });
  const child = spawn(process.execPath, ['--no-warnings', CLI, ...args], { stdio: ['ignore', log, log] });
  child.on('close', (code) => { jobs.set(key, { ...jobs.get(key)!, done: new Date().toISOString(), code }); });
  return { started: key };
}

function send(res: http.ServerResponse, code: number, body: unknown, type = 'application/json') {
  res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(type === 'application/json' ? JSON.stringify(body) : (body as string));
}

async function readBody(req: http.IncomingMessage): Promise<any> {
  let s = '';
  for await (const c of req) s += c;
  return s ? J(s) : {};
}

const MIME: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };

export function serve(port: number) {
  const server = http.createServer(async (req, res) => {
    try {
      const u = new URL(req.url ?? '/', 'http://127.0.0.1');
      const corpus = (u.searchParams.get('corpus') === 'test' ? 'test' : 'prod') as Corpus;
      if (!u.pathname.startsWith('/api/')) {
        const f = path.join(UI_DIR, u.pathname === '/' ? 'index.html' : path.normalize(u.pathname).replace(/^(\.\.[/\\])+/, ''));
        if (!f.startsWith(UI_DIR) || !fs.existsSync(f)) return send(res, 404, 'not found', 'text/plain');
        return send(res, 200, fs.readFileSync(f, 'utf8'), MIME[path.extname(f)] ?? 'text/plain');
      }
      // Writes need a custom header: browsers cannot send it cross-origin without a preflight we never answer.
      if (req.method === 'POST' && req.headers['x-orgmem'] !== '1') return send(res, 403, { error: 'missing x-orgmem header' });
      const d = db(corpus);
      const s = loadSettings();
      switch (u.pathname) {
        case '/api/meta': return send(res, 200, { org: CORPUS.prod.org, corpora: { prod: !!db('prod'), test: !!db('test') }, settings: s, jobs: Object.fromEntries(jobs) });
        case '/api/settings':
          if (req.method === 'POST') return send(res, 200, saveSettings(await readBody(req)));
          return send(res, 200, s);
        case '/api/team':
          if (req.method === 'POST') return send(res, 200, saveTeam(corpus, await readBody(req)));
          return send(res, 200, { ...loadTeam(corpus), people: d ? people(d) : [], repos: d ? repos(d, s) : [] });
        case '/api/override': {
          const b = await readBody(req);
          return send(res, 200, setOverride(corpus, b.id, b.action, b.note));
        }
        case '/api/action': {
          const b = await readBody(req);
          return send(res, 200, runJob(corpus, b.action));
        }
        case '/api/health': {
          const lock = (f: string) => fs.existsSync(path.join(dataDir(corpus), f));
          const meta = d ? (d.prepare("SELECT v FROM meta WHERE k = 'built'").get() as Row | undefined) : undefined;
          const built = meta ? J(meta.v) : null;
          return send(res, 200, {
            install: installStatus(), settings: s,
            graph: built ? { ...built, ageMin: Math.round((Date.now() - Date.parse(built.at)) / 60000) } : null,
            sync: { running: lock('sync.lock'), last: tail(path.join(dataDir(corpus), 'logs', 'sync.log'), 3) },
            backfill: { running: lock('backfill.lock') },
          });
        }
        case '/api/mode': {
          // changes ~/.claude/settings.json (hooks for every session); the UI asks for confirmation first
          const b = await readBody(req);
          if (!['shadow', 'on', 'off', 'uninstall'].includes(b.mode)) return send(res, 400, { error: 'mode must be shadow|on|off|uninstall' });
          return send(res, 200, install(b.mode));
        }
        case '/api/feedback': {
          const b = await readBody(req);
          if (!['up', 'down', 'clear'].includes(b.vote) || !b.work) return send(res, 400, { error: 'work and vote (up|down|clear) required' });
          addVote(corpus, { work: b.work, vote: b.vote, session: b.session, target: b.target });
          return send(res, 200, { ok: true, totals: feedbackByWork(corpus).get(b.work) ?? { up: 0, down: 0 } });
        }
        case '/api/exclude-session': {
          const b = await readBody(req);
          const set = new Set(s.excludedSessions);
          b.exclude ? set.add(b.id) : set.delete(b.id);
          return send(res, 200, saveSettings({ excludedSessions: [...set] }));
        }
        case '/api/activity':
          return send(res, 200, {
            hooks: tail(path.join(dataDir(corpus), 'logs', 'hook.jsonl'), Number(u.searchParams.get('limit') ?? 200)).map(J).reverse(),
            sync: tail(path.join(dataDir(corpus), 'logs', 'sync.log'), 40),
            backfill: tail(path.join(dataDir(corpus), 'logs', corpus === 'prod' ? 'backfill-prod.log' : 'backfill-test.log'), 20),
            jobs: Object.fromEntries(jobs),
          });
      }
      if (!d) return send(res, 200, { empty: true, hint: `no graph yet; run: orgmem build${corpus === 'test' ? ' --test' : ''}` });
      switch (u.pathname) {
        case '/api/stats': return send(res, 200, stats(d, corpus));
        case '/api/works': return send(res, 200, works(d, corpus, u.searchParams));
        case '/api/work': return send(res, 200, workDetail(d, corpus, u.searchParams.get('id') ?? ''));
        case '/api/repos': return send(res, 200, repos(d, s));
        case '/api/file': return send(res, 200, fileDetail(d, corpus, u.searchParams.get('id') ?? ''));
        case '/api/top-files':
          return send(res, 200, (d.prepare(`SELECT e.dst AS id, count(DISTINCT e.src) AS works, max(json_extract(w.props,'$.ended')) AS last FROM edges e JOIN nodes w ON w.id = e.src
            WHERE e.rel = 'TOUCHED' GROUP BY e.dst ORDER BY works DESC LIMIT 30`).all() as Row[]));
        case '/api/sessions': return send(res, 200, sessions(d, s));
        case '/api/session': {
          const sid = u.searchParams.get('id') ?? '';
          const rows = (d.prepare("SELECT id, props FROM nodes WHERE type = 'Work' AND json_extract(props,'$.session') = ? ORDER BY json_extract(props,'$.prompts[0]')").all(sid) as Row[]).map((r) => ({ id: r.id, ...J(r.props) }));
          return send(res, 200, { id: sid, excluded: s.excludedSessions.includes(sid), works: rows });
        }
        case '/api/shadow': {
          const ev = shadowEvents(d, corpus, Number(u.searchParams.get('limit') ?? 100));
          const votes = loadFeedback(corpus).votes;
          return send(res, 200, { events: ev, stats: { events: ev.length, cards: ev.reduce((n, e) => n + e.cards.length, 0), votes: votes.length, up: votes.filter((v) => v.vote === 'up').length, down: votes.filter((v) => v.vote === 'down').length } });
        }
        case '/api/graph': {
          const rels = u.searchParams.get('rels');
          return send(res, 200, neighborhood(d, u.searchParams.get('id') ?? '', Math.min(3, Number(u.searchParams.get('depth') ?? 1)), rels ? rels.split(',') : null));
        }
        case '/api/graph-global':
          return send(res, 200, globalGraph(d, u.searchParams.get('repo') || null, u.searchParams.get('knowledge') === '1'));
        case '/api/find': {
          const q = (u.searchParams.get('q') ?? '').toLowerCase();
          const rows = d.prepare("SELECT id, type, props FROM nodes WHERE type IN ('File','Thing','Work','Person','Repo') AND lower(id || ' ' || props) LIKE ? ORDER BY type = 'File' DESC LIMIT 20").all(`%${q}%`) as Row[];
          return send(res, 200, rows.map((r) => ({ id: r.id, type: r.type, label: LABEL[r.type]?.(J(r.props), r.id) ?? r.id })));
        }
        case '/api/preview': {
          // "What would the agent see?" — the exact text the hook would inject, with optional unsaved weights.
          const mode = u.searchParams.get('mode') ?? 'file';
          const input = u.searchParams.get('input') ?? '';
          const tweak = u.searchParams.get('settings');
          const ss: Settings = tweak ? { ...s, ...J(tweak), weights: { ...s.weights, ...(J(tweak).weights ?? {}) }, show: { ...s.show, ...(J(tweak).show ?? {}) } } : s;
          const t0 = performance.now();
          let cards; let header; let anchors: string[] = [];
          if (ss.delivery === 'knowledge') {
            let items;
            if (mode === 'error') { items = problemsForError(d, input, { corpus, settings: ss, limit: 2 }); header = 'This error was seen before'; }
            else if (mode === 'prompt') { const r = knowledgeForPrompt(d, input, { corpus, settings: ss, limit: ss.itemsPerTrigger }); items = r.items; anchors = r.anchors; header = 'Known from past work related to this request'; }
            else { anchors = resolveTarget(d, input); items = anchors.length ? knowledgeForFiles(d, anchors, { corpus, settings: ss, limit: ss.itemsPerTrigger }) : []; header = `Known about ${anchors.map((a) => a.replace(/^file:/, '')).join(', ')}`; }
            const ms = performance.now() - t0;
            return send(res, 200, { anchors, cards: items.map((i) => ({ work: i.id, title: `[${i.type}] ${i.text}`, via: i.via, score: i.score })), text: renderItems(items, header), ms });
          }
          if (mode === 'prompt') {
            const r = relatedToPrompt(d, input, { corpus, settings: ss, limit: ss.cardsPerTrigger });
            cards = r.cards; anchors = r.anchors; header = 'Past work related to this request';
          } else {
            anchors = resolveTarget(d, input);
            cards = anchors.length ? relatedToFiles(d, anchors, { corpus, settings: ss, limit: ss.cardsPerTrigger }) : [];
            header = `Past work on ${anchors.map((a) => a.replace(/^file:/, '')).join(', ')}`;
          }
          const ms = performance.now() - t0;
          return send(res, 200, { anchors, cards, text: renderCards(cards, header, ss), ms });
        }
      }
      return send(res, 404, { error: 'unknown endpoint' });
    } catch (e) {
      return send(res, 500, { error: String((e as Error).message ?? e) });
    }
  });
  server.listen(port, '127.0.0.1', () => process.stderr.write(`org-memory UI → http://127.0.0.1:${port}\n`));
}
