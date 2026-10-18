// T8 — Memory ON vs OFF where memory should matter: later questions/investigations whose answer already existed in
// memory before the cutoff. (1) Screen later work items: a judge, seeing what the later work found and what memory
// held before the cutoff, decides whether memory already had the answer (independent of any agent run). (2) Ask the
// original question in a clone at the commit of that moment, read-only tools, memory OFF vs ON (pre-cutoff graph).
// (3) An Opus judge, blind to the arm, scores each answer against what the later session found.
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { loadRecords } from '../src/backfill.ts';
import type { WorkRecord } from '../src/backfill.ts';
import { findClones, RepoIndex } from '../src/git.ts';
import { CORPUS } from '../src/config.ts';
import { pool } from '../src/extract.ts';
import { knowledgeForFiles, knowledgeForPrompt } from '../src/query.ts';
import { loadSettings } from '../src/settings.ts';
import { evalDir, judge, rng } from './common.ts';
import { writeHooksFile } from '../src/install.ts';

const HOOKS_FILE = writeHooksFile();
const OUT = path.join(evalDir('prod'), 'qa');
const WORK = path.join(OUT, 'work');
const CUT = process.env.QA_CUTOFF ?? '2026-10-05T07:23:57.836Z';
const PRE_GRAPH = path.join(evalDir('prod'), 'graph-before.db');
const MAX_TASKS = Number(process.env.QA_TASKS ?? 15);
const SEEDS = Number(process.env.QA_SEEDS ?? 2);
fs.mkdirSync(WORK, { recursive: true });

