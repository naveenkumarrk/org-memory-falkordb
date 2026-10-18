// Aggregates all T7 A/B runs (every seed) from <dataDir>/eval/ab/runs.jsonl: per-arm results, per-task deltas,
// and a paired bootstrap 95% CI over tasks for the ON − OFF score difference.
import fs from 'node:fs';
import path from 'node:path';
import { evalDir, rng } from './common.ts';

const dir = path.join(evalDir('prod'), 'ab');
const runs = fs.readFileSync(path.join(dir, 'runs.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)).filter((r) => r.score !== null);
const cards = new Map<string, number>();
for (const l of fs.readFileSync(path.join(dir, 'hook-ab.jsonl'), 'utf8').trim().split('\n')) { const e = JSON.parse(l); cards.set(e.session, (cards.get(e.session) ?? 0) + e.cards.length); }
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const arm = (a: string) => {
  const xs = runs.filter((r) => r.arm === a);
  return { runs: xs.length, mean_score: +mean(xs.map((r) => r.score)).toFixed(2), solved_ge2_pct: Math.round((100 * xs.filter((r) => r.score >= 2).length) / xs.length),
    exact_pct: Math.round((100 * xs.filter((r) => r.score === 3).length) / xs.length), mean_turns: +mean(xs.map((r) => r.turns ?? 0)).toFixed(1),
    mean_cost: +mean(xs.map((r) => r.cost ?? 0)).toFixed(3), mean_secs: Math.round(mean(xs.map((r) => r.ms ?? 0)) / 1000),
    mean_cards: a === 'on' ? +mean(xs.map((r) => cards.get(r.session) ?? 0)).toFixed(1) : 0 };
};
const tasks = [...new Set(runs.map((r) => r.task))];
const perTask = tasks.map((t) => {
  const off = runs.filter((r) => r.task === t && r.arm === 'off').map((r) => r.score);
  const on = runs.filter((r) => r.task === t && r.arm === 'on').map((r) => r.score);
  return { task: t, off, on, delta: +(mean(on) - mean(off)).toFixed(2) };
});
const deltas = perTask.map((x) => x.delta);
const r = rng(13);
const boots: number[] = [];
for (let i = 0; i < 5000; i++) boots.push(mean(Array.from({ length: deltas.length }, () => deltas[Math.floor(r() * deltas.length)])));
boots.sort((a, b) => a - b);
const summary = {
  off: arm('off'), on: arm('on'),
  mean_delta_on_minus_off: +mean(deltas).toFixed(2), ci95: [+boots[124].toFixed(2), +boots[4874].toFixed(2)],
  tasks_better: perTask.filter((x) => x.delta > 0).length, tasks_worse: perTask.filter((x) => x.delta < 0).length, tasks_same: perTask.filter((x) => x.delta === 0).length,
  perTask,
};
fs.writeFileSync(path.join(dir, 't7-summary.json'), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
