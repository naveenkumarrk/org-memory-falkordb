import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { dataDir } from './config.ts';

const lock = path.join(dataDir('prod'), 'sync.lock');
try {
  if (fs.existsSync(lock) && Date.now() - fs.statSync(lock).mtimeMs > 15 * 60_000) fs.unlinkSync(lock);
  fs.closeSync(fs.openSync(lock, 'wx'));
} catch { process.exit(0); }
try {
  const cli = path.join(path.dirname(new URL(import.meta.url).pathname), 'cli.ts');
  const result = spawnSync(process.execPath, ['--no-warnings', cli, 'sync', '--session', process.argv[2]], { stdio: 'inherit' });
  process.exitCode = result.status ?? 1;
} finally { fs.rmSync(lock, { force: true }); }
