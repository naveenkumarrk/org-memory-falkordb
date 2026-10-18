# How to explain and demonstrate the system

## The story

“A new coding session should benefit from what a teammate already discovered. We turn that earlier work into structured memory with source evidence and code links, store the relationships in FalkorDB, and fetch the small part relevant to the new request.”

In the sample, an earlier investigation found that mobile checkout still sends legacy tokens. Another session is asked to simplify authentication. The relevant fact is about the mobile client, so it is reached through the earlier investigation connecting both files.

```text
authentication.ts ← TOUCHED — earlier investigation — LEARNED → client fact
                                                        └─ DECIDED → retain compatibility
client fact — ABOUT → mobile-checkout.ts
```

## What happens on a prompt

1. A local Claude hook receives a prompt or a relevant tool event. It resolves the repository and file paths, and hashes locally available anchor files.
2. It calls the Workers API using the client's private bearer key. The server derives organization/repository permissions from that key.
3. FalkorDB finds matching files and traverses permitted relationships up to three hops. It considers the current published snapshot and eligible knowledge statuses.
4. The service excludes superseded/retracted knowledge, the current session's own work, unsupported legacy records, and supplied anchors with changed fingerprints. It limits results and context size.
5. It returns facts/decisions/problems with source references and graph paths. The hook delivers these as additional context, with duplicate suppression and a session budget. It does not turn memories into a new rules file.
6. The coding agent can use that information while deciding what to inspect, test, or change. The sample policy selects an allowlisted compatibility test, tests a removal that fails, then tests a compatibility-preserving simplification that passes.

File fingerprints check supplied anchors, not every dependency in the organization. A matching quote establishes grounding in a supplied source, not independent truth. The execution report records a different kind of evidence: an observed local test result, reported by the client.

## Where memory comes from

The demo seeds a schema-validated synthetic snapshot to represent an earlier session. It does not secretly process old Claude sessions.

For configured real use, the inherited local capture pipeline parses/redacts session excerpts, extracts structured records through Claude Code, links Git observations, and publishes scoped records to the shared API. That pipeline requires Claude authentication. The current verified demonstration covers real database queries, actual hook processes with synthetic events, and real fixture tests; a live Claude extraction-to-action session has not been measured.

## Browser walkthrough

Open http://127.0.0.1:8787 and follow [DEMO.md](DEMO.md). Point out the graph path, evidence quote, actual executed Cypher, expansion on/off result, and reported failing/passing tests. Run `npm run demo:migrate` and retrieve again to show explicit supersession, then `npm run demo:seed` to restore the start.

## Two clients sharing memory

The local setup includes three profiles with different keys. They are scoped API clients on one machine, not a signup/SSO implementation or proof of two physical machines being connected.

| Profile | Organization | Role | Expected access |
| --- | --- | --- | --- |
| Alice | demo-team | writer | Shared team memory; can publish |
| Bob | demo-team | writer | Same shared graph; can publish |
| Outsider | demo-other-team | reader | Separate empty graph; cannot publish |

Alice and Bob each have a separate fixture workspace, credential file, hook configuration, and hook-state directory under `.demo/users/<name>`. Their graph namespace is derived from **organization + repository**, not user ID, so it is shared by teammates. Different organizations get different graphs even with the same repository slug.

This authenticated team scenario uses a separate namespace from the public inspector's fixed synthetic fixture. The public inspector is intentionally read-only and does not expose the authenticated team graph or any client key.

### Reproduce the complete check

```sh
npm run demo:users:setup
# If setup says new keys are not loaded, restart npm run dev in its terminal.
npm run demo:users
```

Setup preserves existing credentials and generates random keys in ignored files with restricted permissions. The verification command resets only the dedicated synthetic team scenario, seeds Alice's earlier discovery, proves Bob's retrieval and hook delivery, runs Bob's checks and publishes his contribution, proves Alice's retrieval/hook delivery, and checks same-session exclusion, organization separation and HTTP 403 permissions. It leaves Bob's contribution available for inspection. Evidence is saved to [users-proof.json](users-proof.json).

### Present the handoff step by step

Run from the project root, with the API/database running and profiles already configured:

```sh
# Alice records the earlier discovery in the dedicated synthetic team graph.
npm run demo:users -- --seed

# Bob starts with another key and fetches Alice's 2 memories.
npm run demo:recall -- --user bob

# Bob runs the 4 fixture tests and adds his observation about explicit legacy opt-out.
npm run demo:users -- --contribute

# Alice now fetches 3 memories, including F-bob-opt-out.
npm run demo:recall -- --user alice

# Another organization receives 0 memories from its own separate namespace.
npm run demo:recall -- --user outsider
```

Each recall prints the authenticated identity, organization, role, memory count, source locator, and path. It never prints a key. `GET /v1/me` supplies the displayed identity/scope from the server's configured principal.

The full check additionally invokes the actual hook process for each teammate with a fresh synthetic session. This demonstrates context delivery with separate client state, beyond merely making two HTTP requests with one key.

### Try Bob in Claude Code

If Claude Code is installed and authenticated, use the generated settings file:

```sh
cd /ABSOLUTE/PATH/TO/org-memory-falkordb/.demo/users/bob/workspace
claude --settings /ABSOLUTE/PATH/TO/org-memory-falkordb/.demo/users/bob/home/hooks.settings.json
```

Ask: “Simplify src/authentication.ts without breaking existing clients. Use relevant past knowledge and run npm test.” Alice has an equivalent workspace/settings file under `.demo/users/alice`.

These settings are recall-only, do not edit global Claude settings, and do not automatically capture/publish a live session. A successful actual Claude task must be observed before claiming it in a presentation. For real capture/publishing configuration, follow [SETUP.md](SETUP.md).

## Claims to use in the presentation

- Real FalkorDB storage, queries, graph paths, and explicit updates.
- Separate authenticated client keys sharing an organization/repository graph.
- Real context delivery through local hook processes, using synthetic hook events in the automated verification.
- Real local compatibility tests and an actual passing simplification.
- Explicit provenance and a distinction between source grounding and test execution.

Avoid claiming an organization-wide accuracy benchmark, a production identity system, automatic truth verification, or a live LLM run that was not performed.
