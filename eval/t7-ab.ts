// T7 — Memory ON vs OFF on real tasks. Each task is real work done after the cutoff, replayed from the commit just
// before it, in a disposable --shared clone (pushes disabled; agent has file tools only, no shell). ON = cards from a
// graph built only from work that ended before the cutoff (no leakage). An Opus judge, blind to the arm, compares the
// agent's diff with the real commit diff. Outputs go to <dataDir>/eval/ab/ (company content stays out of this repo).
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { loadRecords } from '../src/backfill.ts';
import { findClones, RepoIndex } from '../src/git.ts';
import { CORPUS } from '../src/config.ts';
import { pool } from '../src/extract.ts';
import { evalDir, judge } from './common.ts';
import { writeHooksFile } from '../src/install.ts';

const HOOKS_FILE = writeHooksFile();
const OUT = path.join(evalDir('prod'), 'ab');
const SCRATCH = process.env.AB_SCRATCH ?? path.join(OUT, 'work');
const PRE_GRAPH = path.join(evalDir('prod'), 'graph-before.db');
const MODEL = process.env.AB_MODEL ?? 'sonnet';
const SEEDS = Number(process.env.AB_SEEDS ?? 1);
const SEED_START = Number(process.env.AB_SEED_START ?? 0);
fs.mkdirSync(SCRATCH, { recursive: true });

// Ticket-style statements (work item id -> task text, describing the problem, not the solution) live with the
// company data, not in this repo: <dataDir>/eval/ab/tasks.json
const TASKS: Record<string, string> = JSON.parse(fs.readFileSync(path.join(OUT, 'tasks.json'), 'utf8'));
const RULES = 'Make the code change directly in this repository. You cannot run commands; read and edit files only. Do not ask questions; when done, reply with a two-line summary of what you changed.';