const pre = new DatabaseSync(PRE_GRAPH, { readOnly: true });
const settings = { ...loadSettings(), minScore: 0, minSignificance: 1 };
const clones = findClones(CORPUS.prod.repoRoot);
const idx = new Map<string, RepoIndex>();
const repo = (s: string) => { if (!idx.has(s)) idx.set(s, new RepoIndex(s, clones.get(s) ?? [])); return idx.get(s)!; };
const git = (cwd: string, args: string[]) => execFileSync('git', ['-C', cwd, '--no-optional-locks', ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

// 1) candidates: later work with files in a known repo, and pre-cutoff knowledge about those files or its question
type Cand = { r: WorkRecord; slug: string; items: Array<{ id: string; type: string; text: string }> };
const cands: Cand[] = [];
for (const r of loadRecords('prod')) {
  if (r.started < CUT || !['investigation', 'done', 'partial'].includes(r.status) || ((r as any).significance ?? 3) < 3) continue;
  const files = [...r.touched, ...r.referenced];
  const slug = files[0]?.slug;
  if (!slug || !clones.has(slug)) continue;
  const items = new Map<string, { id: string; type: string; text: string }>();
  for (const i of knowledgeForFiles(pre, files.map((f) => `file:${f.slug}:${f.rel}`), { settings, limit: 12 })) items.set(i.id, i);
  for (const i of knowledgeForPrompt(pre, r.goal, { settings, limit: 6 }).items) items.set(i.id, i);
  if (items.size >= 2) cands.push({ r, slug, items: [...items.values()].slice(0, 14) });
}
const shuffle = rng(5);
cands.sort((a, b) => b.items.length - a.items.length || shuffle() - 0.5);
console.error(`candidates with pre-cutoff knowledge: ${cands.length}; screening top ${Math.min(45, cands.length)}`);

const SCREEN = { type: 'object', additionalProperties: false, required: ['available', 'item_ids', 'why'], properties: {
  available: { type: 'string', enum: ['yes', 'partial', 'no'] }, item_ids: { type: 'array', items: { type: 'string' } }, why: { type: 'string' } } };
const screened = await pool(cands.slice(0, 45), 4, async (c) => {
  const res = await judge('prod', `You check whether a team's memory, as it stood BEFORE a piece of work started, already contained the answer the work later found.
"yes" = at least one memory item states the key finding or decision (or the fact needed to reach it); "partial" = helpful but incomplete; "no" = not there.
Ignore items that only share a topic. Be strict.`,
    `LATER WORK\nQuestion/goal: ${c.r.goal}\nWhat it found/did: ${c.r.what_was_done}\nFacts: ${c.r.facts.map((f) => f.statement).join(' | ')}\nDecisions: ${c.r.decisions.map((d) => d.choice).join(' | ')}\n\nMEMORY BEFORE THE WORK:\n${c.items.map((i) => `[${i.id}] (${i.type}) ${i.text}`).join('\n')}`, SCREEN, 'sonnet');
  return { c, v: res.data };
});
const chosen = [...screened.filter((x) => x.v?.available === 'yes'), ...screened.filter((x) => x.v?.available === 'partial')].slice(0, MAX_TASKS);
console.error(`screened: yes=${screened.filter((x) => x.v?.available === 'yes').length} partial=${screened.filter((x) => x.v?.available === 'partial').length} no=${screened.filter((x) => x.v?.available === 'no').length}; using ${chosen.length}`);
fs.writeFileSync(path.join(OUT, 'tasks.json'), JSON.stringify(chosen.map((x) => ({ id: x.c.r.id, goal: x.c.r.goal, available: x.v.available, items: x.v.item_ids, why: x.v.why })), null, 2));

// 2) A/B runs
function runClaude(cwd: string, prompt: string, on: boolean, hookLog: string): Promise<any> {
  return new Promise((resolve) => {
    const args = ['-p', '--model', 'sonnet', '--output-format', 'json', '--tools', 'Read,Grep,Glob', '--strict-mcp-config', '--no-session-persistence', '--setting-sources', 'project', '--max-budget-usd', '2'];
    if (on) args.push('--settings', HOOKS_FILE);
    const env = { ...process.env, ...(on ? { ORG_MEMORY_FORCE: 'on', ORG_MEMORY_GRAPH: PRE_GRAPH, ORG_MEMORY_HOOK_LOG: hookLog, ORG_MEMORY_DELIVERY: 'knowledge' } : {}) };
    delete (env as any).ORG_MEMORY_INTERNAL;
    const child = spawn('claude', [...args, prompt], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), 15 * 60_000);
    child.stdout.on('data', (d) => (out += d));
    child.on('close', () => { clearTimeout(timer); try { resolve(JSON.parse(out)); } catch { resolve({ is_error: true, result: out.slice(0, 300) }); } });
  });
}
const GRADE = { type: 'object', additionalProperties: false, required: ['score', 'notes'], properties: { score: { type: 'integer', minimum: 0, maximum: 3 }, notes: { type: 'string' } } };
const hookLog = path.join(OUT, 'hook-qa.jsonl');
const jobs = chosen.flatMap((x) => Array.from({ length: SEEDS }, (_, s) => ['off', 'on'].map((arm) => ({ c: x.c, arm, seed: s })))).flat();
const results = await pool(jobs, Number(process.env.QA_PARALLEL ?? 4), async ({ c, arm, seed }) => {
  const dir = path.join(WORK, `${c.r.id}-${arm}-${seed}`);
  fs.rmSync(dir, { recursive: true, force: true });
  const idxr = repo(c.slug);
  const root = idxr.roots[0];
  const at = git(root, ['rev-list', '-1', `--before=${c.r.started}`, idxr.ref(root)!]).trim();
  git(path.dirname(dir), ['clone', '-q', '--shared', '--no-checkout', root, dir]);
  git(dir, ['checkout', '-q', at]);
  git(dir, ['remote', 'set-url', 'origin', `https://github.com/${c.slug}`]);
  git(dir, ['remote', 'set-url', '--push', 'origin', 'file:///dev/null/no-push']);
  const t0 = Date.now();
  const res = await runClaude(dir, `A teammate asks: ${c.r.goal}\n\nAnswer concisely in at most 6 bullets, citing files where relevant. Read the code as needed. Do not modify files and do not ask questions.`, arm === 'on', hookLog);
  const ms = Date.now() - t0;
  const answer = String(res.result ?? '');
  const g = await judge('prod', `Grade an answer against what the team actually found when they investigated the same question.
3 = correct and covers the key finding; 2 = mostly correct, minor gaps; 1 = partly correct or missing the key point; 0 = wrong, unsupported, or no answer.
Judge substance, not wording.`, `QUESTION: ${c.r.goal}\n\nWHAT THE TEAM FOUND:\n${c.r.what_was_done}\nFacts: ${c.r.facts.map((f) => f.statement).join(' | ')}\nDecisions: ${c.r.decisions.map((d) => `${d.choice} (${d.why})`).join(' | ')}\n\nANSWER TO GRADE:\n${answer.slice(0, 6000) || '(none)'}`, GRADE);
  const r = { task: c.r.id, arm, seed, session: res.session_id, score: g.data?.score ?? null, notes: g.data?.notes, turns: res.num_turns, cost: res.total_cost_usd, ms, error: res.is_error ? String(res.result).slice(0, 200) : null };
  fs.appendFileSync(path.join(OUT, 'runs.jsonl'), JSON.stringify({ ...r, answer: answer.slice(0, 3000) }) + '\n');
  console.error(`  ${c.r.id} ${arm}#${seed}: score ${r.score} turns ${r.turns} $${(r.cost ?? 0).toFixed(2)} ${Math.round(ms / 1000)}s`);
  fs.rmSync(dir, { recursive: true, force: true });
  return r;
});

// 3) summary with paired bootstrap over tasks
const ok = results.filter((r) => r.score !== null);
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const cards = new Map<string, number>();
if (fs.existsSync(hookLog)) for (const l of fs.readFileSync(hookLog, 'utf8').trim().split('\n')) { const e = JSON.parse(l); cards.set(e.session, (cards.get(e.session) ?? 0) + e.cards.length); }
const arm = (a: string) => { const xs = ok.filter((r) => r.arm === a); return { runs: xs.length, mean_score: +mean(xs.map((r) => r.score)).toFixed(2), correct_ge2_pct: Math.round((100 * xs.filter((r) => r.score >= 2).length) / xs.length),
  mean_turns: +mean(xs.map((r) => r.turns ?? 0)).toFixed(1), mean_cost: +mean(xs.map((r) => r.cost ?? 0)).toFixed(3), mean_secs: Math.round(mean(xs.map((r) => r.ms)) / 1000), mean_items: a === 'on' ? +mean(xs.map((r) => cards.get(r.session) ?? 0)).toFixed(1) : 0 }; };
const tasks = [...new Set(ok.map((r) => r.task))];
const deltas = tasks.map((t) => mean(ok.filter((r) => r.task === t && r.arm === 'on').map((r) => r.score)) - mean(ok.filter((r) => r.task === t && r.arm === 'off').map((r) => r.score)));
const rr = rng(17);
const boots = Array.from({ length: 5000 }, () => mean(Array.from({ length: deltas.length }, () => deltas[Math.floor(rr() * deltas.length)]))).sort((a, b) => a - b);
const summary = { cutoff: CUT, tasks: tasks.length, seeds: SEEDS, off: arm('off'), on: arm('on'), mean_delta_on_minus_off: +mean(deltas).toFixed(2), ci95: [+boots[124].toFixed(2), +boots[4874].toFixed(2)],
  tasks_better: deltas.filter((d) => d > 0).length, tasks_worse: deltas.filter((d) => d < 0).length, tasks_same: deltas.filter((d) => d === 0).length };
fs.writeFileSync(path.join(OUT, 't8-summary.json'), JSON.stringify({ summary, perTask: tasks.map((t, i) => ({ task: t, delta: +deltas[i].toFixed(2) })) }, null, 2));
console.log(JSON.stringify(summary, null, 2));
