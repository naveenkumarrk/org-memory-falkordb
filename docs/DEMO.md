# Live demonstration

This is a local application backed by a real FalkorDB engine. The knowledge and codebase are synthetic. Actions are chosen by an explicitly bounded deterministic policy; this is not a recording of Claude making an autonomous change.

## Start and verify

Follow the root README. Keep FalkorDB and `npm run dev` running, then:

```sh
npm run demo:seed
npm run demo:verify
```

Open http://127.0.0.1:8787. The header must say FalkorDB connected and report 8 nodes / 10 edges. A disconnected database produces an error; there is no mock response fallback.

## Two-minute walkthrough

1. **Problem:** a new session is asked to simplify authentication. An earlier session discovered that mobile checkout still needs the legacy token format.
2. Submit `Simplify src/authentication.ts`. Select the Fact card. Point to the source quote and `authentication.ts → past work → fact` path. The knowledge is attached to the mobile client; the request reaches it through past work.
3. Expand **Inspect executed FalkorDB queries**. These are queries executed during this request, including parameters, returned row counts and client-measured query timings. Show `MATCH p=` and the bounded path traversal.
4. Turn off **Follow graph relationships**, retrieve again, and show zero results. This is a direct-only comparison, not a comparison against every vector-search or memory system.
5. Turn graph relationships back on. Run `npm run demo:agent` in a terminal. It retrieves the fact, chooses the allowlisted `legacy-token-contract` check, tests the proposed removal (fails), writes a real compatibility-preserving simplification, and tests it (4 pass). Refresh the inspector to view the reported process outputs.
6. Run `npm run demo:migrate`, refresh the graph and retrieve again. Only `F-migrated-client` is returned; old facts remain visible as retired nodes. The replacement is explicit evidence, not merely a newer timestamp.
7. Run `npm run demo:seed` to restore the starting fixture.

## Suggested narration

“Coding agents often rediscover what a teammate already learned. Org Memory stores facts, decisions, source evidence, and code links in FalkorDB. Here the request mentions authentication, but the relevant fact belongs to a mobile client. The graph connects them through past work. We can inspect the actual Cypher and the source behind the result. With expansion disabled, this scenario has no direct result. The retrieved fact selects a compatibility check: removing legacy parsing fails, while a compatible simplification passes. When migration evidence arrives, the old requirement is superseded and stops appearing in later context. The database calls and tests are real; this example uses synthetic data and a bounded deterministic policy.”

## Artifacts

- `docs/demo-proof.json`: measured graph paths, query text/parameters, hook result, stale-code rejection, actual test output, and supersession.
- `.demo/agent-report.json`: full local execution report.
- `.demo/proposals/compatibility.patch`: patch between the failing removal and passing simplification.
- `.demo/proposals/compatible.ts`: actual passing implementation.
- `docs/assets/inspector.png`: inspector capture from the running application.

The release attached to this repository contains a captioned screen recording when available. A generated recording has no microphone narration; use the script above for a live presentation or voiceover.

To regenerate a recording, optionally install `playwright` without saving it as an application dependency, run `npx playwright install chromium`, and then `node scripts/record-demo.playwright.js` from the project root with the API/database running. The helper seeds and restores the synthetic graph and saves `.demo/org-memory-demo.webm`. It does not record credentials. Playwright is optional and is not needed to run the application.

## Optional live Claude run

With Claude Code installed and signed in:

```sh
npm run setup:local
npm run demo:hooks
```

Use the absolute settings-file path printed by the second command when starting Claude inside `.demo/workspace/commerce`. That workspace includes source files, `npm test`, and compatibility tests. Request a simplification while preserving client behavior. Hook correctness has been checked using a synthetic event through the actual hook process; a successful live Claude run should be reported only after observing it.
