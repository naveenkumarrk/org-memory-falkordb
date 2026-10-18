import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';

test('remote hook delivers scoped context once, respects its budget, and fails open', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'orgmem-hook-'));
  const home = path.join(root, 'data'), workspace = path.join(root, 'workspace');
  fs.mkdirSync(home); fs.mkdirSync(workspace);
  execFileSync('git', ['init', '-q', workspace]);
  execFileSync('git', ['-C', workspace, 'remote', 'add', 'origin', 'https://github.com/demo/commerce.git']);
  fs.mkdirSync(path.join(workspace, 'src')); fs.writeFileSync(path.join(workspace, 'src/authentication.ts'), 'fixture');
  let calls = 0, unavailable = false;
  const server = createServer(async (req, res) => {
    calls++;
    let body = ''; for await (const chunk of req) body += chunk;
    assert.equal(req.headers.authorization, 'Bearer fixture-token');
    const input = JSON.parse(body);
    assert.equal(input.repository, 'demo/commerce');
    assert.equal(input.exclude_session, 'fresh');
    assert.equal(input.limit, 1);
    assert.equal(input.fingerprints['src/authentication.ts'].length, 64);
    if (unavailable) { res.writeHead(503); res.end('{"error":"offline"}'); return; }
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ version: 'fixture', context: 'Memory', items: [{ id: 'F-past', type: 'Fact', text: 'A relevant fact.', source: { locator: 'synthetic://past' }, path: { nodes: ['file', 'work', 'F-past'] } }] }));
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address() as { port: number };
  fs.writeFileSync(path.join(home, 'remote.json'), JSON.stringify({ url: `http://127.0.0.1:${address.port}`, token: 'fixture-token' }));
  fs.writeFileSync(path.join(home, 'settings.json'), JSON.stringify({ maxCardsPerSession: 1 }));
  const run = async () => {
    const child = spawn(process.execPath, ['--no-warnings', path.resolve('src/hook.ts')], { env: { ...process.env, ORG_MEMORY_HOME: home, ORG_MEMORY_API_URL: '', ORG_MEMORY_API_TOKEN: '', ORG_MEMORY_INTERNAL: '0' }, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = ''; child.stdout.on('data', c => { out += c; });
    child.stdin.end(JSON.stringify({ hook_event_name: 'UserPromptSubmit', cwd: workspace, session_id: 'fresh', prompt: 'Simplify src/authentication.ts' }));
    const [code] = await once(child, 'exit'); assert.equal(code, 0); return out;
  };
  try {
    assert.ok(JSON.parse(await run()).hookSpecificOutput.additionalContext.includes('F-past'));
    assert.equal(await run(), ''); assert.equal(calls, 1, 'budget prevents another API request');
    fs.rmSync(path.join(home, 'state'), { recursive: true, force: true });
    unavailable = true; assert.equal(await run(), '');
    fs.writeFileSync(path.join(home, 'settings.json'), JSON.stringify({ repos: { 'demo/commerce': { include: false } } }));
    assert.equal(await run(), ''); assert.equal(calls, 2, 'excluded repository never reaches API');
  } finally { server.close(); await once(server, 'close'); fs.rmSync(root, { recursive: true, force: true }); }
});
