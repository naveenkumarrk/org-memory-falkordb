# org-memory

Team work memory for coding agents (Claude Code first). It turns your agent sessions into a graph of **what was done,
why, and what went wrong** — work items, decisions, problems, facts, linked to files, commits and people — and gives
an agent the few relevant pieces when it touches the same code again.

It stores **facts about past work, never rules** (rules belong in `CLAUDE.md` / `AGENTS.md` in git).

## How it works

```
Claude Code sessions (.jsonl) ─► parse + condense ─► extract (Haiku, JSON schema) ─► validate ─► records
                                  (Edit tools and          (one call per chunk,        (verbatim quotes,
                                   Bash-made changes)       cached)                     span-only files)
git ─► commits verified, co-change, file freshness, config value history ─┐
records ─────────────────────────────────────────────────────────────────┴─► graph.db (SQLite nodes/edges + FTS)
graph.db ─► hooks (prompt / file touch / tool failure) ─► a few dated decisions, problems, facts ─► the agent
         ─► CLI + local web UI (overview, work memory, sessions, files, Obsidian-style graph, shadow review, settings)
```

- **Unit of memory**: a *Work* item (one task) with *Decisions* (choice + why), *Problems* (symptom → cause → fix) and
  *Facts*, each with a verbatim evidence quote; linked to *File*, *Commit* (verified in git), *Person*, *Topic*.
- **Graph**: finds "past work related to this file" by walking edges (file → work that touched it → its decisions,
  problems, facts; co-changed files), ~1–3 ms per lookup.
- **Delivery**: knowledge items (not summaries), ≤4 per trigger, labelled *information, not instructions*; on a tool
  failure, only *resolved* past problems with a strict token match. Shadow mode logs what would be injected without
  injecting.
- **Freshness**: facts are only injected while the code they describe is unchanged since they were recorded.

## Setup

Requires Node 24+ (TypeScript runs natively) and Claude Code.

```sh
# ~/.org-memory/settings.json (optional): { "org": "<github-org>", "workspaceRoot": "<folder with company checkouts>" }
./bin/orgmem backfill            # extract work records from past sessions in the workspace
./bin/orgmem build               # build the graph (records + git)
./bin/orgmem ui                  # http://127.0.0.1:7810 (local only)
./bin/orgmem install shadow      # hooks for every session, logging only; `on` to inject, `uninstall` to remove
./bin/orgmem related <file|text> # what past work is tied to a file
```

Data lives in `~/.org-memory` (never in a repo). Extraction uses your Claude Code login via `claude -p`.

## Evaluation (`eval/`)

| Test | What it measures |
|---|---|
| `verify.ts` | evidence quotes found in the original sessions, commits exist in git, files exist |
| `t1-records.ts` | record accuracy, judged against the source excerpt by a different model |
| `t2-replay.ts` | time-split replay: would the cards shown in later sessions have helped? |
| `t7-ab.ts` | memory ON vs OFF on real later tasks, replayed from the commit before the real change; blind diff judging |
| `t8-qa.ts` | ON vs OFF on later questions whose answer was already in memory |

Headline from one engineer's ~70 sessions: records are accurate (97–100% faithful, 99.9% of quotes verbatim);
work-summary delivery did **not** improve task outcomes (Δ −0.07); knowledge-item delivery leans positive (Δ +0.11,
95% CI −0.07..+0.37, not significant) — most later tasks needed information that was never in memory.
