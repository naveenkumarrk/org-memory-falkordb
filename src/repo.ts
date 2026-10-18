// Path -> repo identity. Read-only: only `git remote get-url` with --no-optional-locks.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

export type FileRef = { slug: string; rel: string };

const rootByDir = new Map<string, string | null>();
const slugByRoot = new Map<string, string | null>();
const rootBySlug = new Map<string, string>();
const emailBySlug = new Map<string, string | null>();

export function normalizeRemote(url: string): string | null {
  const m = url.trim().match(/github\.com[:/]+([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i);
  return m ? `${m[1]}/${m[2]}`.toLowerCase() : null;
}

function nearestExistingDir(p: string): string | null {
  let cur = path.resolve(p);
  for (;;) {
    try {
      const st = fs.statSync(cur);
      return st.isDirectory() ? cur : path.dirname(cur);
    } catch {
      const parent = path.dirname(cur);
      if (parent === cur) return null;
      cur = parent;
    }
  }
}

export function gitRoot(p: string): string | null {
  const start = nearestExistingDir(p);
  if (!start) return null;
  const seen: string[] = [];
  let dir = start;
  let found: string | null = null;
  for (;;) {
    if (rootByDir.has(dir)) { found = rootByDir.get(dir)!; break; }
    seen.push(dir);
    if (fs.existsSync(path.join(dir, '.git'))) { found = dir; break; }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  for (const d of seen) rootByDir.set(d, found);
  return found;
}

export function remoteSlug(root: string): string | null {
  if (slugByRoot.has(root)) return slugByRoot.get(root)!;
  let slug: string | null = null;
  try {
    const url = execFileSync('git', ['-C', root, '--no-optional-locks', 'remote', 'get-url', 'origin'], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000,
    });
    slug = normalizeRemote(url);
  } catch { slug = null; }
  slugByRoot.set(root, slug);
  if (slug && !rootBySlug.has(slug)) rootBySlug.set(slug, root);
  return slug;
}

// The git identity configured for a repo (work vs personal identities are scoped per directory).
export function personFor(slug: string): string | null {
  if (emailBySlug.has(slug)) return emailBySlug.get(slug)!;
  const root = rootBySlug.get(slug);
  let email: string | null = null;
  if (root) {
    try {
      email = execFileSync('git', ['-C', root, '--no-optional-locks', 'config', '--get', 'user.email'], {
        encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000,
      }).trim() || null;
    } catch { email = null; }
  }
  emailBySlug.set(slug, email);
  return email;
}

export function resolveFile(absPath: string): (FileRef & { root: string }) | null {
  if (!absPath || !path.isAbsolute(absPath)) return null;
  const root = gitRoot(absPath);
  if (!root) return null;
  const slug = remoteSlug(root);
  if (!slug) return null;
  const rel = path.relative(root, absPath).split(path.sep).join('/');
  if (!rel || rel.startsWith('..')) return null;
  return { slug, rel, root };
}

export function resolveDir(absDir: string): { slug: string; root: string } | null {
  const root = gitRoot(absDir);
  if (!root) return null;
  const slug = remoteSlug(root);
  return slug ? { slug, root } : null;
}

// Effective working directory of a Bash command: honours a leading `cd X &&` and `git -C X`.
export function bashDir(command: string, cwd: string): string {
  let dir = cwd;
  const cd = command.match(/^\s*cd\s+("[^"]+"|'[^']+'|[^\s;&|]+)\s*(?:&&|;)/);
  if (cd) dir = path.resolve(cwd, cd[1].replace(/^["']|["']$/g, '').replace(/^~(?=\/|$)/, process.env.HOME ?? '~'));
  const gc = command.match(/\bgit\s+-C\s+("[^"]+"|'[^']+'|\S+)/);
  if (gc) dir = path.resolve(dir, gc[1].replace(/^["']|["']$/g, '').replace(/^~(?=\/|$)/, process.env.HOME ?? '~'));
  return dir;
}
