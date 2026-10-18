// Past sessions -> validated work records (JSONL per session) under <dataDir>/records.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { CORPUS, PROJECTS_DIR, EXTRACT, dataDir } from './config.ts';
import type { Corpus } from './config.ts';
import { listSessionFiles, parseSession } from './transcript.ts';
import { toTurns, toChunks, isSubstantive } from './condense.ts';
import type { Chunk, CommitRef, TestRun, Turn } from './condense.ts';
import { extractChunk, pool, chunkKey, extractModel } from './extract.ts';
import { loadSettings } from './settings.ts';
import type { RawItem } from './extract.ts';
import type { FileRef } from './repo.ts';
import { personFor } from './repo.ts';

export type Decision = { id: string; choice: string; why: string; evidence_quote: string; files: FileRef[] };
export type Problem = { id: string; symptom: string; cause: string; resolution: string; evidence_quote: string; files: FileRef[] };
export type Fact = { id: string; statement: string; evidence_quote: string; files: FileRef[] };
export type WorkRecord = {
  id: string; type: 'work'; corpus: Corpus; session: string; project: string;
  title: string; goal: string; what_was_done: string; status: string; significance: number; things: string[];
  started: string; ended: string; prompts: [number, number];
  touched: FileRef[]; referenced: FileRef[]; commits: CommitRef[]; tests: TestRun[];
  person: string | null; decisions: Decision[]; problems: Problem[]; facts: Fact[];
  extractor: { model: string; prompt_version: string; chunk: string };
};

const hash = (s: string) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 10);
const norm = (s: string) => s.replace(/…/g, '...').replace(/\s+/g, ' ').trim().toLowerCase();

export type Stats = { sessions: number; chunks: number; skippedChunks: number; extracted: number; cached: number; errors: number;
  works: number; decisions: number; problems: number; facts: number; droppedQuotes: number; droppedFileIds: number; costUsd: number; ms: number };

function quoteOk(quote: string, hay: string): boolean {
  const parts = norm(quote).split('...').map((p) => p.trim()).filter((p) => p.length >= 8);
  return parts.length > 0 && parts.every((p) => hay.includes(p));
}

function mapIds(ids: number[], files: FileRef[], st: Stats): FileRef[] {
  const out: FileRef[] = [];
  for (const i of ids ?? []) {
    const f = files[i - 1];
    if (!f) { st.droppedFileIds++; continue; }
    if (!out.some((x) => x.slug === f.slug && x.rel === f.rel)) out.push(f);
  }
  return out;
}

