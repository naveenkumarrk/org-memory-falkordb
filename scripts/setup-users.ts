import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { parseEnv } from 'node:util';
import { execFileSync } from 'node:child_process';
import { api } from './client.ts';
import { profiles, profileRoot } from './profiles.ts';

const varsPath = '.dev.vars';
if (!fs.existsSync(varsPath) || !fs.existsSync('.demo/client.json')) throw new Error('Run npm run setup:local first.');
const contents = fs.readFileSync(varsPath, 'utf8');
const vars = parseEnv(contents);
const mapping = JSON.parse(vars.ORG_MEMORY_API_KEYS ?? '{}');
const endpoint = JSON.parse(fs.readFileSync('.demo/client.json', 'utf8')).url;
const target = new URL(endpoint);
if (!['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname)) throw new Error('User demo setup is local-only; it edits .dev.vars.');
const clients = [];
for (const name of profiles) {
  const root = profileRoot(name); fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  const clientPath = path.join(root, 'client.json');
  const token = fs.existsSync(clientPath) ? JSON.parse(fs.readFileSync(clientPath, 'utf8')).token : crypto.randomBytes(32).toString('base64url');
  const principal = { user_id: name, org: name === 'outsider' ? 'demo-other-team' : 'demo-team', repos: ['demo/commerce'], role: name === 'outsider' ? 'reader' : 'writer' };
  if (mapping[token] && JSON.stringify(mapping[token]) !== JSON.stringify(principal)) throw new Error(`Existing ${name} profile scope differs; existing credentials were preserved.`);
  mapping[token] = principal;
  const client = { url: endpoint, token, repository: 'demo/commerce' };
  fs.writeFileSync(clientPath, JSON.stringify(client), { mode: 0o600 }); fs.chmodSync(clientPath, 0o600);
  clients.push(client);
  const workspace = path.join(root, 'workspace');
  fs.mkdirSync(path.join(workspace, 'src'), { recursive: true }); fs.mkdirSync(path.join(workspace, 'test'), { recursive: true });
  const sources = [
    ['fixtures/commerce/auth.ts', 'src/authentication.ts'],
    ['fixtures/commerce/checkout.ts', 'src/mobile-checkout.ts'],
  ];
  for (const [source, dest] of sources) if (!fs.existsSync(path.join(workspace, dest))) fs.copyFileSync(source, path.join(workspace, dest));
  const testPath = path.join(workspace, 'test', 'compat.test.ts');
  if (!fs.existsSync(testPath)) fs.writeFileSync(testPath, fs.readFileSync('fixtures/commerce/compat.test.ts', 'utf8').replace("new URL('./auth.ts'", "new URL('../src/authentication.ts'"));
  if (!fs.existsSync(path.join(workspace, 'package.json'))) fs.writeFileSync(path.join(workspace, 'package.json'), JSON.stringify({ private: true, type: 'module', scripts: { test: 'node --no-warnings --test test/*.test.ts' } }));
  if (!fs.existsSync(path.join(workspace, '.git'))) {
    execFileSync('git', ['init', '-q', '-b', 'main', workspace]);
    execFileSync('git', ['-C', workspace, 'remote', 'add', 'origin', 'https://github.com/demo/commerce.git']);
  }
  const childEnv = { ...process.env, ORG_MEMORY_CLIENT_CONFIG: clientPath, ORG_MEMORY_HOOK_HOME: path.join(root, 'home') };
  delete childEnv.ORG_MEMORY_API_URL; delete childEnv.ORG_MEMORY_API_TOKEN;
  execFileSync(process.execPath, ['--no-warnings', 'scripts/setup-hooks.ts'], { stdio: 'ignore', env: childEnv });
}
// JSON apostrophe escapes preserve the single-quoted dotenv assignment, including existing principals.
const serialized = JSON.stringify(mapping).replaceAll("'", '\\u0027');
if (!/^ORG_MEMORY_API_KEYS=[^\r\n]*$/m.test(contents)) throw new Error('Expected a one-line ORG_MEMORY_API_KEYS assignment in .dev.vars.');
const next = contents.replace(/^ORG_MEMORY_API_KEYS=[^\r\n]*$/m, `ORG_MEMORY_API_KEYS='${serialized}'`);
if (JSON.stringify(JSON.parse(parseEnv(next).ORG_MEMORY_API_KEYS)) !== JSON.stringify(mapping)) throw new Error('Credential serialization failed; existing .dev.vars was preserved.');
fs.writeFileSync(varsPath, next, { mode: 0o600 }); fs.chmodSync(varsPath, 0o600);
console.log('Created separate Alice, Bob and outsider clients. Existing keys were preserved; no credentials were printed.');
console.log('Alice/Bob share demo-team / demo/commerce. Outsider belongs to demo-other-team.');
let ready = false;
for (let retry = 0; retry < 15; retry++) {
  try { for (const client of clients) await api('/v1/me', undefined, client); ready = true; break; }
  catch { await new Promise(r => setTimeout(r, 500)); }
}
console.log(ready ? 'The running API recognizes all three profiles. Run npm run demo:users.' : 'Restart npm run dev to load the new keys, then run npm run demo:users.');
