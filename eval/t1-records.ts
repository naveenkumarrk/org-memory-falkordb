// T1 — Are the extracted work records right? A judge model (not the extractor) checks each sampled record against its source excerpt.
import fs from 'node:fs';
import path from 'node:path';
import { loadRecords } from '../src/backfill.ts';
import { pool } from '../src/extract.ts';
import { chunkIndex, evalDir, judge, sample } from './common.ts';

const corpus = process.argv.includes('--test') ? 'test' : 'prod';
const N = Number(process.argv[process.argv.indexOf('--n') + 1] || 20);
const ok = { type: 'boolean' };
const obj = (p: Record<string, unknown>) => ({ type: 'object', additionalProperties: false, required: Object.keys(p), properties: p });
const SCHEMA = obj({
  work_faithful: ok, files_ok: { type: 'string', enum: ['all', 'mostly', 'wrong', 'none_listed'] },
  decisions: { type: 'array', items: obj({ supported: ok, is_real_decision: ok }) },
  problems: { type: 'array', items: obj({ supported: ok }) },
  facts: { type: 'array', items: obj({ supported: ok, durable: ok }) },
  teammate_usefulness: { type: 'integer', minimum: 1, maximum: 5 }, notes: { type: 'string' },
});
const SYSTEM = `You audit an automatically extracted WORK RECORD against the coding-session EXCERPT it came from.
Be strict. work_faithful: title/goal/what_was_done describe what actually happened in the excerpt, with no invented outcomes.
files_ok: the record's files are the ones the work changed or relied on. For each decision: supported by the excerpt, and a real choice (not routine).
For each problem: supported. For each fact: supported, and durable (still true next week; not a one-off observation).
teammate_usefulness: 1 = useless noise, 3 = somewhat useful, 5 = a teammate touching this code would clearly want this.
Return entries for decisions/problems/facts in the same order as the record.`;

const recs = loadRecords(corpus);
const idx = chunkIndex(corpus);
const picked = sample(recs.filter((r) => idx.has(r.extractor.chunk)), N);
const results = await pool(picked, 4, async (r) => {
  const c = idx.get(r.extractor.chunk)!;
  const rec = { title: r.title, goal: r.goal, what_was_done: r.what_was_done, status: r.status, prompts: r.prompts,
    files: [...r.touched, ...r.referenced].map((f) => `${f.slug}:${f.rel}`), decisions: r.decisions.map((d) => ({ choice: d.choice, why: d.why })),
    problems: r.problems.map((p) => ({ symptom: p.symptom, cause: p.cause, resolution: p.resolution })), facts: r.facts.map((f) => f.statement) };
  const res = await judge(corpus, SYSTEM, `EXCERPT:\n${c.text}\n\nRECORD (covers prompts P${r.prompts[0]}-P${r.prompts[1]}):\n${JSON.stringify(rec, null, 1)}`, SCHEMA);
  return { id: r.id, title: r.title, significance: (r as any).significance ?? null, verdict: res.data, error: res.error, cost: res.costUsd ?? 0 };
});
const v = results.filter((x) => x.verdict).map((x) => x.verdict);
const pct = (a: number, b: number) => (b ? `${Math.round((100 * a) / b)}% (${a}/${b})` : 'n/a');
const all = <K extends 'decisions' | 'problems' | 'facts'>(k: K) => v.flatMap((x: any) => x[k] ?? []);
const summary = {
  records_judged: v.length, errors: results.length - v.length,
  work_faithful: pct(v.filter((x: any) => x.work_faithful).length, v.length),
  files_all_or_mostly: pct(v.filter((x: any) => ['all', 'mostly'].includes(x.files_ok)).length, v.filter((x: any) => x.files_ok !== 'none_listed').length),
  decisions_supported: pct(all('decisions').filter((d: any) => d.supported).length, all('decisions').length),
  decisions_real: pct(all('decisions').filter((d: any) => d.is_real_decision).length, all('decisions').length),
  problems_supported: pct(all('problems').filter((d: any) => d.supported).length, all('problems').length),
  facts_supported: pct(all('facts').filter((d: any) => d.supported).length, all('facts').length),
  facts_durable: pct(all('facts').filter((d: any) => d.durable).length, all('facts').length),
  usefulness_avg: v.length ? (v.reduce((s: number, x: any) => s + x.teammate_usefulness, 0) / v.length).toFixed(2) : 'n/a',
  usefulness_ge4: pct(v.filter((x: any) => x.teammate_usefulness >= 4).length, v.length),
  judge_cost_usd: Number(results.reduce((s, x) => s + x.cost, 0).toFixed(3)),
  // does the extractor's significance rating predict what the judge finds useful?
  usefulness_by_significance: Object.fromEntries([[1, 2], [3, 3], [4, 5]].map(([lo, hi]) => {
    const xs = results.filter((x) => x.verdict && x.significance !== null && x.significance >= lo && x.significance <= hi);
    return [`sig ${lo}-${hi}`, xs.length ? `${(xs.reduce((s, x: any) => s + x.verdict.teammate_usefulness, 0) / xs.length).toFixed(2)} avg (n=${xs.length})` : 'n/a'];
  })),
};
fs.writeFileSync(path.join(evalDir(corpus), 't1-records.json'), JSON.stringify({ summary, results }, null, 2));
console.log(JSON.stringify(summary, null, 2));
