# Open-source components

The application extends the existing org-memory capture/extraction/Git/hook implementation rather than replacing it from scratch. The shared graph service and inspector use these packages:

| Component | Package/version in the tested install | License | Purpose |
| --- | --- | --- | --- |
| [FalkorDB Node client](https://github.com/FalkorDB/falkordb-ts) | falkordb 6.8.0 | MIT | Native database protocol, graph selection, Cypher query/result handling |
| [Hono](https://github.com/honojs/hono) | hono 4.13.13 | MIT | Workers-compatible API routing/middleware |
| [Zod](https://github.com/colinhacks/zod) | zod 4.6.7 | MIT | Strict runtime schemas |
| [Cytoscape.js](https://github.com/cytoscape/cytoscape.js) | cytoscape 3.34.4 | MIT | Interactive graph rendering and path highlighting |
| [Wrangler](https://github.com/cloudflare/workers-sdk) | wrangler 4.151.1 | MIT OR Apache-2.0 | Local Workers runtime, bundling, optional deployment |
| [TypeScript](https://github.com/microsoft/TypeScript) | typescript 7.0.2 | Apache-2.0 | Static checks for Worker/schema modules |

Exact dependency resolution, including transitive components, is in `package-lock.json`; installed packages include their respective license notices. The UI build copies Cytoscape's license alongside its browser bundle.

The server is the [FalkorDB Docker image](https://github.com/FalkorDB/FalkorDB) or the official [FalkorDBLite](https://github.com/FalkorDB/falkordblite) package (0.10.0 for the tested Docker-free setup). Consult those distributions for server licensing. These are actual engines, not alternate graph implementations.

No implementation code was copied from Premise. It was reviewed as a related project while narrowing this project's session-memory workflow.
