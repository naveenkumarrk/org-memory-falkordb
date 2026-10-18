# Submission draft

## Project

**Org Memory × FalkorDB — the next coding session should know why.**

Repository: https://github.com/naveenkumarrk/org-memory-falkordb

Demo video: https://github.com/naveenkumarrk/org-memory-falkordb/releases/download/v0.2.0-demo/org-memory-full-demo.mp4

Release page: https://github.com/naveenkumarrk/org-memory-falkordb/releases/tag/v0.2.0-demo

Delivery: reproducible local application, setup instructions, measured synthetic proof, and demo recording. No production deployment is claimed.

## Short description

Org Memory connects coding sessions to a team's past discoveries. It stores structured facts, decisions, code links, and source evidence in FalkorDB, then retrieves a bounded context packet through the relationships relevant to the current task. Each result explains its source and graph path. Claude hooks can deliver that context before the agent continues work, while explicit supersession and code fingerprints help prevent stale knowledge from being reused.

## What the demonstration proves

A fresh session is asked to simplify authentication. The relevant legacy-token constraint is attached to a mobile client, so the request reaches it through a previous investigation in FalkorDB. The demo policy uses this fact to select an allowlisted compatibility check, executes a proposed removal that fails, writes a compatibility-preserving simplification, and executes all four fixture tests successfully. New migration evidence supersedes the old constraint, changing the next retrieval. The inspector shows actual Cypher queries, parameters, returned rows, provenance, paths, and client-reported test output.

The scenario is synthetic and the action policy is deterministic. We do not claim a live LLM benchmark or measured organization-wide accuracy. Actual hook delivery has been checked through a subprocess using a synthetic Claude event; an end-to-end live Claude task has not been measured.

## Track fit

Track 01: graph traversal supplies a fact that determines test selection and the bounded local code action, with an explainable path and observable execution results.

Track 02: persistent session memory, scoped sharing, updates, supersession, and context delivery are also central. The organizers allow entry in multiple tracks; choose the desired tracks in the submission form.

## Stack and reuse

TypeScript / Node.js 24, Cloudflare Workers runtime, Hono, official FalkorDB Node client, Zod, Cytoscape.js; Docker or FalkorDBLite for the local database.

The private upstream `org-memory` project's history is preserved and its capture, extraction, Git, and hook modules are reused. New event work implements the primary FalkorDB store/traversals, shared API, scoped publisher, source-grounding schema/stamps, snapshot/supersession handling, graph inspector, synthetic executable scenario, and regression tests. The main event implementation is separate from the original repo. See BASELINE.md and the Git history for provenance.

## Before submitting

- Confirm the final GitHub Actions run is green and the repository is public.
- Attach the demo recording URL from the repository release (or upload the recording to the submission form's supported video host).
- Include the README link for complete local setup and `docs/demo-proof.json` for measured evidence.
- Confirm you are registered, select tracks, and submit through the WeMakeDevs panel before its deadline. The repository/release alone does not submit the entry.
- If a form asks about existing work, disclose the inherited modules and identify the new FalkorDB implementation.
