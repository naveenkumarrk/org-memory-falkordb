// Writes <dataDir>/eval/spotcheck.md: 10 records with their evidence, for a human to check in ~10 minutes.
import fs from 'node:fs';
import path from 'node:path';
import { loadRecords } from '../src/backfill.ts';
import { evalDir, sample } from './common.ts';
const corpus = process.argv.includes('--test') ? 'test' : 'prod';
const t1File = path.join(evalDir(corpus), 't1-records.json');
const t1 = fs.existsSync(t1File) ? JSON.parse(fs.readFileSync(t1File, 'utf8')) : { results: [] };
const verdict = new Map(t1.results.map((r: any) => [r.id, r.verdict]));
const recs = loadRecords(corpus);
const pick = [...recs.filter((r) => verdict.has(r.id)), ...sample(recs, 30, 3)].filter((r, i, a) => a.findIndex((x) => x.id === r.id) === i).slice(0, 10);
const md = ['# org-memory spot check (10 records)', '', 'For each: is it right, and would a teammate touching this code want it? Mark ✅ / ⚠️ / ❌ next to the title.', ''];
for (const r of pick) {
  md.push(`## ${r.title}  \`${r.id}\``, `*${r.started.slice(0, 16)} → ${r.ended.slice(11, 16)} · ${r.status} · session ${r.session.slice(0, 8)} P${r.prompts[0]}-${r.prompts[1]}*`, '');
  md.push(`**Goal:** ${r.goal}`, '', `**What was done:** ${r.what_was_done}`, '');
  const files = [...r.touched.map((f) => `${f.slug}:${f.rel} (changed)`), ...r.referenced.map((f) => `${f.slug}:${f.rel} (used)`)];
  if (files.length) md.push(`**Files:** ${files.slice(0, 8).join(', ')}${files.length > 8 ? ` +${files.length - 8}` : ''}`, '');
  if (r.commits.length) md.push(`**Commits:** ${r.commits.map((c) => c.sha.slice(0, 7)).join(', ')}`, '');
  for (const d of r.decisions) md.push(`- **Decision:** ${d.choice} — *${d.why}*  \n  > ${d.evidence_quote}`);
  for (const p of r.problems) md.push(`- **Problem:** ${p.symptom} → ${p.resolution}  \n  > ${p.evidence_quote}`);
  for (const f of r.facts) md.push(`- **Fact:** ${f.statement}  \n  > ${f.evidence_quote}`);
  const v: any = verdict.get(r.id);
  if (v) md.push('', `*Judge: faithful=${v.work_faithful}, files=${v.files_ok}, usefulness=${v.teammate_usefulness}/5 — ${v.notes}*`);
  md.push('');
}
const out = path.join(evalDir(corpus), 'spotcheck.md');
fs.writeFileSync(out, md.join('\n'));
console.log(out);
