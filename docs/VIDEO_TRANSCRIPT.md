# Demo video transcript

Generated narration over a recording of the live local application and actual CLI output. Synthetic scenario and local client profiles; no live LLM task is claimed.

## Org Memory · The next session should know why

Org Memory helps a new coding session use what a teammate already discovered. This demonstration uses synthetic data, a real Falkor database, and actual test execution.

## 1 / Follow the connection to an earlier discovery

The request is to simplify authentication. An earlier investigation found that mobile checkout still needs legacy tokens. Falkor follows the relationship through past work and returns the fact with its source.

## 2 / Inspect the query executed for this request

The inspector exposes the Cypher actually executed during this request, including parameters, returned rows, and timings. The graph supplies the relationship path.

## 3 / Direct-only retrieval misses this connection

With graph expansion disabled, this scenario returns no direct result. Following the connection through the earlier investigation brings back the relevant discovery.

## 4 / Use the memory to choose and execute a check

The bounded demo policy uses the retrieved fact to select a compatibility test. Removing legacy parsing fails. A real simplification that preserves compatibility passes all four tests. These outputs come from local test processes.

## 5 / New evidence retires the old constraint

When new migration evidence is published, the old requirement is explicitly superseded. The next request returns the replacement fact, while retired nodes remain in the graph.

## 6 / Alice records a discovery for her team

Now we switch to authenticated team clients. Alice and Bob have separate keys, workspaces, and hook state. Alice publishes the earlier discovery into their shared team graph.

## 7 / Bob recalls Alice’s discoveries

Bob uses his own credential to make a real request. He retrieves Alice's two memories, including the source and relationship path. They share organization memory rather than a local file.

## 8 / Bob checks and contributes another fact

Bob runs the compatibility tests and records an additional observation about explicitly disabling legacy parsing. His publication preserves the earlier team knowledge.

## 9 / Alice receives Bob’s new discovery

Alice now retrieves three memories through her own key. Bob's new fact is available alongside the original discoveries, with its own source reference.

## 10 / A different organization gets a separate graph

A third client uses the same repository name but belongs to another organization. Its separate graph returns zero memories from the shared team scenario.

## 11 / Verify both hooks, sharing and permissions

The complete verification also runs each client's actual hook process with synthetic events. It checks both directions of delivery, same-session exclusion, and permission failures. This is a local prototype with a deterministic policy, not a recorded live Claude task.

## Shared discoveries. Relevant context. Inspectable evidence.

The repository includes local setup, reproducible verification commands, query traces, and test results. Org Memory carries useful discoveries into the next session, with the evidence attached.
