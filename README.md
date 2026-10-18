# org-memory × FalkorDB

Evidence-backed organizational memory for coding agents, being adapted for [Graph Hacks: Context for AI Agents](https://www.wemakedevs.org/hackathons/falkordb).

**Target:** Agents That Act on Connected Data (Track 01).

The goal is to let a fresh coding agent use the team's relevant past discoveries to choose checks, investigate failures, and prepare a better code change. Each retrieved item should have a source, applicable code context, and an explainable graph path.

## Implementation status

This separate hackathon development repository derives from `naveenkumarrk/org-memory` at commit `893e5d4`. Original history is retained. The upstream repository is private.

**The inherited implementation currently uses SQLite. FalkorDB integration and Cloudflare Workers deployment are planned, not implemented yet.** This repository is not yet a completed hackathon submission.

Already available:

- Claude Code session parsing, condensation, and structured extraction.
- Work, decision, problem, and fact records with evidence quotes and file links.
- Git commit checks and file freshness heuristics.
- Graph-based retrieval and context delivery through Claude hooks.
- Local inspection UI, shadow mode, and evaluation scripts.

Hackathon work:

- [ ] Make FalkorDB the primary graph store and execute retrieval traversals in Cypher.
- [ ] Add an authenticated shared API targeting Cloudflare Workers.
- [ ] Enforce repository exclusions consistently in knowledge retrieval.
- [ ] Represent unknown freshness explicitly; replace the two-day freshness grace heuristic.
- [ ] Distinguish evidence grounding, commit checks, and behavioral verification.
- [ ] Return supporting graph paths and source references.
- [ ] Demonstrate graph evidence changing an agent's test selection and code change.
- [ ] Publish reproducible synthetic fixtures, results, setup instructions, and a demo video.

See [hackathon scope](docs/HACKATHON.md) and [baseline/provenance](docs/BASELINE.md).

## Planned architecture

```text
Local Claude Code hooks + capture + Git inspection
                        |
                        v
             Cloudflare Workers API
                        |
                        v
       FalkorDB: connected memory + evidence
                        |
                        v
       Relevant context -> agent -> local checks/change
```

Capture and command execution stay on the developer's machine. The Workers backend will handle authorized shared ingestion and retrieval. FalkorDB runs separately; its connection transport must be verified during implementation. SQLite in the inherited code is the migration baseline.

## Run the inherited local baseline

Requires Node.js 24+. Session extraction and hook integration require Claude Code. Utility tests require neither Claude authentication nor access to past sessions.

```sh
npm test
```

Use a separate data directory alongside the original:

```sh
export ORG_MEMORY_HOME="$HOME/.org-memory-falkordb"
```

The inherited local commands are:

```sh
./bin/orgmem build
./bin/orgmem ui                  # http://127.0.0.1:7810
./bin/orgmem related <file|text>
```

These commands expect records already present under the selected data directory. They currently use SQLite. `backfill` reads local Claude session history and may invoke Claude extraction; `install` edits Claude hook settings. Cloning this repository or running its tests performs neither action.

Keep personal/company session exports, extracted records, databases, credentials, and evaluation outputs outside this public repository. Public demonstration data should be clearly identified as synthetic or drawn from an appropriate public source.

## Demonstration target

1. One agent discovers and checks a client compatibility constraint.
2. A fresh agent receives a change request affecting a related service.
3. FalkorDB traversal surfaces the constraint and supporting evidence.
4. The agent selects and runs the relevant local test, then prepares and verifies a compatible change.
5. New migration evidence changes what a later session retrieves and does.

Compare with the same task without memory and, where feasible, without graph expansion. Report failures, costs, and latency alongside successful cases.

## Reuse and evaluation

Capture, extraction, local graph/UI, hook, and evaluation modules originate from the upstream project. Its [original README](docs/UPSTREAM_README.md) is preserved as historical documentation; its measurements concern the earlier implementation and are not independently reproduced results for this edition.

The hackathon's main FalkorDB implementation must be new event work. Record that work separately from inherited functionality. Creating this repository does not establish eligibility or submission completion.
