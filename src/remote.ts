// Shared-service adapter. Local capture/Git stay here; all remote recall is performed in FalkorDB.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { dataDir } from './config.ts';
import { gitRoot, remoteSlug, resolveFile } from './repo.ts';
import { promptAnchors } from './query.ts';
import { redact } from './redact.ts';
import { loadSettings } from './settings.ts';

export type RemoteConfig = { url: string; token: string };
export function remoteConfig(): RemoteConfig | null {
  if (process.env.ORG_MEMORY_API_URL && process.env.ORG_MEMORY_API_TOKEN)
    return { url: process.env.ORG_MEMORY_API_URL, token: process.env.ORG_MEMORY_API_TOKEN };
  try {
    const c = JSON.parse(fs.readFileSync(path.join(dataDir('prod'), 'remote.json'), 'utf8'));
    return c.url && c.token ? c : null;
  } catch { return null; }
}

export async function remoteRequest(config: RemoteConfig, route: string, body?: unknown, timeout = 2500) {
  const response = await fetch(`${config.url.replace(/\/$/, '')}${route}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(timeout),
  });
  const data = await response.json() as any;
  if (!response.ok) throw new Error(`Memory API ${response.status}: ${data.error ?? 'request failed'}`);
  return data;
}

export async function recallForHook(config: RemoteConfig, input: any, limit = 4) {
  const root = gitRoot(String(input.cwd ?? ''));
  const repository = root ? remoteSlug(root) : null;
  if (!root || !repository) return null;
  if (loadSettings().repos[repository]?.include === false) return null;
  let files: string[] = [];
  let query = '';
  if (input.hook_event_name === 'UserPromptSubmit') {
    query = redact(String(input.prompt ?? ''));
    files = promptAnchors(query).files.map(f => path.isAbsolute(f) ? resolveFile(f)?.rel ?? f : f);
  } else if (input.hook_event_name === 'PostToolUse') {
    const file = resolveFile(String(input.tool_input?.file_path ?? ''));
    if (!file || file.slug !== repository) return null;
    files = [file.rel];
  } else if (input.hook_event_name === 'PostToolUseFailure') {
    query = redact(String(input.error ?? '').slice(0, 2000));
    if (!query) return null;
  } else return null;
  const fingerprints: Record<string, string> = {};
  for (const file of files) {
    const abs = path.resolve(root, file);
    if (!abs.startsWith(`${root}${path.sep}`)) continue;
    try { fingerprints[file] = crypto.createHash('sha256').update(fs.readFileSync(abs)).digest('hex'); } catch { /* missing */ }
  }
  return remoteRequest(config, '/v1/recall', { repository, files: files.slice(0, 12), query: query.slice(0, 2000), fingerprints,
    exclude_session: String(input.session_id ?? ''), limit, max_chars: 6000, graph_expansion: true,
    types: input.hook_event_name === 'PostToolUseFailure' ? ['Problem'] : [] });
}
