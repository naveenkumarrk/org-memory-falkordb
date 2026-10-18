// T2 — Retrieval replay. Build the graph only from work that ended before a cutoff, then walk later sessions:
// at every first Read/Edit of a file (and every prompt) ask what the hook would have shown, and have a judge rate each card
// against what that later session actually did.
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { CORPUS, PROJECTS_DIR, inScope } from '../src/config.ts';
import { loadRecords } from '../src/backfill.ts';
import type { WorkRecord } from '../src/backfill.ts';
import { build } from '../src/graph.ts';
import { listSessionFiles, parseSession } from '../src/transcript.ts';
import { resolveFile } from '../src/repo.ts';
import { relatedToFiles, relatedToPrompt, renderCards } from '../src/query.ts';
import type { Card } from '../src/query.ts';
import { pool } from '../src/extract.ts';
import { evalDir, judge, sample } from './common.ts';

const corpus = process.argv.includes('--test') ? 'test' : 'prod';
const arg = (k: string) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
const recs = loadRecords(corpus);
const ends = recs.map((r) => r.ended).filter(Boolean).sort();
const cutoff = arg('--cutoff') ?? ends[Math.floor(ends.length * 0.6)];
const out = evalDir(corpus);
const preDb = path.join(out, 'graph-before.db');
const b = build(corpus, () => {}, { before: cutoff, out: preDb });
const db = new DatabaseSync(preDb, { readOnly: true });

const postSessions = new Set(recs.filter((r) => r.started >= cutoff).map((r) => r.session));
const recsBySession = new Map<string, WorkRecord[]>();
for (const r of recs) if (postSessions.has(r.session)) recsBySession.set(r.session, [...(recsBySession.get(r.session) ?? []), r]);
const workAt = (sid: string, ts: string) => {
  const rs = recsBySession.get(sid) ?? [];
  return rs.find((r) => r.started <= ts && ts <= r.ended) ?? rs.filter((r) => r.started <= ts).pop() ?? rs[0];
};

type Trial = { kind: 'file' | 'prompt'; session: string; target: string; ts: string; cards: Card[]; ms: number; later?: WorkRecord };
const trials: Trial[] = [];
for (const f of listSessionFiles(CORPUS[corpus].projectPrefix, PROJECTS_DIR)) {
  const sid = path.basename(f, '.jsonl');
  if (!postSessions.has(sid)) continue;
  const s = parseSession(f, new Set());
  const touched = new Set<string>();
  for (const e of s.events) {
    if (e.ts < cutoff) continue;
    if (e.kind === 'prompt') {
      const t0 = performance.now();
      const r = relatedToPrompt(db, e.text, { limit: 2 });
      trials.push({ kind: 'prompt', session: sid, target: e.text.slice(0, 160), ts: e.ts, cards: r.cards, ms: performance.now() - t0, later: workAt(sid, e.ts) });
    } else if (e.kind === 'tool' && ['Read', 'Edit', 'Write', 'MultiEdit'].includes(e.name)) {
      const fr = resolveFile(e.input?.file_path ?? '');
      if (!fr || !inScope(corpus, fr.slug)) continue;
      const fid = `file:${fr.slug}:${fr.rel}`;
      if (touched.has(fid)) continue;
      touched.add(fid);
      const t0 = performance.now();
      const cards = relatedToFiles(db, [fid], { limit: 2 });
      trials.push({ kind: 'file', session: sid, target: fid, ts: e.ts, cards, ms: performance.now() - t0, later: workAt(sid, e.ts) });
    }
  }
}

const SCHEMA = { type: 'object', additionalProperties: false, required: ['label', 'misleading', 'reason'], properties: {
  label: { type: 'string', enum: ['useful', 'related_not_needed', 'noise'] }, misleading: { type: 'boolean' }, reason: { type: 'string' } } };
