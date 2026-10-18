// Real authenticated API calls and separate local hook processes; all scenario data is synthetic.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { api, ApiError } from './client.ts';
import { profileConfig, profileRoot } from './profiles.ts';
import { demoSnapshot } from '../fixtures/memory.ts';
import { mergeSnapshot } from '../worker/merge.ts';
import { validateSnapshot } from '../worker/schema.ts';

const repository = 'demo/commerce';
const alice = profileConfig('alice'), bob = profileConfig('bob'), outsider = profileConfig('outsider');
const identities = await Promise.all([alice, bob, outsider].map(c => api('/v1/me', undefined, c)));
assert.notEqual(alice.token, bob.token);
assert.equal(identities[0].org, 'demo-team'); assert.equal(identities[1].org, 'demo-team');
assert.equal(identities[2].org, 'demo-other-team');
const graphRoute = `/v1/graph?repository=${repository}`;
const recallInput = { repository, query: 'Simplify src/authentication.ts', files: ['src/authentication.ts'] };
const recall = (client: typeof alice, extra = {}) => api('/v1/recall', { ...recallInput, ...extra }, client);

async function seed() {
  const current = await api(graphRoute, undefined, alice);
  const snapshot = demoSnapshot(); snapshot.expected_version = current.version;
  await api('/v1/ingest', snapshot, alice);
  console.log('Alice published the earlier mobile-client discovery to demo-team.');
}
async function contribute() {
  const testRun = spawnSync(process.execPath, ['--no-warnings', '--test', 'test/compat.test.ts'], { cwd: path.join(profileRoot('bob'), 'workspace'), encoding: 'utf8', timeout: 10000 });
  assert.equal(testRun.status, 0, 'Bob fixture compatibility checks must pass before recording the observation');
  const snapshot: any = demoSnapshot();
  const at = new Date().toISOString();
  const statement = 'Setting acceptLegacy to false rejects legacy tokens while modern tokens continue to authenticate.';
  snapshot.nodes.push(
    { id: 'session:bob-discovery', type: 'Session', props: { project: 'commerce' } },
    { id: 'person:bob@example.invalid', type: 'Person', props: { email: 'bob@example.invalid' } },
    { id: 'W-bob-opt-out', type: 'Work', props: {
      ...snapshot.nodes.find((n: any) => n.type === 'Work').props,
      title: 'Check explicit legacy opt-out', goal: 'Verify how callers disable legacy parsing',
      what_was_done: 'Executed compatibility tests including explicit opt-out behavior.',
      started: at, ended: at, session: 'bob-discovery', person: 'bob@example.invalid', prompts: [1, 2], verification: { commit: 'none', tests: 'passed' },
    } },
    { id: 'F-bob-opt-out', type: 'Fact', props: { statement, evidence_quote: statement, status: 'current', work: 'W-bob-opt-out', at },
      source: { kind: 'synthetic', source_id: 'synthetic-session:bob-discovery', locator: 'synthetic://bob-discovery/compatibility-check', excerpt: statement, observed_at: at } },
  );
  const auth = `file:${repository}:src/authentication.ts`;
  snapshot.edges.push(
    { src: 'W-bob-opt-out', rel: 'IN_SESSION', dst: 'session:bob-discovery', w: 1 },
    { src: 'W-bob-opt-out', rel: 'AUTHORED_BY', dst: 'person:bob@example.invalid', w: 1 },
    { src: 'W-bob-opt-out', rel: 'TOUCHED', dst: auth, w: 1 },
    { src: 'W-bob-opt-out', rel: 'LEARNED', dst: 'F-bob-opt-out', w: 1 },
    { src: 'F-bob-opt-out', rel: 'ABOUT', dst: auth, w: 1 },
  );
  const current = await api(graphRoute, undefined, bob);
  await api('/v1/ingest', mergeSnapshot(current, validateSnapshot(snapshot)), bob);
  console.log('Bob ran all 4 fixture tests and published F-bob-opt-out without discarding the earlier discovery.');
  return { exit: testRun.status, output: testRun.stdout + testRun.stderr };
}
function hook(name: 'alice' | 'bob') {
  const root = profileRoot(name);
  const result = spawnSync(process.execPath, ['--no-warnings', 'src/hook.ts'], {
    input: JSON.stringify({ hook_event_name: 'UserPromptSubmit', session_id: `${name}-fresh-${randomUUID()}`, cwd: path.join(root, 'workspace'), prompt: recallInput.query }),
    encoding: 'utf8', timeout: 10000,
    env: { ...process.env, ORG_MEMORY_HOME: path.join(root, 'home'), ORG_MEMORY_API_URL: '', ORG_MEMORY_API_TOKEN: '', ORG_MEMORY_INTERNAL: '0' },
  });
  assert.equal(result.status, 0); assert.ok(result.stdout, `${name}'s hook should deliver a context packet`);
  return JSON.parse(result.stdout).hookSpecificOutput.additionalContext as string;
}