function toRecord(raw: RawItem, chunk: Chunk, turns: Turn[], s: { id: string; project: string }, corpus: Corpus, chunkKey: string, st: Stats): WorkRecord | null {
  const hay = norm(chunk.text);
  const first = Math.max(chunk.first, Math.min(raw.first_prompt, chunk.last));
  const last = Math.max(first, Math.min(raw.last_prompt, chunk.last));
  const span = turns.filter((t) => t.idx >= first && t.idx <= last);
  if (!span.length || !raw.title?.trim()) return null;
  const touched: FileRef[] = [];
  for (const t of span) for (const f of [...t.edits, ...t.bashWrites]) if (!touched.some((x) => x.slug === f.slug && x.rel === f.rel)) touched.push(f);
  // attribution: a file counts only if the item's own prompts changed, read or ran it (not a later prompt in the same chunk)
  const seenInSpan = new Set(span.flatMap((t) => [...t.edits, ...t.bashWrites, ...t.reads]).map((f) => `${f.slug}:${f.rel}`));
  const inSpan = (fs: FileRef[]) => fs.filter((f) => seenInSpan.has(`${f.slug}:${f.rel}`));
  const chosen = inSpan(mapIds(raw.files, chunk.files, st));
  const referenced = chosen.filter((f) => !touched.some((x) => x.slug === f.slug && x.rel === f.rel));
  const commits: CommitRef[] = span.flatMap((t) => t.commits);
  // `git commit -q` prints no SHA; accept SHAs the extractor saw in the excerpt (e.g. in the agent's reply), verified against git at build time.
  const spanSlug = touched[0]?.slug ?? chosen[0]?.slug ?? span.flatMap((t) => t.lines.map((l) => l.match(/BASH\(([^)]+)\)[^\n]*\bcommit\b/)?.[1])).find(Boolean) ?? null;
  for (const sha of raw.commits ?? []) {
    const s7 = sha.trim().toLowerCase();
    if (!/^[0-9a-f]{7,40}$/.test(s7) || !hay.includes(s7) || commits.some((c) => c.sha.startsWith(s7) || s7.startsWith(c.sha))) continue;
    if (spanSlug) commits.push({ slug: spanSlug, sha: s7, branch: '' });
  }
  const tests: TestRun[] = span.flatMap((t) => t.tests);
  const id = `W-${hash(`${s.id}|${first}|${raw.title}`)}`;
  const keep = <T extends { evidence_quote: string }>(xs: T[]) => (xs ?? []).filter((x) => {
    const ok = quoteOk(x.evidence_quote, hay);
    if (!ok) st.droppedQuotes++;
    return ok;
  });
  const decisions = keep(raw.decisions).map((d, i) => ({ id: `D-${hash(`${id}|d${i}|${d.choice}`)}`, choice: d.choice, why: d.why, evidence_quote: d.evidence_quote, files: inSpan(mapIds(d.files, chunk.files, st)) }));
  const problems = keep(raw.problems).map((p, i) => ({ id: `P-${hash(`${id}|p${i}|${p.symptom}`)}`, symptom: p.symptom, cause: p.cause, resolution: p.resolution, evidence_quote: p.evidence_quote, files: inSpan(mapIds(p.files, chunk.files, st)) }));
  const facts = keep(raw.facts).map((f, i) => ({ id: `F-${hash(`${id}|f${i}|${f.statement}`)}`, statement: f.statement, evidence_quote: f.evidence_quote, files: inSpan(mapIds(f.files, chunk.files, st)) }));
  const slug = touched[0]?.slug ?? chosen[0]?.slug ?? commits[0]?.slug ?? null;
  return {
    id, type: 'work', corpus, session: s.id, project: s.project,
    title: raw.title.trim(), goal: raw.goal, what_was_done: raw.what_was_done, status: raw.status, significance: raw.significance ?? 3, things: raw.things ?? [],
    started: span[0].ts, ended: span[span.length - 1].endTs, prompts: [first, last],
    touched, referenced, commits, tests, person: slug ? personFor(slug) : null,
    decisions, problems, facts,
    extractor: { model: extractModel(), prompt_version: EXTRACT.promptVersion, chunk: chunkKey },
  };
}

