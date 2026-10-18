import fs from 'node:fs';
import { backfill } from './backfill.ts';
import { build, openGraph, graphPath } from './graph.ts';
import { relatedToFiles, relatedToText, resolveTarget, renderCards } from './query.ts';
import type { Corpus } from './config.ts';
import { serve } from './server.ts';
import { install, status, writeHooksFile } from './install.ts';

const argv = process.argv.slice(2);
const cmd = argv[0];
const BOOL = new Set(['test', 'dry-run', 'json', 'all']);
const flags = new Map<string, string | true>();
const pos: string[] = [];
for (let i = 1; i < argv.length; i++) {
  const a = argv[i];
  if (a.startsWith('--')) {
    const k = a.slice(2);
    if (BOOL.has(k)) flags.set(k, true);
    else flags.set(k, argv[++i]);
  } else pos.push(a);
}
const opt = (k: string) => (typeof flags.get(k) === 'string' ? (flags.get(k) as string) : undefined);
const corpus: Corpus = flags.has('test') ? 'test' : 'prod';
const log = (s: string) => process.stderr.write(`${s}\n`);

function requireGraph() {
  if (!fs.existsSync(graphPath(corpus))) { log(`no graph yet at ${graphPath(corpus)}; run: orgmem build${corpus === 'test' ? ' --test' : ''}`); process.exit(2); }
  return openGraph(corpus);
}

async function main() {
  switch (cmd) {
    case 'backfill': {
      const st = await backfill(corpus, { limit: opt('limit') ? Number(opt('limit')) : undefined, session: opt('session'), since: opt('since'), dryRun: flags.has('dry-run'), log });
      console.log(JSON.stringify(st, null, 2));
      break;
    }
    case 'sync': {
      // live capture: re-extract one session (only new chunks cost anything) and rebuild the graph
      const st = await backfill(corpus, { session: opt('session'), log });
      const g = build(corpus, log);
      console.log(JSON.stringify({ extracted: st.extracted, cached: st.cached, works: st.works, costUsd: st.costUsd, graphRecords: g.records }));
      break;
    }
    case 'install': {
      const mode = pos[0] as 'shadow' | 'on' | 'off' | 'uninstall' | undefined;
      if (!mode || !['shadow', 'on', 'off', 'uninstall'].includes(mode)) { console.log(JSON.stringify(status(), null, 2)); break; }
      console.log(JSON.stringify(install(mode), null, 2));
      break;
    }
    case 'hooks-file': {
      console.log(writeHooksFile());
      break;
    }
    case 'ui': {
      serve(Number(opt('port') ?? 7810));
      return;
    }
    case 'build': {
      console.log(JSON.stringify(build(corpus, log), null, 2));
      break;
    }
    case 'related': {
      const db = requireGraph();
      const input = pos.join(' ');
      const limit = flags.has('all') ? 10 : Number(opt('limit') ?? 2);
      const t0 = performance.now();
      const files = resolveTarget(db, input);
      const cards = files.length ? relatedToFiles(db, files, { limit }) : relatedToText(db, input, { limit });
      const ms = performance.now() - t0;
      if (flags.has('json')) console.log(JSON.stringify({ files, ms, cards }, null, 2));
      else console.log(renderCards(cards, files.length ? `Past work on ${files.map((f) => f.split(':').slice(1).join(':')).join(', ')}` : `Past work matching "${input}"`) || '(nothing related)');
      log(`(${files.length ? 'graph' : 'text'} lookup ${ms.toFixed(1)} ms)`);
      break;
    }
    case 'show': {
      const db = requireGraph();
      const nid = pos[0];
      const n = db.prepare('SELECT * FROM nodes WHERE id = ?').get(nid) as any;
      if (!n) { log(`not found: ${nid}`); process.exit(1); }
      console.log(`${n.type} ${n.id}\n${JSON.stringify(JSON.parse(n.props), null, 2)}`);
      const out = db.prepare('SELECT rel, dst, w FROM edges WHERE src = ? ORDER BY rel LIMIT 60').all(nid) as any[];
      const inc = db.prepare('SELECT rel, src, w FROM edges WHERE dst = ? ORDER BY rel LIMIT 30').all(nid) as any[];
      for (const e of out) console.log(`  → ${e.rel} ${e.dst}${e.w !== 1 ? ` (w=${e.w})` : ''}`);
      for (const e of inc) console.log(`  ← ${e.rel} ${e.src}${e.w !== 1 ? ` (w=${e.w})` : ''}`);
      break;
    }
    case 'stats': {
      const db = requireGraph();
      const q = (sql: string) => db.prepare(sql).all();
      console.log(JSON.stringify({
        meta: q('SELECT * FROM meta'),
        nodes: q('SELECT type, count(*) n FROM nodes GROUP BY type ORDER BY n DESC'),
        edges: q('SELECT rel, count(*) n FROM edges GROUP BY rel ORDER BY n DESC'),
        workVerification: q("SELECT json_extract(props,'$.verification.commit') commit_state, count(*) n FROM nodes WHERE type='Work' GROUP BY 1"),
        factStatus: q("SELECT json_extract(props,'$.status') status, count(*) n FROM nodes WHERE type='Fact' GROUP BY 1"),
        repos: q("SELECT r.id, (SELECT count(*) FROM nodes f WHERE f.type='File' AND f.id LIKE 'file:' || substr(r.id, 6) || ':%') files FROM nodes r WHERE r.type='Repo' ORDER BY files DESC"),
      }, null, 2));
      break;
    }
    default:
      console.log(`usage: orgmem <command> [--test]
  backfill [--limit N] [--session ID] [--since ISO] [--dry-run]   extract work records from past sessions
  build                                                          rebuild graph.db from records + git
  sync --session ID                                              live capture for one session (used by the Stop hook)
  related <path | repo/slug:path | text> [--all] [--json]         past work related to a file or text
  show <node-id>                                                  a node and its edges
  stats                                                           graph counts
  ui [--port 7810]                                                local web UI (127.0.0.1 only)
  install [shadow|on|off|uninstall]                               hooks for every Claude Code session (backs up settings)
  hooks-file                                                      write a hooks settings file for: claude --settings <file>`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
