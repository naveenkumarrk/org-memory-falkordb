// Upload secrets through stdin; never place a credential in command arguments or logs.
import fs from 'node:fs';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { connect } from '../worker/graph.ts';

if (fs.existsSync('.env.hosted')) process.loadEnvFile('.env.hosted');
const database = process.env.FALKORDB_URL;
const endpoint = process.env.ORG_MEMORY_API_URL;
if (!database || !endpoint) throw new Error('Set FALKORDB_URL and ORG_MEMORY_API_URL in gitignored .env.hosted first.');
if (new URL(endpoint).protocol !== 'https:') throw new Error('The hosted API URL must use HTTPS.');
let db: Awaited<ReturnType<typeof connect>> | undefined;
try {
  db = await connect(database);
  await db.selectGraph('orgmem_connection_check').query('RETURN 1 AS connected');
} catch {
  throw new Error('FalkorDB connection failed. Run npm run hosted:check after checking .env.hosted. Connection details were not printed.');
} finally { await db?.close(); }
fs.mkdirSync('.demo', { recursive: true });
const clientFile = '.demo/hosted-client.json';
const existing = fs.existsSync(clientFile) ? JSON.parse(fs.readFileSync(clientFile, 'utf8')) : null;
const demoToken = existing?.token ?? crypto.randomBytes(32).toString('base64url');
const keys: Record<string, unknown> = { [demoToken]: { org: 'demo', repos: ['demo/commerce'], role: 'writer' } };
// Optional private organization gets a separate key and graph namespace.
const org = process.env.ORG_MEMORY_ORG;
const repos = (process.env.ORG_MEMORY_REPOS ?? '').split(',').map(r => r.trim()).filter(Boolean);
let privateClient: Record<string, unknown> | undefined;
if (org || repos.length) {
  if (!org || org === 'demo' || !repos.length || repos.some(r => !/^[\w.-]+\/[\w.-]+$/.test(r)))
    throw new Error('Set a non-demo ORG_MEMORY_ORG and comma-separated owner/repo entries in ORG_MEMORY_REPOS.');
  let privateToken: string;
  try { privateToken = JSON.parse(fs.readFileSync('.demo/private-client.json', 'utf8')).token; }
  catch { privateToken = crypto.randomBytes(32).toString('base64url'); }
  keys[privateToken] = { org, repos, role: 'writer' };
  privateClient = { url: endpoint, token: privateToken, org, repos };
}
// Save before upload so a retry preserves identity after an interrupted deployment.
fs.writeFileSync(clientFile, JSON.stringify({ url: endpoint, token: demoToken, repo: 'demo/commerce' }), { mode: 0o600 });
if (privateClient) fs.writeFileSync('.demo/private-client.json', JSON.stringify(privateClient), { mode: 0o600 });
const result = spawnSync('npx', ['wrangler', 'secret', 'bulk'], {
  input: JSON.stringify({ FALKORDB_URL: database, ORG_MEMORY_API_KEYS: JSON.stringify(keys) }),
  stdio: ['pipe', 'inherit', 'inherit'], encoding: 'utf8',
});
if (result.error || result.status !== 0) throw new Error('Secret upload failed. Check Cloudflare login and deploy the Worker first.');
console.log('Hosted secrets configured. Client credentials are in ignored .demo files and were not printed.');
console.log('Run ORG_MEMORY_CLIENT_CONFIG=.demo/hosted-client.json npm run demo:seed');