const SYSTEM = `A coding agent was about to work on something. A memory system showed it a CARD describing earlier team work.
Given what the LATER WORK actually was, rate the card:
- useful: it would have helped (relevant prior change, decision, gotcha, or where/how something works),
- related_not_needed: same area but it would not have changed or sped up the work,
- noise: unrelated or distracting.
misleading: true if the card could push the agent toward a wrong or outdated assumption for this work.`;
const pathOf = (via: string) => via === 'changed this file' ? 'changed this file' : via === 'used this file' ? 'used this file' : via.startsWith('recorded knowledge') ? 'knowledge about file' : via.includes('usually changes with') ? 'co-changed file' : via.includes('same folder') ? 'same folder' : via;
const pairs = trials.flatMap((t) => t.cards.map((c) => ({ t, c })));
const judged = await pool(sample(pairs.filter((p) => p.t.later), Number(arg('--n') ?? 60), 11), 4, async ({ t, c }) => {
  const later = t.later!;
  const prompt = `TRIGGER: ${t.kind === 'file' ? `the agent opened ${t.target.replace(/^file:/, '')}` : `the user wrote: "${t.target}"`}\n\nLATER WORK (what the session actually did):\n${later.title}\n${later.goal}\n${later.what_was_done}\n\nCARD SHOWN:\n${renderCards([c], 'Card')}`;
  const r = await judge(corpus, SYSTEM, prompt, SCHEMA);
  const path = t.kind === 'prompt' ? (c.via.startsWith('mentions') ? 'prompt: identifier match' : `prompt→file: ${pathOf(c.via)}`) : `file: ${pathOf(c.via)}`;
  return { kind: t.kind, path, via: c.via, work: c.work, target: t.target, label: r.data?.label, misleading: r.data?.misleading, reason: r.data?.reason, cost: r.costUsd ?? 0 };
});

const pct = (a: number, b: number) => (b ? `${Math.round((100 * a) / b)}% (${a}/${b})` : 'n/a');
const by = (k: 'file' | 'prompt') => trials.filter((t) => t.kind === k);
const lab = (xs: typeof judged) => ({ useful: pct(xs.filter((x) => x.label === 'useful').length, xs.length), related: pct(xs.filter((x) => x.label === 'related_not_needed').length, xs.length), noise: pct(xs.filter((x) => x.label === 'noise').length, xs.length), misleading: pct(xs.filter((x) => x.misleading).length, xs.length) });
const ms = trials.map((t) => t.ms).sort((a, b) => a - b);
const vias = [...new Set(judged.map((j) => j.path))];
const summary = {
  cutoff, graph_before: { records: b.records, commitsLinked: b.commitsLinked }, later_sessions: postSessions.size,
  file_first_touches: by('file').length, file_touches_with_cards: pct(by('file').filter((t) => t.cards.length).length, by('file').length),
  prompts: by('prompt').length, prompts_with_cards: pct(by('prompt').filter((t) => t.cards.length).length, by('prompt').length),
  cards_judged: judged.length, overall: lab(judged), file_trigger: lab(judged.filter((j) => j.kind === 'file')), prompt_trigger: lab(judged.filter((j) => j.kind === 'prompt')),
  by_graph_path: Object.fromEntries(vias.map((v) => [v, lab(judged.filter((j) => j.path === v))])),
  lookup_ms: { p50: ms[Math.floor(ms.length / 2)]?.toFixed(2), p95: ms[Math.floor(ms.length * 0.95)]?.toFixed(2) },
  judge_cost_usd: Number(judged.reduce((s, x) => s + x.cost, 0).toFixed(3)),
};
fs.writeFileSync(path.join(out, 't2-replay.json'), JSON.stringify({ summary, judged, trials: trials.map((t) => ({ ...t, later: t.later?.id, cards: t.cards.map((c) => ({ work: c.work, via: c.via, score: c.score })) })) }, null, 2));
console.log(JSON.stringify(summary, null, 2));
