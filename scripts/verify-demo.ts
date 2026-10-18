// Reproducible synthetic scenario over the running API and a real FalkorDB server.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { api, clientConfig } from './client.ts';
import { demoSnapshot } from '../fixtures/memory.ts';

const repository = 'demo/commerce';
const publish = async (migrated: boolean) => {
  const current = await api(`/v1/graph?repository=${repository}`);
  const snapshot = demoSnapshot(migrated); snapshot.expected_version = current.version;
  return api('/v1/ingest', snapshot);
};
const input = { repository, query: 'Simplify src/authentication.ts', files: ['src/authentication.ts'], exclude_session: 'fresh-agent-session' };
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'orgmem-demo-'));
try {
  await publish(false);
  const graph = await api(`/v1/graph?repository=${repository}`);
  const recall = await api('/v1/recall', input);
  const direct = await api('/v1/recall', { ...input, graph_expansion: false });
  assert.equal(recall.backend, 'FalkorDB');
  assert.equal(recall.items.length, 2); assert.equal(direct.items.length, 0);
  assert.ok(recall.trace.some((q: any) => q.cypher.includes('MATCH p=') && q.rows > 0));
  const stale = await api('/v1/recall', { ...input, fingerprints: { 'src/authentication.ts': '0'.repeat(64) } });
  assert.equal(stale.items.length, 0); assert.equal(stale.warnings.length, 1);
  fs.writeFileSync(path.join(home, 'remote.json'), JSON.stringify(clientConfig()), { mode: 0o600 });
  const event = { hook_event_name: 'UserPromptSubmit', session_id: 'new-synthetic-session', cwd: path.resolve('.demo/workspace/commerce'), prompt: input.query };
  const hook = () => spawnSync(process.execPath, ['--no-warnings', 'src/hook.ts'], {
    input: JSON.stringify(event), encoding: 'utf8', timeout: 10000,
    env: { ...process.env, ORG_MEMORY_HOME: home, ORG_MEMORY_API_URL: '', ORG_MEMORY_API_TOKEN: '', ORG_MEMORY_INTERNAL: '0' },
  });
  const first = hook(); assert.equal(first.status, 0);
  const context = JSON.parse(first.stdout).hookSpecificOutput.additionalContext;
  assert.ok(context.includes('F-client-contract')); assert.equal(hook().stdout, '');
  const agent = spawnSync(process.execPath, ['--no-warnings', 'scripts/demo-agent.ts'], { stdio: 'inherit', timeout: 30000 });
  assert.equal(agent.status, 0);
  const execution = JSON.parse(fs.readFileSync('.demo/agent-report.json', 'utf8'));
  await publish(true);
  const after = await api('/v1/recall', input);
  assert.deepEqual(after.items.map((i: any) => i.id), ['F-migrated-client']);
  const report = {
    measured_at: new Date().toISOString(), scenario: 'synthetic commerce compatibility', backend: recall.backend,
    methodology: 'Live API calls to a Workers runtime backed by FalkorDB; actual Node test subprocesses; actual hook subprocess with a synthetic Claude event.',
    limitations: 'Single synthetic scenario; deterministic bounded policy, no live LLM task or accuracy benchmark. Hook delivery is tested separately from Claude invocation.',
    graph: { nodes: graph.nodes.length, edges: graph.edges.length, version: graph.version },
    graph_enabled: { items: recall.items.map((i: any) => i.id), chars: recall.chars, ms: recall.ms, paths: recall.paths },
    graph_disabled: { items: direct.items.length, ms: direct.ms },
    stale_code: { items: stale.items.length, warnings: stale.warnings },
    hook: { context_chars: context.length, fact_delivered: true, duplicate_suppressed: true },
    execution: { removal_exit: execution.removal_test_exit, compatible_exit: execution.compatible_test_exit, test_output: execution.test_output },
    supersession: { version: after.version, returned_items: after.items.map((i: any) => i.id) },
    executed_queries: recall.trace,
  };
  fs.mkdirSync('docs', { recursive: true });
  fs.writeFileSync('docs/demo-proof.json', JSON.stringify(report, null, 2) + '\n');
  console.log('Verified: live graph traversal, direct-only comparison, stale-code rejection, hook delivery/deduplication, real test outcomes, and supersession.');
  console.log('Public synthetic evidence: docs/demo-proof.json');
} finally {
  fs.rmSync(home, { recursive: true, force: true });
  await publish(false); // Leave the inspector at the starting point for recording or live demonstration.
}
