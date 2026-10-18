// Read-only git access across all local clones of a repo (the same repo may be cloned in several workspace folders).
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { remoteSlug } from './repo.ts';

function git(root: string, args: string[]): string | null {
  try {
    return execFileSync('git', ['-C', root, '--no-optional-locks', ...args], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 30_000, maxBuffer: 512 * 1024 * 1024,
    });
  } catch { return null; }
}

export function findClones(baseDir: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const visit = (dir: string, depth: number) => {
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    if (entries.some((e) => e.name === '.git')) {
      const slug = remoteSlug(dir);
      if (slug) out.set(slug, [...(out.get(slug) ?? []), dir]);
      return;
    }
    if (depth === 0) return;
    // hidden dirs can be real repos (e.g. a team's .claude config repo); skip only caches and VCS internals
    for (const e of entries) if (e.isDirectory() && !['.git', '.cache', '.venv', '.next', '.turbo', 'node_modules'].includes(e.name)) visit(path.join(dir, e.name), depth - 1);
  };
  visit(baseDir, 2);
  return out;
}

export type CommitInfo = { full: string; landed: boolean; ts: number; subject: string; files: string[] };
export type FileState = 'current' | 'changed_since' | 'not_on_main';

export class RepoIndex {
  slug: string;
  roots: string[];
  private refs = new Map<string, string | null>();
  private commits = new Map<string, CommitInfo | null>();
  private hist: { changes: Map<string, Array<[number, string]>>; onMain: Set<string>; coChange: Map<string, Map<string, number>> } | null = null;

  constructor(slug: string, roots: string[]) {
    this.slug = slug;
    // Prefer the clone whose default branch is freshest.
    this.roots = [...roots].sort((a, b) => this.refTime(b) - this.refTime(a));
  }

  ref(root: string): string | null {
    if (this.refs.has(root)) return this.refs.get(root)!;
    let ref = git(root, ['rev-parse', '--abbrev-ref', 'origin/HEAD'])?.trim() || null;
    if (!ref || ref === 'origin/HEAD') {
      ref = ['origin/main', 'origin/master', 'main', 'master'].find((r) => git(root, ['rev-parse', '--verify', '--quiet', r]) !== null) ?? null;
    }
    this.refs.set(root, ref);
    return ref;
  }

  private refTime(root: string): number {
    const ref = this.ref(root);
    return ref ? Number(git(root, ['log', '-1', '--format=%ct', ref])?.trim() ?? 0) : 0;
  }

  commit(sha: string): CommitInfo | null {
    if (this.commits.has(sha)) return this.commits.get(sha)!;
    let info: CommitInfo | null = null;
    for (const root of this.roots) {
      const full = git(root, ['rev-parse', '--verify', '--quiet', `${sha}^{commit}`])?.trim();
      if (!full) continue;
      const meta = git(root, ['show', '-s', '--format=%ct%x1f%s', full])?.trim().split('\x1f') ?? ['0', ''];
      const files = (git(root, ['show', '--name-only', '--format=', full]) ?? '').split('\n').filter(Boolean);
      // landed if any clone's default branch contains it
      const landed = this.roots.some((r) => { const ref = this.ref(r); return !!ref && git(r, ['merge-base', '--is-ancestor', full, ref]) !== null; });
      info = { full, landed, ts: Number(meta[0]), subject: meta[1] ?? '', files };
      break;
    }
    this.commits.set(sha, info);
    return info;
  }

  private history() {
    if (this.hist) return this.hist;
    const changes = new Map<string, Array<[number, string]>>(); // file -> recent (time, sha), newest first
    const onMain = new Set<string>();
    const coChange = new Map<string, Map<string, number>>();
    const root = this.roots[0];
    const ref = root ? this.ref(root) : null;
    if (root && ref) {
      for (const f of (git(root, ['ls-tree', '-r', '--name-only', ref]) ?? '').split('\n')) if (f) onMain.add(f);
      const log = git(root, ['log', ref, '--since=9.months', '-n', '4000', '--name-only', '--format=%x1e%ct %H']) ?? '';
      for (const block of log.split('\x1e')) {
        const lines = block.split('\n').filter(Boolean);
        if (!lines.length) continue;
        const [tsStr, sha] = lines[0].split(' ');
        const ts = Number(tsStr);
        const files = lines.slice(1);
        for (const f of files) {
          const list = changes.get(f) ?? [];
          if (list.length < 30) list.push([ts, sha]);
          changes.set(f, list);
        }
        if (files.length < 2 || files.length > 30) continue;
        for (const a of files) {
          let m = coChange.get(a);
          if (!m) coChange.set(a, (m = new Map()));
          for (const b of files) if (a !== b) m.set(b, (m.get(b) ?? 0) + 1);
        }
      }
    }
    this.hist = { changes, onMain, coChange };
    return this.hist;
  }

  // Changed since the work ended, ignoring the work's own commits and a 2-day grace for its squash/merge landing.
  fileState(rel: string, sinceIso: string, ownShas: string[] = []): FileState {
    const h = this.history();
    if (!h.onMain.has(rel)) return 'not_on_main';
    const since = Date.parse(sinceIso) / 1000;
    if (!since) return 'current';
    const own = (sha: string) => ownShas.some((o) => sha.startsWith(o) || o.startsWith(sha));
    const later = (h.changes.get(rel) ?? []).filter(([ts, sha]) => ts > since + 2 * 86_400 && !own(sha));
    return later.length ? 'changed_since' : 'current';
  }

  coChanged(rel: string, min = 2, top = 10): Array<[string, number]> {
    const m = this.history().coChange.get(rel);
    if (!m) return [];
    return [...m].filter(([, n]) => n >= min).sort((a, b) => b[1] - a[1]).slice(0, top);
  }
}
