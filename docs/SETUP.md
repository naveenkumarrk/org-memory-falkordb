# Configuration and deployment

## Keys and accounts

| Workflow | Needed |
| --- | --- |
| Local inspector, fixtures, deterministic demo, tests | No external API keys; setup generates a local bearer token |
| Real session extraction / live coding task | Installed and authenticated Claude Code; the inherited extractor invokes `claude -p` |
| Hosted Worker (optional) | Cloudflare login and a reachable FalkorDB connection URL |

The local demo is the current submission path. The Worker bundle has been checked locally; production connectivity is not claimed.

## Private organization memory

Local setup generates a `demo` identity that accepts synthetic evidence only and is visible through read-only demo endpoints. Configure an additional non-demo identity for actual organization records. Keep those keys and records in ignored files and outside the public repository.

The secret `ORG_MEMORY_API_KEYS` is a JSON map:

```json
{
  "REPLACE_WITH_A_RANDOM_PRIVATE_KEY": {
    "org": "your-team",
    "repos": ["your-org/your-repo"],
    "role": "writer"
  }
}
```

Add this principal alongside the generated demo entry in `.dev.vars`, rather than replacing the demo key if you still want the inspector. The server derives the organization and permitted repositories from the authenticated principal, never from a caller-supplied organization field. This is a prototype key map, not an organization identity-management service.

Use a separate data directory for local capture:

```sh
export ORG_MEMORY_HOME="$HOME/.org-memory-falkordb"
export ORG_MEMORY_WORKSPACE="/absolute/path/to/your/workspace"
export ORG_MEMORY_ORG="your-org"
export ORG_MEMORY_API_URL="http://127.0.0.1:8787"
# Set ORG_MEMORY_API_TOKEN privately in your shell, or write remote.json under ORG_MEMORY_HOME.
```

`remote.json` has `url` and `token` fields. Protect it with mode 0600. Start the CLI/hook process with the same environment. The data directory defaults to `~/.org-memory-falkordb`, separate from the upstream project's directory.

For a known, explicitly selected session, `./bin/orgmem sync --session SESSION_ID` invokes the inherited capture/extraction pipeline and publishes to the configured API. It can read that session transcript and incur Claude usage. `./bin/orgmem publish` publishes already-extracted local records. Do not run broad backfill until you intend to process the selected workspace's history.

Publishing attaches retained, redacted extraction excerpts, rejects unsupported quotes, merges the current shared snapshot, and supplies its expected version. A 409 requires fetching the current version and retrying publication. Legacy records that lack retained excerpts stay unverified and are not recalled. Mixed-repository work is omitted from publication in this prototype to preserve repository scope.

The inherited `./bin/orgmem install on` installs capture/recall hooks globally and backs up Claude settings; use it only when ready to enable capture for your configured workspace. `npm run demo:hooks` instead writes isolated recall-only settings and does not edit global settings or process historical sessions. Legacy `build`, `related`, and `ui` commands still target the SQLite baseline; the new shared API and inspector use FalkorDB.

## Optional Cloudflare deployment

The database remains a separate hosted service. Follow the [FalkorDB guide](https://docs.falkordb.com/getting-started) for the server/client model. Outbound database connectivity must be verified from the deployed Worker; local runtime success alone does not establish that.

```sh
npx wrangler login
npm run deploy
cp .env.example .env.hosted
# Edit .env.hosted privately: real FALKORDB_URL and the deployed ORG_MEMORY_API_URL.
npm run hosted:check
npm run hosted:configure
ORG_MEMORY_CLIENT_CONFIG=.demo/hosted-client.json npm run demo:seed
ORG_MEMORY_CLIENT_CONFIG=.demo/hosted-client.json npm run demo:agent
```

`hosted:configure` checks the database, generates separate demo/private keys when private scope is configured, and uploads secrets through stdin. It stores clients in ignored `.demo/hosted-client.json` and `.demo/private-client.json`. It manages the complete API-key map; preserve any additional manually managed principals before rerunning it. The script does not print credentials or place them in shell arguments.

Confirm the deployed `/health` endpoint and the inspector work before calling the deployment successful. The public demo endpoints expose only the fixed synthetic demo namespace; real organization namespaces require authentication.

## Troubleshooting

- **FalkorDB connection failed:** confirm the database is listening on port 16379; `npm run setup:local` targets that port. Keep the embedded Python process running when Docker is not used.
- **UI graph library unavailable:** run `npm run build:ui` or restart with `npm run dev`. Cytoscape is copied from the installed package with its license.
- **Hook produces no context:** check repository remote identity, explicit file path, matching fingerprint, API scope, excluded repositories, session budget, and whether the same memory was already shown. Hook errors intentionally fail open.
- **Unknown/changed applicability:** revalidate the evidence against the applicable code; do not force it to current merely to make recall return a result.
