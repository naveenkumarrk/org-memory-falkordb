import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

fs.mkdirSync('.demo', { recursive: true });
if (!fs.existsSync('.dev.vars')) {
  const token = crypto.randomBytes(32).toString('base64url');
  const mapping = { [token]: { org: 'demo', repos: ['demo/commerce'], role: 'writer' } };
  fs.writeFileSync('.dev.vars', `FALKORDB_URL="redis://127.0.0.1:16379"\nORG_MEMORY_API_KEYS='${JSON.stringify(mapping)}'\n`, { mode: 0o600 });
  fs.writeFileSync('.demo/client.json', JSON.stringify({ url: 'http://127.0.0.1:8787', token, repo: 'demo/commerce' }), { mode: 0o600 });
}
if (!fs.existsSync('.demo/client.json')) throw new Error('Existing .dev.vars found. Configure .demo/client.json or use API environment variables; existing secrets were preserved.');
const workspace = path.resolve('.demo/workspace/commerce');
if (!fs.existsSync(workspace)) {
  fs.mkdirSync(path.join(workspace, 'src'), { recursive: true });
  fs.copyFileSync('fixtures/commerce/auth.ts', path.join(workspace, 'src/authentication.ts'));
  fs.copyFileSync('fixtures/commerce/checkout.ts', path.join(workspace, 'src/mobile-checkout.ts'));
  execFileSync('git', ['init', '-q', '-b', 'main', workspace]);
  execFileSync('git', ['-C', workspace, 'remote', 'add', 'origin', 'https://github.com/demo/commerce.git']);
}
fs.mkdirSync(path.join(workspace, 'test'), { recursive: true });
if (!fs.existsSync(path.join(workspace, 'test', 'compat.test.ts')))
  fs.writeFileSync(path.join(workspace, 'test', 'compat.test.ts'), fs.readFileSync('fixtures/commerce/compat.test.ts', 'utf8').replace("new URL('./auth.ts'", "new URL('../src/authentication.ts'"));
if (!fs.existsSync(path.join(workspace, 'package.json')))
  fs.writeFileSync(path.join(workspace, 'package.json'), JSON.stringify({ private: true, type: 'module', scripts: { test: 'node --no-warnings --test test/*.test.ts' } }, null, 2));
console.log('Local demo configured. Random credentials are in gitignored files and were not printed.');
console.log('Start FalkorDB, then npm run dev, npm run demo:seed, and npm run demo:agent.');
console.log(`Synthetic workspace for optional Claude testing: ${workspace}`);