export async function backfill(corpus: Corpus, opts: { limit?: number; session?: string; since?: string; dryRun?: boolean; log?: (s: string) => void }): Promise<Stats> {
  const log = opts.log ?? (() => {});
  const dir = dataDir(corpus);
  const recDir = path.join(dir, 'records');
  const cacheDir = path.join(dir, 'cache', 'extract');
  const tmpDir = path.join(dir, 'tmp');
  for (const d of [recDir, cacheDir, tmpDir]) fs.mkdirSync(d, { recursive: true });

  let files = listSessionFiles(CORPUS[corpus].projectPrefix, PROJECTS_DIR);
  const seen = new Set<string>();
  if (opts.session) {
    // earlier sessions are parsed only to learn which message uuids are copies (resumed/forked history), not extracted
    const idx = files.findIndex((f) => path.basename(f, '.jsonl').startsWith(opts.session!));
    for (const f of files.slice(0, Math.max(0, idx))) parseSession(f, seen);
    files = idx >= 0 ? [files[idx]] : [];
  }
  if (opts.since) files = files.filter((f) => fs.statSync(f).mtime.toISOString() >= opts.since!);
  const excluded = new Set(loadSettings().excludedSessions);
  files = files.filter((f) => !excluded.has(path.basename(f, '.jsonl')));
  if (opts.limit) files = files.slice(-opts.limit);

  const st: Stats = { sessions: 0, chunks: 0, skippedChunks: 0, extracted: 0, cached: 0, errors: 0, works: 0, decisions: 0, problems: 0, facts: 0, droppedQuotes: 0, droppedFileIds: 0, costUsd: 0, ms: 0 };
  const jobs: Array<{ s: { id: string; project: string }; turns: Turn[]; chunk: Chunk }> = [];
  for (const f of files) {
    const s = parseSession(f, seen);
    const turns = toTurns(s, corpus);
    const chunks = toChunks(s.id, turns, EXTRACT.chunkChars);
    st.sessions++;
    for (const c of chunks) {
      const span = turns.filter((t) => t.idx >= c.first && t.idx <= c.last);
      if (!span.some(isSubstantive)) { st.skippedChunks++; continue; }
      jobs.push({ s, turns, chunk: c });
    }
  }
  st.chunks = jobs.length;
  log(`sessions=${st.sessions} chunks=${st.chunks} skipped=${st.skippedChunks}`);
  if (opts.dryRun) return st;

  const t0 = Date.now();
  // a full run holds backfill.lock so the live-sync Stop hook stays out of the way; single-session syncs don't
  const lockFile = path.join(dir, 'backfill.lock');
  if (!opts.session) fs.writeFileSync(lockFile, String(process.pid));
  const bySession = new Map<string, WorkRecord[]>();
  let done = 0;
  await pool(jobs, Number(process.env.ORG_MEMORY_CONCURRENCY ?? loadSettings().extraction.concurrency ?? EXTRACT.concurrency), async (job) => {
    const res = await extractChunk(job.chunk, cacheDir, tmpDir);
    done++;
    if (res.error) { st.errors++; log(`  ! ${job.s.id.slice(0, 8)} P${job.chunk.first}-${job.chunk.last}: ${res.error}`); }
    res.cached ? st.cached++ : st.extracted++;
    st.costUsd += res.cached ? 0 : res.costUsd;
    const key = chunkKey(job.chunk);
    for (const raw of res.items) {
      const rec = toRecord(raw, job.chunk, job.turns, job.s, corpus, key, st);
      if (!rec) continue;
      if (!bySession.has(job.s.id)) bySession.set(job.s.id, []);
      bySession.get(job.s.id)!.push(rec);
    }
    if (done % 10 === 0 || done === jobs.length) log(`  ${done}/${jobs.length} chunks · $${st.costUsd.toFixed(3)} · ${Math.round((Date.now() - t0) / 1000)}s`);
  });
  st.ms = Date.now() - t0;
  if (!opts.session) fs.rmSync(lockFile, { force: true });
  for (const [sid, recs] of bySession) {
    recs.sort((a, b) => a.prompts[0] - b.prompts[0]);
    st.works += recs.length;
    for (const r of recs) { st.decisions += r.decisions.length; st.problems += r.problems.length; st.facts += r.facts.length; }
    fs.writeFileSync(path.join(recDir, `${sid}.jsonl`), recs.map((r) => JSON.stringify(r)).join('\n') + '\n');
  }
  return st;
}

export function loadRecords(corpus: Corpus): WorkRecord[] {
  const recDir = path.join(dataDir(corpus), 'records');
  if (!fs.existsSync(recDir)) return [];
  const out: WorkRecord[] = [];
  for (const f of fs.readdirSync(recDir)) {
    if (!f.endsWith('.jsonl')) continue;
    for (const line of fs.readFileSync(path.join(recDir, f), 'utf8').split('\n')) if (line.trim()) out.push(JSON.parse(line));
  }
  return out;
}
