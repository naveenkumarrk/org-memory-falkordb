// Compare two record sets (e.g. records-v1.1 vs records) on shape: volume, linkage, and selectivity.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const base = process.env.ORG_MEMORY_HOME ?? path.join(os.homedir(), '.org-memory');
const load = (dir: string) => fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl')).flatMap((f) => fs.readFileSync(path.join(dir, f), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)));
function shape(recs: any[]) {
  const n = recs.length || 1;
  const sum = (f: (r: any) => number) => recs.reduce((s, r) => s + f(r), 0);
  const sig: Record<string, number> = {};
  for (const r of recs) if (r.significance) sig[r.significance] = (sig[r.significance] ?? 0) + 1;
  return {
    work_items: recs.length, decisions: sum((r) => r.decisions.length), problems: sum((r) => r.problems.length), facts: sum((r) => r.facts.length),
    with_files_pct: Math.round((100 * recs.filter((r) => r.touched.length + r.referenced.length > 0).length) / n),
    files_per_work: +(sum((r) => r.touched.length + r.referenced.length) / n).toFixed(2),
    decisions_per_work: +(sum((r) => r.decisions.length) / n).toFixed(2), problems_per_work: +(sum((r) => r.problems.length) / n).toFixed(2), facts_per_work: +(sum((r) => r.facts.length) / n).toFixed(2),
    investigations_pct: Math.round((100 * recs.filter((r) => r.status === 'investigation').length) / n),
    significance: Object.keys(sig).length ? sig : 'n/a',
    injectable_sig_ge2: recs.filter((r) => (r.significance ?? 3) >= 2).length,
  };
}
const a = shape(load(path.join(base, process.argv[2] ?? 'records-v1.1')));
const b = shape(load(path.join(base, process.argv[3] ?? 'records')));
console.log(JSON.stringify({ before: a, after: b }, null, 2));
