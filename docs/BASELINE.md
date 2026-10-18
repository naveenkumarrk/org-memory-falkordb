# Inherited baseline and assessment

Source: `naveenkumarrk/org-memory`.

Baseline commit: `893e5d4d` (resolve its complete SHA with `git rev-parse 893e5d4`). Original commits are preserved. This public repository is independent because the source is private; a local `upstream` remote records the relationship.

The inherited implementation is a local Node.js 24 / TypeScript application with SQLite nodes, edges, full-text search, filesystem records, Claude hooks, and a local HTTP UI. FalkorDB and Cloudflare Workers are not implemented at this baseline.

## Assessment on October 18, 2026

- All six inherited utility tests passed with `npm test`.
- An isolated synthetic fixture built a two-record graph and retrieved its decision and fact through file and prompt queries.
- No historical user/company sessions were read, and no model-backed evaluation was run for the assessment.

| Synthetic probe | Observed behavior | Intended behavior |
| --- | --- | --- |
| Excluded repository | Knowledge retrieval returned two items despite `include: false`. | Omit excluded repository knowledge. |
| Missing local clone | An uncheckable fact was marked `current`. | Preserve unknown/unverified freshness. |
| File changed one hour later | Freshness remained `current` under a two-day grace heuristic. | Detect the relevant change or require revalidation. |

These disposable-fixture probes are diagnostic observations, not a general benchmark or production security certification. Formal regression tests should accompany fixes.

The upstream README's accuracy/task-outcome figures describe earlier private evaluation artifacts and have not been reproduced here. This edition must report its own results with public or synthetic fixtures and a stated protocol.
