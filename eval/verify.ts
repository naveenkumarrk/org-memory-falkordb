// Deterministic verification of every record (no LLM): commits exist in git, files exist, evidence quotes occur in the
// ORIGINAL session text (not just the condensed excerpt), timestamps are sane. Writes <dataDir>/eval/verify.json.
import fs from 'node:fs';
import path from 'node:path';
import { CORPUS, PROJECTS_DIR } from '../src/config.ts';
import { loadRecords } from '../src/backfill.ts';
import { listSessionFiles } from '../src/transcript.ts';
import { findClones, RepoIndex } from '../src/git.ts';
import { evalDir } from './common.ts';

const corpus = process.argv.includes('--test') ? 'test' : 'prod';
const norm = (s: string) => s.replace(/…/g, '...').replace(/\\[nrt]/g, ' ').replace(/\\"/g, '"').replace(/\s+/g, ' ').trim().toLowerCase();

// Original session text: every string in every record of the session file and its subagent files, JSON-decoded.
const sessionText = new Map<string, string>();
function textOf(file: string): string {
  const parts: string[] = [];
  const walk = (v: unknown) => {
    if (typeof v === 'string') parts.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) { if (line) { try { walk(JSON.parse(line)); } catch { /* skip */ } } }
  return parts.join('\n');
}
for (const f of listSessionFiles(CORPUS[corpus].projectPrefix, PROJECTS_DIR)) {
  const id = path.basename(f, '.jsonl');
  let t = textOf(f);
  const sub = path.join(path.dirname(f), id, 'subagents');
  if (fs.existsSync(sub)) for (const s of fs.readdirSync(sub)) if (s.endsWith('.jsonl')) t += `\n${textOf(path.join(sub, s))}`;
  sessionText.set(id, norm(t));
}

const recs = loadRecords(corpus);
const clones = findClones(CORPUS[corpus].repoRoot);
const idx = new Map<string, RepoIndex>();
const repo = (slug: string) => { if (!idx.has(slug)) idx.set(slug, new RepoIndex(slug, clones.get(slug) ?? [])); return idx.get(slug)!; };

let quotes = 0, quotesFound = 0, commits = 0, commitsFound = 0, files = 0, filesFound = 0, badTime = 0;
const missingQuotes: Array<{ id: string; quote: string }> = [];
const missingCommits: Array<{ id: string; slug: string; sha: string; title: string }> = [];
const missingFiles = new Map<string, number>();
for (const r of recs) {
  const hay = sessionText.get(r.session) ?? '';
  for (const x of [...r.decisions, ...r.problems, ...r.facts]) {
    quotes++;
    const parts = norm(x.evidence_quote).split('...').map((p) => p.trim()).filter((p) => p.length >= 8);
    // redaction may have replaced a secret inside the quote; compare the longest unredacted run
    const ok = parts.length > 0 && parts.every((p) => p.split('[redacted').some((seg) => seg.length < 8 || hay.includes(seg.replace(/^[^\]]*\]/, '').trim())));
    if (ok) quotesFound++; else missingQuotes.push({ id: x.id, quote: x.evidence_quote.slice(0, 120) });
  }
  for (const c of r.commits) {
    commits++;
    if (repo(c.slug).commit(c.sha)) commitsFound++; else missingCommits.push({ id: r.id, slug: c.slug, sha: c.sha, title: r.title.slice(0, 70) });
  }
  for (const f of r.touched) {
    files++;
    const ok = repo(f.slug).roots.some((root) => fs.existsSync(path.join(root, f.rel)));
    if (ok) filesFound++; else missingFiles.set(f.slug, (missingFiles.get(f.slug) ?? 0) + 1);
  }
  if (!(r.started <= r.ended)) badTime++;
}
const pct = (a: number, b: number) => `${b ? ((100 * a) / b).toFixed(1) : 'n/a'}% (${a}/${b})`;
const summary = {
  records: recs.length,
  evidence_quotes_in_original_session: pct(quotesFound, quotes),
  commits_exist_in_git: pct(commitsFound, commits),
  touched_files_exist_in_a_checkout: pct(filesFound, files),
  missing_files_by_repo: Object.fromEntries(missingFiles),
  bad_timestamps: badTime,
  people: [...new Set(recs.map((r) => r.person))],
};
fs.writeFileSync(path.join(evalDir(corpus), 'verify.json'), JSON.stringify({ summary, missingQuotes, missingCommits }, null, 2));
console.log(JSON.stringify(summary, null, 2));
console.log('missing commits:', JSON.stringify(missingCommits.slice(0, 12), null, 1));
console.log('missing quotes (sample):', JSON.stringify(missingQuotes.slice(0, 5), null, 1));
