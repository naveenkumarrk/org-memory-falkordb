// Stop hook (async): schedule `orgmem sync` for this session in the background. Debounced and locked; fails open.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { CORPUS, dataDir } from './config.ts';
import { loadSettings } from './settings.ts';

const DEBOUNCE_MS = 10 * 60_000; // a graph rebuild takes ~50 s of git work; at most one per session every 10 min
const LOCK_STALE_MS = 15 * 60_000;

try {
  const input = JSON.parse(fs.readFileSync(0, 'utf8') || '{}');
  // live capture is for company sessions only (cwd under the company workspace); test sessions are backfilled by hand
  const company = String(input.cwd ?? '').startsWith(CORPUS.prod.repoRoot);
  if (process.env.ORG_MEMORY_INTERNAL !== '1' && loadSettings().enabled && input.session_id && company) {
    const test = false;
    const dir = dataDir('prod');
    const stateDir = path.join(dir, 'state');
    fs.mkdirSync(stateDir, { recursive: true });
    const stamp = path.join(stateDir, `sync-${input.session_id}.stamp`);
    const lock = path.join(dir, 'sync.lock');
    const fresh = (f: string, ms: number) => { try { return Date.now() - fs.statSync(f).mtimeMs < ms; } catch { return false; } };
    // never sync while a full backfill is writing the same records
    const backfilling = fresh(path.join(dir, 'backfill.lock'), 3 * 3_600_000);
    if (!backfilling && !fresh(stamp, DEBOUNCE_MS) && !fresh(lock, LOCK_STALE_MS)) {
      fs.writeFileSync(stamp, '');
      fs.mkdirSync(path.join(dir, 'logs'), { recursive: true });
      const log = fs.openSync(path.join(dir, 'logs', 'sync.log'), 'a');
      const cli = path.join(path.dirname(new URL(import.meta.url).pathname), 'cli.ts');
      const sh = `touch '${lock}'; node --no-warnings '${cli}' sync --session '${input.session_id}' ${test ? '--test' : ''}; rm -f '${lock}'`;
      spawn('/bin/sh', ['-c', sh], { detached: true, stdio: ['ignore', log, log], env: { ...process.env } }).unref();
    }
  }
} catch { /* fail open */ }
process.exit(0);
