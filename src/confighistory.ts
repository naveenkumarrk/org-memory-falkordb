// Config value history from git: how each key in a repo's wrangler.json(c) changed over time, with commit and date.
// Sessions never mention many values (IDs, URLs, flags) that later tasks need to restore or compare; git has them.
// Read-only git; values pass through secret redaction; `before` keeps time-split graphs free of future knowledge.
import { execFileSync } from 'node:child_process';
import { redact } from './redact.ts';

export type ConfigChange = { from: string | null; to: string | null; sha: string; ts: number; subject: string };
export type ConfigHistory = { path: string; key: string; changes: ConfigChange[] };

const git = (root: string, args: string[]) => {
  try { return execFileSync('git', ['-C', root, '--no-optional-locks', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 256 * 1024 * 1024, timeout: 60_000 }); } catch { return null; }
};

export function stripJsonc(s: string): string {
  let out = '';
  let inStr = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    const n = s[i + 1];
    if (inStr) { out += c; if (c === '\\') { out += n ?? ''; i++; } else if (c === '"') inStr = false; continue; }
    if (c === '"') { inStr = true; out += c; continue; }
    if (c === '/' && n === '/') { while (i < s.length && s[i] !== '\n') i++; out += '\n'; continue; }
    if (c === '/' && n === '*') { i += 2; while (i < s.length && !(s[i] === '*' && s[i + 1] === '/')) i++; i++; continue; }
    out += c;
  }
  return out.replace(/,(\s*[}\]])/g, '$1');
}

export function flatten(v: unknown, prefix = '', out = new Map<string, string>()): Map<string, string> {
  if (v && typeof v === 'object') {
    if (Array.isArray(v) && v.every((x) => typeof x !== 'object' || x === null)) out.set(prefix, JSON.stringify(v));
    else for (const [k, x] of Object.entries(v as Record<string, unknown>)) flatten(x, prefix ? `${prefix}.${k}` : k, out);
  } else if (prefix) out.set(prefix, String(v));
  return out;
}

function parseAt(root: string, rev: string, path: string): Map<string, string> | null {
  const raw = git(root, ['show', `${rev}:${path}`]);
  if (raw === null) return null;
  try { return flatten(JSON.parse(stripJsonc(raw))); } catch { return null; }
}

// Keys whose churn is noise rather than knowledge.
const NOISE = /(^|\.)(compatibility_date|compatibility_flags|\$schema|main|name)$/;
const clipVal = (v: string | null) => (v === null ? null : redact(v.length > 120 ? `${v.slice(0, 117)}…` : v));

export function configHistory(root: string, ref: string, before?: string, maxCommits = 400): ConfigHistory[] {
  const args = ['log', ref, '--since=12.months', '-n', String(maxCommits), '--format=%x1e%H %ct %s', '--name-only', '--', ':(glob)**/wrangler.json', ':(glob)**/wrangler.jsonc'];
  if (before) args.splice(2, 0, `--before=${before}`);
  const log = git(root, args) ?? '';
  const byKey = new Map<string, ConfigHistory>();
  for (const block of log.split('\x1e')) {
    const lines = block.split('\n').filter(Boolean);
    if (!lines.length) continue;
    const m = lines[0].match(/^([0-9a-f]{40}) (\d+) (.*)$/);
    if (!m) continue;
    const [, sha, ts, subject] = m;
    for (const path of lines.slice(1)) {
      const after = parseAt(root, sha, path);
      if (!after) continue;
      const prior = parseAt(root, `${sha}^`, path) ?? new Map<string, string>();
      for (const key of new Set([...prior.keys(), ...after.keys()])) {
        if (NOISE.test(key)) continue;
        const from = prior.get(key) ?? null;
        const to = after.get(key) ?? null;
        if (from === to || (from === null && prior.size === 0)) continue; // skip unchanged keys and a file's very first version
        const k = `${path}\u0000${key}`;
        if (!byKey.has(k)) byKey.set(k, { path, key, changes: [] });
        byKey.get(k)!.changes.push({ from: clipVal(from), to: clipVal(to), sha: sha.slice(0, 10), ts: Number(ts), subject: subject.slice(0, 90) });
      }
    }
  }
  for (const h of byKey.values()) h.changes.sort((a, b) => a.ts - b.ts);
  return [...byKey.values()];
}

export function historyStatement(h: ConfigHistory): string {
  const last = h.changes.slice(-3);
  const steps = last.map((c) => `${c.from ?? '(none)'} → ${c.to ?? '(removed)'} on ${new Date(c.ts * 1000).toISOString().slice(0, 10)} (${c.sha.slice(0, 8)} "${c.subject}")`);
  return `${h.path} ${h.key}: ${steps.join('; then ')}`;
}