const recs = new Map(loadRecords('prod').map((r) => [r.id, r]));
const clones = findClones(CORPUS.prod.repoRoot);
const idx = new Map<string, RepoIndex>();
const repo = (s: string) => { if (!idx.has(s)) idx.set(s, new RepoIndex(s, clones.get(s) ?? [])); return idx.get(s)!; };
const git = (cwd: string, args: string[]) => execFileSync('git', ['-C', cwd, '--no-optional-locks', ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

type Task = { id: string; slug: string; root: string; base: string; head: string; realDiff: string; statement: string };
const tasks: Task[] = [];
const ONLY = process.env.AB_ONLY ? new Set(process.env.AB_ONLY.split(',')) : null;
for (const [id, statement] of Object.entries(TASKS)) {
  if (ONLY && !ONLY.has(id)) continue;
  const r = recs.get(id);
  if (!r) { console.error(`skip ${id}: not in records`); continue; }
  const infos = r.commits.map((c) => ({ c, info: repo(c.slug).commit(c.sha) })).filter((x) => x.info);
  if (!infos.length) { console.error(`skip ${id}: no commit`); continue; }
  infos.sort((a, b) => a.info!.ts - b.info!.ts);
  const slug = infos[0].c.slug;
  const root = repo(slug).roots.find((rt) => { try { git(rt, ['cat-file', '-e', `${infos[0].info!.full}^{commit}`]); return true; } catch { return false; } })!;
  const base = `${infos[0].info!.full}^`;
  const head = infos[infos.length - 1].info!.full;
  const realDiff = git(root, ['diff', base, head]);
  tasks.push({ id, slug, root, base: git(root, ['rev-parse', base]).trim(), head, realDiff, statement });
}
console.error(`tasks: ${tasks.length} × arms 2 × seeds ${SEEDS}`);
if (process.env.AB_DRY) {
  for (const t of tasks) console.log(t.id, t.slug, t.base.slice(0, 10), '->', t.head.slice(0, 10), `ref diff: ${t.realDiff.split('\n').filter((l) => /^[+-][^+-]/.test(l)).length} lines, files: ${(t.realDiff.match(/^diff --git/gm) ?? []).length}`, '| root', t.root.replace(process.env.HOME!, '~'));
  process.exit(0);
}

function runClaude(cwd: string, prompt: string, on: boolean, hookLog: string): Promise<any> {
  return new Promise((resolve) => {
    const args = ['-p', '--model', MODEL, '--output-format', 'json', '--tools', 'Read,Edit,Write,Grep,Glob', '--permission-mode', 'acceptEdits',
      '--strict-mcp-config', '--no-session-persistence', '--setting-sources', 'project', '--max-budget-usd', '3'];
    if (on) args.push('--settings', HOOKS_FILE);
    const env = { ...process.env, ...(on ? { ORG_MEMORY_FORCE: 'on', ORG_MEMORY_GRAPH: PRE_GRAPH, ORG_MEMORY_HOOK_LOG: hookLog } : {}) };
    delete (env as any).ORG_MEMORY_INTERNAL;
    const child = spawn('claude', [...args, prompt], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), 20 * 60_000);
    child.stdout.on('data', (d) => (out += d));
    child.on('close', () => { clearTimeout(timer); try { resolve(JSON.parse(out)); } catch { resolve({ is_error: true, result: out.slice(0, 500) }); } });
  });
}

const JUDGE_SCHEMA = { type: 'object', additionalProperties: false, required: ['score', 'same_files', 'notes'], properties: {
  score: { type: 'integer', minimum: 0, maximum: 3 }, same_files: { type: 'string', enum: ['all', 'some', 'none'] }, notes: { type: 'string' } } };
const JUDGE_SYSTEM = `You grade a coding agent's change against the change a senior engineer actually committed for the same task.
Score: 3 = equivalent fix (same behaviour; exact values match where values matter); 2 = mostly right (core fix correct, minor gaps or extra edits);
1 = partial or wrong values (right area, but key part missing or a config value differs); 0 = no change, wrong change, or harmful.
Only grade the part of the reference that the task asks for; the reference commit may include unrelated edits. Be strict about concrete values (URLs, IDs, keys).`;

const hookLog = path.join(OUT, 'hook-ab.jsonl');
const jobs = tasks.flatMap((t) => Array.from({ length: SEEDS }, (_, s) => (process.env.AB_ARMS ?? 'off,on').split(',').map((arm) => ({ t, arm, seed: SEED_START + s })))).flat();
const results = await pool(jobs, Number(process.env.AB_PARALLEL ?? 4), async ({ t, arm, seed }) => {
  const dir = path.join(SCRATCH, `${t.id}-${arm}-${seed}`);
  fs.rmSync(dir, { recursive: true, force: true });
  git(path.dirname(dir), ['clone', '-q', '--shared', '--no-checkout', t.root, dir]);
  git(dir, ['checkout', '-q', t.base]);
  git(dir, ['remote', 'set-url', 'origin', `https://github.com/${t.slug}`]);          // lets the hook resolve repo identity
  git(dir, ['remote', 'set-url', '--push', 'origin', 'file:///dev/null/no-push']);      // pushes go nowhere
  const t0 = Date.now();
  const res = await runClaude(dir, `${t.statement}\n\n${RULES}`, arm === 'on', hookLog);
  const agentMs = Date.now() - t0;
  const agentDiff = git(dir, ['diff']);
  fs.mkdirSync(path.join(OUT, 'diffs'), { recursive: true });
  fs.writeFileSync(path.join(OUT, 'diffs', `${t.id}-${arm}-${seed}.diff`), agentDiff);
  const judgePrompt = `TASK:\n${t.statement}\n\nREFERENCE CHANGE (what was actually committed):\n${t.realDiff.slice(0, 14000)}\n\nAGENT CHANGE:\n${agentDiff.slice(0, 14000) || '(no changes)'}`;
  let verdict = await judge('prod', JUDGE_SYSTEM, judgePrompt, JUDGE_SCHEMA);
  for (let i = 0; i < 2 && !verdict.data; i++) verdict = await judge('prod', JUDGE_SYSTEM, `${judgePrompt}\n`, JUDGE_SCHEMA); // retry (cache key differs)
  const r = { task: t.id, arm, seed, session: res.session_id, score: verdict.data?.score ?? null, same_files: verdict.data?.same_files, notes: verdict.data?.notes, judgeError: verdict.error ?? null,
    turns: res.num_turns, cost: res.total_cost_usd, ms: agentMs, apiMs: res.duration_api_ms, diffLines: agentDiff.split('\n').filter((l) => /^[+-][^+-]/.test(l)).length, error: res.is_error ? String(res.result).slice(0, 200) : null };
  fs.appendFileSync(path.join(OUT, 'runs.jsonl'), JSON.stringify(r) + '\n');
  console.error(`  ${t.id} ${arm}: score ${r.score} turns ${r.turns} $${(r.cost ?? 0).toFixed(2)} ${Math.round(r.ms / 1000)}s`);
  fs.rmSync(dir, { recursive: true, force: true });
  return r;
});

// cards injected per ON session, from the A/B hook log
const injected = new Map<string, number>();
if (fs.existsSync(hookLog)) for (const l of fs.readFileSync(hookLog, 'utf8').trim().split('\n')) { const e = JSON.parse(l); injected.set(e.session, (injected.get(e.session) ?? 0) + e.cards.length); }
const by = (arm: string) => results.filter((r) => r.arm === arm && r.score !== null);
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const summ = (arm: string) => { const xs = by(arm); return { runs: xs.length, mean_score: +mean(xs.map((r) => r.score)).toFixed(2), solved_ge2: xs.filter((r) => r.score >= 2).length, exact_3: xs.filter((r) => r.score === 3).length,
  mean_turns: +mean(xs.map((r) => r.turns ?? 0)).toFixed(1), mean_cost: +mean(xs.map((r) => r.cost ?? 0)).toFixed(3), mean_secs: Math.round(mean(xs.map((r) => r.ms)) / 1000) }; };
const perTask = tasks.map((t) => {
  const off = results.filter((r) => r.task === t.id && r.arm === 'off');
  const on = results.filter((r) => r.task === t.id && r.arm === 'on');
  return { task: t.id, title: recs.get(t.id)!.title.slice(0, 60), off: off.map((r) => r.score), on: on.map((r) => r.score),
    cards_on: on.reduce((n, r) => n + (injected.get(r.session) ?? 0), 0), delta: +(mean(on.map((r) => r.score)) - mean(off.map((r) => r.score))).toFixed(2) };
});
const summary = { model: MODEL, seeds: SEEDS, off: summ('off'), on: summ('on'), tasks_better_with_memory: perTask.filter((x) => x.delta > 0).length, tasks_worse: perTask.filter((x) => x.delta < 0).length, tasks_same: perTask.filter((x) => x.delta === 0).length, perTask };
fs.writeFileSync(path.join(OUT, 't7-ab.json'), JSON.stringify({ summary, results }, null, 2));
console.log(JSON.stringify(summary, null, 2));
