// Session events -> turns (one per human prompt) -> condensed text chunks with numbered candidate files.
import fs from 'node:fs';
import type { Ev, Session } from './transcript.ts';
import { resolveFile, resolveDir, bashDir } from './repo.ts';
import type { FileRef } from './repo.ts';
import { redact } from './redact.ts';
import { inScope } from './config.ts';
import type { Corpus } from './config.ts';

export type CommitRef = { slug: string; sha: string; branch: string };
export type TestRun = { slug: string | null; cmd: string; pass: boolean };
export type Turn = {
  idx: number; ts: string; endTs: string; cwd: string; prompt: string; lines: string[];
  edits: FileRef[]; bashWrites: FileRef[]; reads: FileRef[]; commits: CommitRef[]; tests: TestRun[];
};
export type Chunk = { session: string; first: number; last: number; text: string; files: FileRef[] };

const EDIT_TOOLS = new Set(['Edit', 'MultiEdit', 'Write', 'NotebookEdit']);
const TEST_CMD = /\b(vitest|jest|pytest|mocha|playwright\s+test|go\s+test|cargo\s+test|(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?test(?::[\w-]+)?)\b/;
const COMMIT_OUT = /\[([\w./-]+)(?: \(root-commit\))? ([0-9a-f]{7,40})\]/;

// Most file changes in real sessions go through Bash (sed -i, redirects, cp/mv, scripts), not the Edit tool.
// Only targets that a command form actually writes are counted; files a command merely reads are not.
const PATH_TOKEN = /(?:^|[\s=:'"(])((?:~\/|\.{1,2}\/|\/)?[\w@.+-]+(?:\/[\w@.+-]+)*\.[A-Za-z0-9]{1,8})(?=$|[\s'";|&)<>,:])/g;
const SCRATCH = /^(\/dev\/|\/tmp\/|\/private\/tmp\/|\$TMPDIR|\/var\/folders\/)/;

function toFile(tok: string, dir: string, corpus: Corpus): FileRef | null {
  const t = tok.replace(/^["']|["']$/g, '').replace(/^~(?=\/)/, process.env.HOME ?? '~');
  if (!t || SCRATCH.test(t)) return null;
  const abs = t.startsWith('/') ? t : `${dir}/${t}`;
  try { if (!fs.statSync(abs).isFile()) return null; } catch { return null; }
  const f = resolveFile(abs);
  return f && inScope(corpus, f.slug) ? { slug: f.slug, rel: f.rel } : null;
}

export function bashWrittenFiles(cmd: string, dir: string, corpus: Corpus): FileRef[] {
  const out: FileRef[] = [];
  const add = (tok: string) => { const f = toFile(tok, dir, corpus); if (f) pushUnique(out, f); };
  const tokens = (seg: string) => [...seg.matchAll(PATH_TOKEN)].map((m) => m[1]);
  for (const m of cmd.matchAll(/(?<![0-9&>])>>?\s*("[^"]+"|'[^']+'|[^\s;&|<>]+)/g)) add(m[1]);
  for (const seg of cmd.split(/&&|\|\||;|\||\n/)) {
    const s = seg.trim();
    if (/^(sed\s+(-[a-zA-Z]*\s+)*-i|perl\s+-[a-z]*i)/.test(s)) tokens(s).forEach(add);
    else if (/^tee\b/.test(s)) tokens(s).forEach(add);
    else if (/^(cp|mv)\b/.test(s)) { const t = tokens(s); if (t.length) add(t[t.length - 1]); }
    else if (/^git\s+(apply|restore|checkout\s+--)/.test(s)) tokens(s).forEach(add);
  }
  if (/write_text|writeFileSync|open\([^)]*['"][wa]['"]|\.write\(/.test(cmd)) tokens(cmd).forEach(add);
  return out;
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);
const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim();
const key = (f: FileRef) => `${f.slug}:${f.rel}`;

function firstErrorLine(text: string): string {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const hit = lines.find((l) => /error|fail|exception|traceback|cannot|not found|denied|refused/i.test(l));
  return clip(hit ?? lines[0] ?? '', 200);
}

function pushUnique(list: FileRef[], f: FileRef) {
  if (!list.some((x) => x.slug === f.slug && x.rel === f.rel)) list.push(f);
}

export function toTurns(s: Session, corpus: Corpus): Turn[] {
  const turns: Turn[] = [];
  let cur: Turn | null = null;
  const start = (e: Ev, prompt: string): Turn => {
    const t: Turn = { idx: turns.length, ts: e.ts, endTs: e.ts, cwd: (e as any).cwd ?? '', prompt, lines: [], edits: [], bashWrites: [], reads: [], commits: [], tests: [] };
    turns.push(t);
    return t;
  };
  for (const e of s.events) {
    if (e.kind === 'prompt') { cur = start(e, clip(redact(e.text), 1500)); continue; }
    if (!cur) cur = start(e, '(session start)');
    cur.endTs = e.ts || cur.endTs;
    if (e.kind === 'text') {
      if (!e.sidechain) cur.lines.push(`  A: ${clip(oneLine(redact(e.text)), 300)}`);
      continue;
    }
    const tag = e.sidechain ? 'SUB ' : '';
    const inp = e.input ?? {};
    if (EDIT_TOOLS.has(e.name)) {
      const f = resolveFile(inp.file_path ?? inp.notebook_path ?? '');
      if (!f || !inScope(corpus, f.slug)) continue;
      pushUnique(cur.edits, { slug: f.slug, rel: f.rel });
      const body: string = inp.new_string ?? inp.content ?? (Array.isArray(inp.edits) ? inp.edits.map((x: any) => x.new_string).join('\n') : '');
      const hint = clip(oneLine(redact(String(body))), 120);
      const status = e.result?.isError ? ' → FAIL' : '';
      cur.lines.push(`  ${tag}${e.name === 'Write' ? 'WRITE' : 'EDIT'} ${key(f)}${hint ? ` :: ${hint}` : ''}${status}`);
    } else if (e.name === 'Read') {
      const f = resolveFile(inp.file_path ?? '');
      if (!f || !inScope(corpus, f.slug)) continue;
      pushUnique(cur.reads, { slug: f.slug, rel: f.rel });
      if (cur.reads.length <= 12) cur.lines.push(`  ${tag}READ ${key(f)}`);
    } else if (e.name === 'Bash') {
      const cmd: string = String(inp.command ?? '');
      const dir = bashDir(cmd, e.cwd || cur.cwd);
      const repo = resolveDir(dir);
      const slug = repo && inScope(corpus, repo.slug) ? repo.slug : null;
      const res = e.result;
      const outcome = !res ? '' : res.isError ? ` → FAIL: ${redact(firstErrorLine(res.text))}` : ' → OK';
      let extra = '';
      if (res && !res.isError && /\bgit\b[^|;&]*\bcommit\b/.test(cmd)) {
        const m = res.text.match(COMMIT_OUT);
        if (m && slug) { cur.commits.push({ slug, sha: m[2], branch: m[1] }); extra = ` [commit ${m[2]} on ${m[1]}]`; }
      }
      if (TEST_CMD.test(cmd) && res) cur.tests.push({ slug, cmd: clip(oneLine(cmd), 120), pass: !res.isError });
      // files a command names (grep, cat, git show, sed -n …) are things the work looked at: candidates, not changes
      for (const m of cmd.matchAll(PATH_TOKEN)) { const f = toFile(m[1], dir, corpus); if (f) pushUnique(cur.reads, f); }
      let touches = '';
      if (res && !res.isError) {
        const written = bashWrittenFiles(cmd, dir, corpus);
        for (const f of written) pushUnique(cur.bashWrites, f);
        if (written.length) touches = ` {writes: ${written.slice(0, 4).map(key).join(', ')}}`;
      }
      cur.lines.push(`  ${tag}BASH${slug ? `(${slug})` : ''} ${clip(oneLine(redact(cmd)), 200)}${outcome}${extra}${touches}`);
    } else if (e.name === 'Task' || e.name === 'Agent') {
      cur.lines.push(`  AGENT: ${clip(oneLine(redact(String(inp.description ?? inp.prompt ?? ''))), 160)}`);
    }
  }
  return turns;
}

function renderTurn(t: Turn, maxLines: number): string {
  const lines = t.lines.length > maxLines ? [...t.lines.slice(0, maxLines - 15), `  … (${t.lines.length - maxLines} lines omitted) …`, ...t.lines.slice(-15)] : t.lines;
  return [`[P${t.idx} ${t.ts.slice(0, 16)}] USER: ${t.prompt}`, ...lines].join('\n');
}

export function toChunks(sessionId: string, turns: Turn[], maxChars: number): Chunk[] {
  const chunks: Chunk[] = [];
  let buf: Turn[] = [];
  let size = 0;
  const flush = () => {
    if (!buf.length) return;
    const files: FileRef[] = [];
    for (const t of buf) for (const f of t.edits) pushUnique(files, f);
    for (const t of buf) for (const f of t.bashWrites) pushUnique(files, f);
    const readCount = new Map<string, { f: FileRef; n: number }>();
    for (const t of buf) for (const f of t.reads) {
      const k = key(f);
      readCount.set(k, { f, n: (readCount.get(k)?.n ?? 0) + 1 });
    }
    for (const { f } of [...readCount.values()].sort((a, b) => b.n - a.n).slice(0, 20)) pushUnique(files, f);
    const body = buf.map((t) => renderTurn(t, 80)).join('\n');
    const list = files.map((f, i) => `[${i + 1}] ${key(f)}`).join('\n');
    chunks.push({ session: sessionId, first: buf[0].idx, last: buf[buf.length - 1].idx, text: `CANDIDATE FILES:\n${list || '(none)'}\n\nEXCERPT:\n${body}`, files });
    buf = [];
    size = 0;
  };
  for (const t of turns) {
    const len = renderTurn(t, 80).length;
    if (size + len > maxChars && buf.length) flush();
    buf.push(t);
    size += len;
  }
  flush();
  return chunks;
}

// A turn is worth extracting if it changed something, ran something, or carried a substantive prompt.
export function isSubstantive(t: Turn): boolean {
  return t.edits.length > 0 || t.bashWrites.length > 0 || t.commits.length > 0 || t.lines.length >= 3 || t.prompt.length >= 40;
}
