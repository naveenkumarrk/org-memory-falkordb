import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { validateSnapshot } from '../worker/schema.ts';
import type { Snapshot } from '../worker/schema.ts';

export const REPOSITORY = 'demo/commerce';
const auth = `file:${REPOSITORY}:src/authentication.ts`;
const checkout = `file:${REPOSITORY}:src/mobile-checkout.ts`;
const source = {
  kind: 'synthetic', source_id: 'synthetic-session:client-investigation', locator: 'synthetic://client-investigation/turn-4',
  excerpt: 'Mobile checkout still sends legacy tokens. Keep compatibility until the mobile migration is complete. The legacy-token-contract check reproduces the failure when legacy parsing is removed.',
  observed_at: '2026-10-18T10:00:00Z',
};
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

export function demoSnapshot(migrated = false): Snapshot {
  const snapshot: any = {
    repository: REPOSITORY,
    nodes: [
      { id: `repo:${REPOSITORY}`, type: 'Repo', props: { slug: REPOSITORY, clones: 1 } },
      { id: auth, type: 'File', props: { slug: REPOSITORY, rel: 'src/authentication.ts', fingerprint: sha(fs.readFileSync(new URL('./commerce/auth.ts', import.meta.url), 'utf8')) } },
      { id: checkout, type: 'File', props: { slug: REPOSITORY, rel: 'src/mobile-checkout.ts', fingerprint: sha(fs.readFileSync(new URL('./commerce/checkout.ts', import.meta.url), 'utf8')) } },
      { id: 'thing:legacy-token', type: 'Thing', props: { name: 'Legacy token format' } },
      { id: 'session:discovery', type: 'Session', props: { project: 'commerce' } },
      { id: 'W-client-investigation', type: 'Work', props: {
        repos: [REPOSITORY], title: 'Investigate mobile checkout compatibility', significance: 5,
        goal: 'Identify why the mobile client fails after token cleanup', what_was_done: 'Reproduced the dependency and recorded a compatibility constraint.',
        status: 'done', things: ['checkout', 'legacy tokens'], started: '2026-10-18T09:00:00Z', ended: '2026-10-18T10:00:00Z',
        person: null, session: 'discovery', project: 'commerce', prompts: [1, 4], verification: { commit: 'none', tests: 'none' },
      } },
      { id: 'F-client-contract', type: 'Fact', props: {
        statement: 'Mobile checkout still sends legacy tokens.', evidence_quote: 'Mobile checkout still sends legacy tokens.',
        status: migrated ? 'superseded' : 'current', work: 'W-client-investigation', at: '2026-10-18T10:00:00Z', check_id: 'legacy-token-contract',
        assertion: { subject: checkout, predicate: 'requires', object: 'thing:legacy-token' },
      }, source },
      { id: 'D-compatibility', type: 'Decision', props: {
        choice: 'Keep compatibility until the mobile migration is complete.', why: 'The mobile client has not migrated.',
        evidence_quote: 'Keep compatibility until the mobile migration is complete.', status: migrated ? 'superseded' : 'active',
        work: 'W-client-investigation', at: '2026-10-18T10:00:00Z', file_status: 'current',
      }, source },
    ],
    edges: [
      { src: `repo:${REPOSITORY}`, rel: 'CONTAINS', dst: auth, w: 1 },
      { src: `repo:${REPOSITORY}`, rel: 'CONTAINS', dst: checkout, w: 1 },
      { src: 'W-client-investigation', rel: 'TOUCHED', dst: auth, w: 1 },
      { src: 'W-client-investigation', rel: 'TOUCHED', dst: checkout, w: 1 },
      { src: 'W-client-investigation', rel: 'IN_SESSION', dst: 'session:discovery', w: 1 },
      { src: 'W-client-investigation', rel: 'LEARNED', dst: 'F-client-contract', w: 1 },
      { src: 'W-client-investigation', rel: 'DECIDED', dst: 'D-compatibility', w: 1 },
      { src: 'F-client-contract', rel: 'ABOUT', dst: checkout, w: 1 },
      { src: 'F-client-contract', rel: 'MENTIONS', dst: 'thing:legacy-token', w: 1 },
      { src: 'D-compatibility', rel: 'ABOUT', dst: checkout, w: 1 },
    ],
  };
  if (migrated) {
    snapshot.nodes.push({ id: 'F-migrated-client', type: 'Fact', props: {
      statement: 'Mobile checkout completed its token migration; the legacy requirement is retired.',
      evidence_quote: 'Mobile checkout completed its token migration; the legacy requirement is retired.',
      status: 'current', work: 'W-client-investigation', at: '2026-10-18T12:00:00Z',
    }, source: { ...source, source_id: 'synthetic-session:migration', locator: 'synthetic://migration/turn-2', observed_at: '2026-10-18T12:00:00Z', excerpt: 'Mobile checkout completed its token migration; the legacy requirement is retired.' } });
    snapshot.edges.push(
      { src: 'W-client-investigation', rel: 'LEARNED', dst: 'F-migrated-client', w: 1 },
      { src: 'F-migrated-client', rel: 'ABOUT', dst: checkout, w: 1 },
      { src: 'F-migrated-client', rel: 'SUPERSEDES', dst: 'F-client-contract', w: 1 },
      { src: 'F-migrated-client', rel: 'SUPERSEDES', dst: 'D-compatibility', w: 1 },
    );
  }
  return validateSnapshot(snapshot);
}
