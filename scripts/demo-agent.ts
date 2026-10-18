// A deterministic demonstration policy, not an LLM benchmark. Commands are allowlisted here.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { api } from './client.ts';

const memory = await api('/v1/recall', {
  repository: 'demo/commerce', query: 'Simplify authentication.ts', files: ['src/authentication.ts'],
  exclude_session: 'fresh-agent-session', graph_expansion: true,
});
const noGraph = await api('/v1/recall', { repository: 'demo/commerce', files: ['src/authentication.ts'], graph_expansion: false });
const contract = memory.items.find((item: any) => item.check_id === 'legacy-token-contract');
console.log(`Fresh session retrieved ${memory.items.length} items via FalkorDB (${noGraph.items.length} with graph expansion disabled).`);
if (!contract) throw new Error('Seed the pre-migration demo first: npm run demo:seed');
console.log('Evidence path:', contract.path.nodes.join(' -> '));
console.log('Selected allowlisted check: legacy-token-contract');
fs.mkdirSync('.demo/proposals', { recursive: true });
const original = fs.readFileSync('fixtures/commerce/auth.ts', 'utf8');
const removed = original.replace('acceptLegacy &&', 'false &&');
const compatible = original.replace(/  if \(token === 'v2:valid'\) return true;\n  return acceptLegacy && token === 'v1:valid';/, "  return token === 'v2:valid' || (acceptLegacy && token === 'v1:valid');");
if (compatible === original) throw new Error('The fixture changed; update the bounded demo rewrite.');
fs.writeFileSync('.demo/proposals/removal.ts', removed);
fs.writeFileSync('.demo/proposals/compatible.ts', compatible);
const diff = spawnSync('git', ['diff', '--no-index', '--', '.demo/proposals/removal.ts', '.demo/proposals/compatible.ts'], { encoding: 'utf8' });
fs.writeFileSync('.demo/proposals/compatibility.patch', diff.stdout);
const run = (preserve: boolean) => {
  const result = spawnSync(process.execPath, ['--no-warnings', '--test', 'fixtures/commerce/compat.test.ts'], {
    encoding: 'utf8', env: { ...process.env, ORG_MEMORY_DEMO_MODULE: path.resolve(preserve ? '.demo/proposals/compatible.ts' : '.demo/proposals/removal.ts') }, timeout: 10000,
  });
  if (result.error) throw result.error;
  return { exit: result.status, output: result.stdout + result.stderr };
};
const proposedRemoval = run(false);
const compatibleChange = run(true);
if (proposedRemoval.exit === 0 || compatibleChange.exit !== 0) throw new Error('Compatibility demonstration did not produce the expected real test outcomes');
const report = {
  kind: 'deterministic_agent_fixture', observed_at: new Date().toISOString(), memory_version: memory.version,
  facts: memory.items.map((i: any) => i.id), path: contract.path, selected_check: contract.check_id,
  removal_test_exit: proposedRemoval.exit, compatible_test_exit: compatibleChange.exit,
  patch: '.demo/proposals/compatibility.patch',
  action: 'Retain legacy parsing while the unmigrated mobile contract remains active.',
  limitation: 'Synthetic knowledge and an allowlisted deterministic policy. A live Claude coding task has not been measured.',
  test_output: { removal: proposedRemoval.output, compatible: compatibleChange.output },
};
fs.mkdirSync('.demo', { recursive: true });
fs.writeFileSync('.demo/agent-report.json', JSON.stringify(report, null, 2));
console.log('Removal test: FAILED as expected. Compatibility-preserving change: PASSED.');
console.log('Full real test output saved to .demo/agent-report.json');
await api('/v1/outcomes', { repository: 'demo/commerce', kind: 'synthetic_fixture_run',
  check_id: 'legacy-token-contract', memory_version: memory.version,
  removal_exit: proposedRemoval.exit, compatible_exit: compatibleChange.exit,
  output: `${proposedRemoval.output}\nCOMPATIBLE PATCH:\n${compatibleChange.output}`.slice(0, 12000) });