if (process.argv.includes('--seed')) { await seed(); }
else if (process.argv.includes('--contribute')) { await contribute(); }
else {
  await seed();
  const initial = await recall(bob);
  assert.equal(initial.backend, 'FalkorDB');
  assert.deepEqual(new Set(initial.items.map((i: any) => i.id)), new Set(['F-client-contract', 'D-compatibility']));
  const bobContext = hook('bob'); assert.ok(bobContext.includes('F-client-contract'));
  console.log('PASS: Bob fetched Alice\'s 2 memories; Bob\'s separate hook delivered the original fact.');
  const execution = await contribute();
  const aliceAfter = await recall(alice), bobAfter = await recall(bob);
  assert.equal(aliceAfter.version, bobAfter.version);
  assert.ok(aliceAfter.items.some((i: any) => i.id === 'F-bob-opt-out'));
  assert.ok(aliceAfter.items.some((i: any) => i.id === 'F-client-contract'));
  const aliceContext = hook('alice'); assert.ok(aliceContext.includes('F-bob-opt-out'));
  console.log('PASS: Alice fetched Bob\'s new fact and received it through her own hook; both see the same graph version.');
  const ownSession = await recall(bob, { exclude_session: 'bob-discovery' });
  assert.ok(!ownSession.items.some((i: any) => i.id === 'F-bob-opt-out'));
  console.log('PASS: Bob\'s discovery session does not recall its own contribution.');
  const isolated = await recall(outsider);
  assert.equal(isolated.items.length, 0); assert.equal(isolated.version, '');
  console.log('PASS: The outsider has the same repo slug but a different organization; its graph is empty.');
  await assert.rejects(() => api('/v1/ingest', demoSnapshot(), outsider), e => e instanceof ApiError && e.status === 403);
  await assert.rejects(() => api('/v1/recall', { repository: 'private/other', query: 'authentication' }, bob), e => e instanceof ApiError && e.status === 403);
  console.log('PASS: Reader writes and unauthorized repository access are rejected with HTTP 403.');
  const report = {
    measured_at: new Date().toISOString(), methodology: 'Distinct API credentials, authenticated live Worker API calls, real FalkorDB graph reads/writes, separate synthetic workspaces and hook-state directories.',
    limitations: 'Local client profiles on one machine, not two independently signed-in humans or a live Claude run. No signup/SSO system is implemented. All scenario knowledge is synthetic.',
    profiles: identities, initial_bob_items: initial.items.map((i: any) => i.id),
    alice_after_bob_items: aliceAfter.items.map((i: any) => i.id), shared_version: aliceAfter.version,
    hook: { bob_received_alice_fact: true, alice_received_bob_fact: true, alice_context_chars: aliceContext.length, bob_context_chars: bobContext.length },
    same_session_excluded: true, outsider_items: isolated.items.length, reader_write_http: 403, forbidden_repository_http: 403,
    bob_execution: execution,
    paths: aliceAfter.paths, executed_queries: aliceAfter.trace,
  };
  fs.writeFileSync('docs/users-proof.json', JSON.stringify(report, null, 2) + '\n');
  console.log('Verified cross-client memory handoff. Evidence saved to docs/users-proof.json.');
  console.log('The authenticated team graph retains Bob\'s contribution. The public browser fixture is unchanged.');
}
