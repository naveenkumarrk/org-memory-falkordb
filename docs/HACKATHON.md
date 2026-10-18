# Graph Hacks implementation scope

Event: [Graph Hacks: Context for AI Agents](https://www.wemakedevs.org/hackathons/falkordb), October 15–18, 2026.

Primary track: **Agents That Act on Connected Data**. The primary demonstration must show the agent choosing and taking actions because of graph evidence.

## Delivery priorities

1. Port central graph writes and retrieval from SQLite to FalkorDB. Mirroring data without using FalkorDB for the product's decisions is insufficient for our design.
2. Preserve local capture/extraction and hook interfaces where practical; introduce an explicit shared graph/API boundary.
3. Target Cloudflare Workers for the shared backend. Keep filesystem capture, Git commands, Claude subprocess calls, and local checks in the developer-side adapter.
4. Fix repository filtering and freshness issues documented in `BASELINE.md`.
5. Build one synthetic code-change scenario connecting knowledge to a relevant test and observable implementation change.
6. Add regression tests for graph retrieval, exclusions, stale/unknown evidence, and update behavior.
7. Provide setup, demo video, and measured results. The event prefers deployment and describes complete local setup plus a working demo video as an alternative.

## Fact semantics

A quotation establishes an attributable statement; a Git check establishes commit existence/ancestry; a test establishes a specific observed outcome. Preserve those distinctions in stored metadata and displayed context.

Unknown applicability stays unknown. A newer observation in a different repository, branch, or environment must not automatically supersede another claim. Prefer explicit replacement evidence and preserve history.

## Time and provenance

Submissions close October 18, 2026, at 23:59 IST / 18:29 UTC, according to the event page checked during this assessment. The event allows general libraries/templates/infrastructure to be reused and requires the submission and its main FalkorDB implementation to be new work completed during the event. Describe inherited code and new work separately; this is not a guaranteed eligibility determination.
