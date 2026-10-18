import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { bashWrittenFiles } from '../src/condense.ts';
import { normalizeRemote } from '../src/repo.ts';
import { redact } from '../src/redact.ts';

const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'orgmem-'));
execFileSync('git', ['init', '-q', repo]);
execFileSync('git', ['-C', repo, 'remote', 'add', 'origin', 'https://github.com/acme/demo.git']);
fs.mkdirSync(path.join(repo, 'src'));
for (const f of ['a.ts', 'b.ts', 'c.ts']) fs.writeFileSync(path.join(repo, 'src', f), 'x');
const rels = (cmd: string) => bashWrittenFiles(cmd, repo, 'prod').map((f) => `${f.slug}:${f.rel}`).sort();

test('reads and /dev/null redirects are not writes', () => {
  assert.deepEqual(rels('grep -n foo src/a.ts 2>/dev/null'), []);
  assert.deepEqual(rels('cat src/a.ts | head -5 > /tmp/out.txt'), []);
});
test('sed -i, redirect target, cp/mv destination, tee, scripts', () => {
  assert.deepEqual(rels("sed -i '' 's/x/y/' src/a.ts"), ['acme/demo:src/a.ts']);
  assert.deepEqual(rels("cat > src/b.ts <<'EOF'"), ['acme/demo:src/b.ts']);
  assert.deepEqual(rels('cp src/a.ts src/c.ts'), ['acme/demo:src/c.ts']);
  assert.deepEqual(rels('echo hi | tee src/b.ts'), ['acme/demo:src/b.ts']);
  assert.deepEqual(rels("python3 - <<'EOF'\nopen('src/a.ts','w').write('y')\nEOF"), ['acme/demo:src/a.ts']);
});
test('out-of-org repos are ignored in prod', () => {
  execFileSync('git', ['-C', repo, 'remote', 'set-url', 'origin', 'git@github.com:someone/else.git']);
  assert.equal(normalizeRemote('git@github.com:acme/web-app.git'), 'acme/web-app');
  assert.equal(normalizeRemote('https://x-token@github.com/acme/Web-API'), 'acme/web-api');
});
test('redaction', () => {
  assert.match(redact('Authorization: Basic dXNlcjpwYXNzd29yZDEyMw=='), /Basic \[REDACTED\]/);
  assert.match(redact('PAYMENTS_API_KEY=sk_live_abcdefghijklmnop'), /PAYMENTS_API_KEY=\[REDACTED\]/);
  assert.match(redact('postgres://user:hunter2@db.example.com/x'), /postgres:\/\/\[REDACTED\]@/);
});

import { stripJsonc, flatten } from '../src/confighistory.ts';
import { errorTokens } from '../src/query.ts';
test('jsonc parsing and flattening', () => {
  const src = '{\n // comment\n "env": { "production": { "vars": { "TOKEN_ID": "600", "URL": "https://x//y" /* note */ }, }, },\n}';
  const m = flatten(JSON.parse(stripJsonc(src)));
  assert.equal(m.get('env.production.vars.TOKEN_ID'), '600');
  assert.equal(m.get('env.production.vars.URL'), 'https://x//y');
});
test('error tokens keep identifiers, drop noise words', () => {
  const t = errorTokens("TypeError: Cannot read properties of undefined (reading 'agentSessionId')");
  assert.ok(t.includes('agentSessionId'));
  assert.ok(!t.map((x) => x.toLowerCase()).includes('undefined'));
});
