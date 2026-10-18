// Shared eval helpers. Outputs contain company data, so they go to <dataDir>/eval, never into this repo.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { CORPUS, PROJECTS_DIR, EXTRACT, dataDir } from '../src/config.ts';
import type { Corpus } from '../src/config.ts';
import { listSessionFiles, parseSession } from '../src/transcript.ts';
import { toTurns, toChunks } from '../src/condense.ts';
import type { Chunk } from '../src/condense.ts';
import { chunkKey, claudeJson } from '../src/extract.ts';

export const evalDir = (corpus: Corpus) => { const d = path.join(dataDir(corpus), 'eval'); fs.mkdirSync(d, { recursive: true }); return d; };

// Rebuild chunks exactly as backfill did (same session order, same uuid dedupe) and index them by cache key.
export function chunkIndex(corpus: Corpus): Map<string, Chunk> {
  const out = new Map<string, Chunk>();
  const seen = new Set<string>();
  for (const f of listSessionFiles(CORPUS[corpus].projectPrefix, PROJECTS_DIR)) {
    const s = parseSession(f, seen);
    for (const c of toChunks(s.id, toTurns(s, corpus), EXTRACT.chunkChars)) out.set(chunkKey(c), c);
  }
  return out;
}

export function rng(seed: number) {
  return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export function sample<T>(xs: T[], n: number, seed = 7): T[] {
  const r = rng(seed);
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a.slice(0, n);
}

// Cached judge call (a different, stronger model than the extractor).
export async function judge(corpus: Corpus, system: string, prompt: string, schema: unknown, model = process.env.ORG_MEMORY_JUDGE ?? 'opus') {
  const dir = path.join(evalDir(corpus), 'judge-cache');
  fs.mkdirSync(dir, { recursive: true });
  const key = crypto.createHash('sha1').update(`${model}\n${system}\n${prompt}`).digest('hex');
  const f = path.join(dir, `${key}.json`);
  if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf8'));
  const tmp = path.join(dataDir(corpus), 'tmp');
  fs.mkdirSync(tmp, { recursive: true });
  const r = await claudeJson({ model, system, prompt, schema, cwd: tmp });
  if (!r.error) fs.writeFileSync(f, JSON.stringify(r));
  return r;
}
