import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'orgmem-freshness-'));
process.env.ORG_MEMORY_HOME = path.join(temp, 'data');
process.env.ORG_MEMORY_TEST_ROOT = path.join(temp, 'workspace');
const { RepoIndex } = await import('../src/git.ts');
const { build } = await import('../src/graph.ts');
const { knowledgeForFiles } = await import('../src/query.ts');
const { loadSettings } = await import('../src/settings.ts');
const { DatabaseSync } = await import('node:sqlite');
after(() => fs.rmSync(temp, { recursive: true, force: true }));

test('missing clone and invalid evidence dates remain unknown', () => {
  assert.equal(new RepoIndex('missing/repo', []).fileState('src/file.ts', new Date().toISOString()), 'unknown');
});
test('a file change one hour later is detected without a grace window', () => {
  const repo = path.join(temp, 'repo'); fs.mkdirSync(repo);
  const git = (args: string[], at?: string) => execFileSync('git', ['-C', repo, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', ...args], { env: { ...process.env, ...(at ? { GIT_AUTHOR_DATE: at, GIT_COMMITTER_DATE: at } : {}) } });
  git(['init', '-q', '-b', 'main']);
  const before = new Date(Date.now() - 86400000).toISOString(), later = new Date(Date.now() - 82800000).toISOString();
  fs.writeFileSync(path.join(repo, 'file.ts'), 'before'); git(['add', '.']); git(['commit', '-qm', 'before'], before);
  fs.writeFileSync(path.join(repo, 'file.ts'), 'after'); git(['add', '.']); git(['commit', '-qm', 'after'], later);
  assert.equal(new RepoIndex('demo/repo', [repo]).fileState('file.ts', before), 'changed_since');
});
test('knowledge retrieval honors excluded repositories', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec('CREATE TABLE nodes(id TEXT,type TEXT,props TEXT); CREATE TABLE edges(src TEXT,rel TEXT,dst TEXT);');
    const insert = db.prepare('INSERT INTO nodes VALUES(?,?,?)');
    insert.run('W-test', 'Work', JSON.stringify({ repos: ['demo/repo'], significance: 5, ended: new Date().toISOString(), verification: {} }));
    insert.run('F-test', 'Fact', JSON.stringify({ statement: 'A scoped fact', work: 'W-test', status: 'current', at: new Date().toISOString() }));
    insert.run('file:demo/repo:file.ts', 'File', JSON.stringify({ slug: 'demo/repo', rel: 'file.ts' }));
    db.prepare('INSERT INTO edges VALUES(?,?,?)').run('F-test', 'ABOUT', 'file:demo/repo:file.ts');
    const settings = loadSettings(); settings.repos = { 'demo/repo': { include: false } };
    assert.equal(knowledgeForFiles(db, ['file:demo/repo:file.ts'], { corpus: 'test', settings }).length, 0);
  } finally { db.close(); }
});
test('in-memory snapshot compiler does not create a SQLite graph file', () => {
  const result = build('test', () => {}, { collect: true });
  assert.ok(result.snapshot); assert.equal(fs.existsSync(path.join(temp, 'data', 'test', 'graph.db')), false);
});
