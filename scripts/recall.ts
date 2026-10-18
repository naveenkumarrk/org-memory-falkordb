import { api, clientConfig } from './client.ts';
import { profileConfig, profiles } from './profiles.ts';
const args = process.argv.slice(2);
const userIndex = args.indexOf('--user');
let config = clientConfig();
if (userIndex >= 0) {
  const name = args[userIndex + 1];
  if (!profiles.includes(name as any)) throw new Error('Use --user alice, bob, or outsider.');
  config = profileConfig(name); args.splice(userIndex, 2);
}
const identity = await api('/v1/me', undefined, config);
const query = args.join(' ') || 'Simplify src/authentication.ts';
const result = await api('/v1/recall', { repository: 'demo/commerce', query }, config);
console.log(`Client: ${identity.user_id ?? 'default'} | Organization: ${identity.org} | Role: ${identity.role}`);
console.log(`FalkorDB: ${result.items.length} memories, ${result.chars} characters, ${result.trace.length} read queries`);
for (const item of result.items) console.log(`\n[${item.id}] ${item.text}\nEvidence: ${item.source.locator}\nPath: ${item.path.nodes.join(' -> ')}`);
for (const warning of result.warnings) console.log(`Notice: ${warning}`);
