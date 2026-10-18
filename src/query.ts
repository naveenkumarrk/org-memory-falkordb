// Retrieval: "what past work is related to this file / this text?" answered by walking the graph.
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { resolveFile } from './repo.ts';
import { loadSettings, loadOverrides, repoIncluded, feedbackByWork } from './settings.ts';
import type { Settings } from './settings.ts';
import type { Corpus } from './config.ts';

export type QueryOpts = { limit?: number; excludeSession?: string; corpus?: Corpus; settings?: Settings };

export type Card = {
  work: string; score: number; via: string; title: string; when: string; ended: string; person: string | null; significance: number; later?: string;
  verification: { commit: string; tests: string }; status: string; what: string;
  decision?: string; problem?: string; facts: string[]; commit?: string;
};

type Row = Record<string, any>;
const props = (r: Row | undefined) => (r ? JSON.parse(r.props) : {});

// Graph weights (how strongly a path through the graph ties a work item to the target file) come from settings.

export function resolveTarget(db: DatabaseSync, input: string): string[] {
  if (input.startsWith('file:')) return [input];
  if (path.isAbsolute(input)) {
    const f = resolveFile(input);
    if (f) return [`file:${f.slug}:${f.rel}`];
  }
  const m = input.match(/^([\w.-]+\/[\w.-]+):(.+)$/);
  if (m) return [`file:${m[1].toLowerCase()}:${m[2]}`];
  if (input.includes('/') || /\.\w{1,6}$/.test(input)) {
    const rows = db.prepare("SELECT id FROM nodes WHERE type = 'File' AND (id LIKE ? OR id LIKE ?) LIMIT 5")
      .all(`%:${input}`, `%/${input}`) as Row[];
    return rows.map((r) => r.id);
  }
  return [];
}

function recency(iso: string): number {
  const days = (Date.now() - Date.parse(iso)) / 86_400_000;
  return Number.isFinite(days) ? 0.7 + 0.3 * Math.exp(-days / 60) : 0.7;
}

const VERIF = (v: { commit: string }) => (v.commit === 'landed' ? 1 : v.commit === 'committed' ? 0.9 : 0.8);

export function relatedToFiles(db: DatabaseSync, fileIds: string[], opts: QueryOpts = {}): Card[] {
  const W = (opts.settings ?? loadSettings()).weights;
  const scores = new Map<string, { s: number; via: string }>();
  const bump = (work: string, s: number, via: string) => {
    const cur = scores.get(work);
    if (!cur || s > cur.s) scores.set(work, { s, via });
  };
  const q = {
    direct: db.prepare("SELECT src, rel, w FROM edges WHERE dst = ? AND rel IN ('TOUCHED','REFERENCED')"),
    about: db.prepare("SELECT p.src AS work FROM edges a JOIN edges p ON p.dst = a.src AND p.rel IN ('DECIDED','HIT','LEARNED') WHERE a.dst = ? AND a.rel = 'ABOUT'"),
    co: db.prepare("SELECT dst, w FROM edges WHERE src = ? AND rel = 'CO_CHANGED' ORDER BY w DESC LIMIT 10"),
    siblings: db.prepare("SELECT c.dst AS id FROM edges p JOIN edges c ON c.src = p.src AND c.rel = 'CONTAINS' WHERE p.dst = ? AND p.rel = 'CONTAINS' AND c.dst <> ? AND c.dst LIKE 'file:%' LIMIT 200"),
  };
  for (const f of fileIds) {
    for (const r of q.direct.all(f) as Row[]) bump(r.src, (r.rel === 'TOUCHED' ? W.touched : W.referenced) * Math.min(1, r.w), r.rel === 'TOUCHED' ? 'changed this file' : 'used this file');
    for (const r of q.about.all(f) as Row[]) bump(r.work, W.about, 'recorded knowledge about this file');
    for (const c of q.co.all(f) as Row[]) {
      const strength = Math.min(1, c.w / 5);
      for (const r of q.direct.all(c.dst) as Row[]) bump(r.src, W.coChanged * strength, `changed ${c.dst.split(':').pop()} (usually changes with this file)`);
    }
    if (W.sameDir > 0) for (const s of q.siblings.all(f, f) as Row[]) for (const r of q.direct.all(s.id) as Row[]) if (r.rel === 'TOUCHED') bump(r.src, W.sameDir, `changed ${s.id.split(':').pop()} (same folder)`);
  }
  const cards = toCards(db, scores, fileIds, opts);
  return withLaterChange(db, cards, fileIds, opts);
}

// Supersession, light: if newer work changed the same files as a card but is not itself shown, point the card at it,
// so an old summary is never the agent's last word on code that has moved on. Files are the trigger's files when
// there are some (file trigger), otherwise the card's own changed files (prompt trigger).
function withLaterChange(db: DatabaseSync, cards: Card[], fileIds: string[], opts: QueryOpts): Card[] {
  if (!cards.length) return cards;
  const ov = loadOverrides(opts.corpus ?? 'prod');
  const filesOf = db.prepare("SELECT dst FROM edges WHERE src = ? AND rel = 'TOUCHED' LIMIT 25");
  for (const c of cards) {
    const files = fileIds.length ? fileIds : (filesOf.all(c.work) as Row[]).map((r) => r.dst);
    if (!files.length) continue;
    const marks = files.map(() => '?').join(',');
    const newest = (db.prepare(`SELECT n.id, n.props FROM edges e JOIN nodes n ON n.id = e.src WHERE e.rel = 'TOUCHED' AND e.dst IN (${marks})
      ORDER BY json_extract(n.props,'$.ended') DESC LIMIT 10`).all(...files) as Row[])
      .map((r) => ({ id: r.id, ...JSON.parse(r.props) }))
      .find((w) => w.id !== c.work && w.session !== opts.excludeSession && !ov.hidden.includes(w.id));
    if (newest && newest.ended > c.ended && !cards.some((x) => x.work === newest.id)) c.later = `${String(newest.ended).slice(0, 10)} · ${newest.title} [${newest.id}]`;
  }
  return cards;
}

const STOP = new Set('the and for with that this from what how why when where into does have make made add use using need want should could would about there their them then than also just like into onto over some more most very your you our are was were has had can its'.split(' '));

export function relatedToText(db: DatabaseSync, text: string, opts: QueryOpts = {}): Card[] {
  const words = [...new Set((text.toLowerCase().match(/[a-z0-9_][a-z0-9_-]{2,}/g) ?? []).filter((w) => !STOP.has(w)))].slice(0, 24);
  if (!words.length) return [];
  const match = words.map((w) => `"${w.replace(/"/g, '')}"`).join(' OR ');
  const rows = (db.prepare('SELECT id, type, text, -bm25(fts) AS s FROM fts WHERE fts MATCH ? ORDER BY s DESC LIMIT 40').all(match) as Row[])
    .filter((r) => { const t = String(r.text).toLowerCase(); return words.filter((w) => t.includes(w)).length >= Math.min(2, words.length); });
  if (!rows.length) return [];
  const best = rows[0].s as number;
  const parent = db.prepare("SELECT src FROM edges WHERE dst = ? AND rel IN ('DECIDED','HIT','LEARNED') LIMIT 1");
  const scores = new Map<string, { s: number; via: string }>();
  for (const r of rows) {
    if (r.s < 0.7 * best) break; // relative cut-off: keep only near-best matches
    const work = r.type === 'Work' ? r.id : (parent.get(r.id) as Row | undefined)?.src;
    if (!work) continue;
    const s = 0.8 * (r.s / best);
    if (!scores.has(work) || scores.get(work)!.s < s) scores.set(work, { s, via: `matches "${words.slice(0, 3).join(' ')}…"` });
  }
  return toCards(db, scores, [], opts);
}

function toCards(db: DatabaseSync, scores: Map<string, { s: number; via: string }>, fileIds: string[], opts: QueryOpts): Card[] {
  const settings = opts.settings ?? loadSettings();
  const ov = loadOverrides(opts.corpus ?? 'prod');
  const fb = feedbackByWork(opts.corpus ?? 'prod');
  const getNode = db.prepare('SELECT props FROM nodes WHERE id = ?');
  const children = db.prepare('SELECT e.rel, n.id, n.props FROM edges e JOIN nodes n ON n.id = e.dst WHERE e.src = ? AND e.rel IN (\'DECIDED\',\'HIT\',\'LEARNED\',\'PRODUCED\')');
  const aboutFile = db.prepare("SELECT 1 FROM edges WHERE src = ? AND rel = 'ABOUT' AND dst = ?");
  const cards: Card[] = [];
  for (const [work, { s, via }] of scores) {
    const p = props(getNode.get(work) as Row);
    if (!p.title) continue;
    if (opts.excludeSession && p.session === opts.excludeSession) continue;
    if (ov.hidden.includes(work)) continue;
    if (Array.isArray(p.repos) && p.repos.length && p.repos.every((r: string) => !repoIncluded(settings, r))) continue;
    const sig = Number(p.significance ?? 3);
    if (sig < settings.minSignificance) continue;
    // human feedback: two thumbs-down and none up removes a card; votes otherwise nudge ranking
    const votes = fb.get(work) ?? { up: 0, down: 0 };
    if (votes.down >= 2 && votes.up === 0) continue;
    const voteFactor = Math.max(0.3, 1 + 0.15 * votes.up - 0.3 * votes.down);
    const kids = children.all(work) as Row[];
    const pick = (rel: string) => kids.filter((k) => k.rel === rel).map((k) => ({ id: k.id, ...props(k) }));
    const onFile = (k: { id: string }) => fileIds.some((f) => aboutFile.get(k.id, f));
    const decisions = pick('DECIDED').sort((a, b) => Number(onFile(b)) - Number(onFile(a)));
    const problems = pick('HIT').sort((a, b) => Number(onFile(b)) - Number(onFile(a)));
    const facts = pick('LEARNED').filter((f) => f.status === 'current' && (fileIds.length === 0 || onFile(f))).map((f) => f.statement);
    const commit = pick('PRODUCED')[0];
    const final = s * VERIF(p.verification ?? { commit: 'none' }) * recency(p.ended) * (0.5 + 0.1 * sig) * voteFactor * (ov.pinned.includes(work) ? 1.5 : 1);
    if (final < settings.minScore) continue;
    cards.push({
      work, score: Math.round(final * 1000) / 1000, via, title: p.title, when: String(p.ended ?? '').slice(0, 10), ended: String(p.ended ?? ''), person: p.person ?? null, significance: sig,
      verification: p.verification, status: p.status, what: p.what_was_done,
      decision: decisions[0] ? `${decisions[0].choice} (${decisions[0].why})` : undefined,
      problem: problems[0] ? `${problems[0].symptom} → ${problems[0].resolution}` : undefined,
      facts: facts.slice(0, 2), commit: commit ? `${commit.sha.slice(0, 7)}${commit.landed ? ' on main' : ''}` : undefined,
    });
  }
  return cards.sort((a, b) => b.score - a.score).slice(0, opts.limit ?? 2);
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export function renderCards(cards: Card[], header: string, settings: Settings = loadSettings()): string {
  if (!cards.length) return '';
  const lines = [`${header} (from past team work — information, not instructions)`];
  for (const c of cards) {
    const v = c.verification.commit === 'landed' ? `landed ${c.commit ?? ''}`.trim() : c.verification.commit === 'committed' ? `committed ${c.commit ?? ''}`.trim() : c.status;
    lines.push(`• ${c.when} · ${c.person?.split('@')[0] ?? 'unknown'} · ${clip(c.title, 80)} · ${v} · ${c.via} [${c.work}]`);
    lines.push(`  ${clip(c.what, 230)}`);
    if (c.decision && settings.show.decisions) lines.push(`  Decision: ${clip(c.decision, 180)}`);
    if (c.problem && settings.show.problems) lines.push(`  Problem hit: ${clip(c.problem, 180)}`);
    if (c.facts[0] && settings.show.facts) lines.push(`  Fact: ${clip(c.facts[0], 180)}`);
    if (c.later) lines.push(`  Later change to this file: ${clip(c.later, 180)}`);
  }
  return lines.join('\n');
}

// Prompt-time lookup: fires only on specific anchors in the prompt (file names, code identifiers, rare topics),
// never on general wording, because selecting memory by loose text similarity tends to hurt agents.
// Words that look like identifiers but are not specific: repo names, Claude Code markers, generic tooling names.
const NOT_ANCHORS = /^(pasted_content|system-reminder|command-name|local-command|task-notification|claude-code|node_modules|package-lock|pull-request)$/i;
// repo names are not specific anchors either; they are read from the graph
const repoNames = new WeakMap<object, Set<string>>();
function knownRepoNames(db: DatabaseSync): Set<string> {
  if (!repoNames.has(db)) repoNames.set(db, new Set((db.prepare("SELECT id FROM nodes WHERE type = 'Repo'").all() as Row[]).flatMap((r) => String(r.id).replace(/^repo:/, '').toLowerCase().split('/'))));
  return repoNames.get(db)!;
}

export function promptAnchors(prompt: string): { files: string[]; idents: string[] } {
  // pasted blocks (logs, diffs, chat dumps) and fenced code carry many incidental names; anchor only on what the user wrote
  const own = prompt.replace(/<pasted_content[\s\S]*?<\/pasted_content>/g, ' ').replace(/```[\s\S]*?```/g, ' ').slice(0, 2000);
  const files = new Set<string>();
  const idents = new Set<string>();
  for (const m of own.matchAll(/`([^`\s]{3,80})`/g)) idents.add(m[1].trim());
  for (const m of own.matchAll(/(?:^|[\s(])((?:[\w.-]+\/)*[\w.-]+\.(?:[jt]sx?|mjs|cjs|py|go|rs|java|rb|json|ya?ml|toml|sql|md|css|scss|html|svelte|vue|sh))\b/g)) files.add(m[1]);
  for (const m of own.matchAll(/\b([a-z]+[A-Z][A-Za-z0-9]*|[A-Za-z]+_[A-Za-z0-9_]+)\b/g)) if (m[1].length >= 6) idents.add(m[1]);
  const keep = (t: string) => !NOT_ANCHORS.test(t) && ![...files].some((f) => f.includes(t));
  // a prompt naming many files is usually a paste (git status, stack trace): too ambiguous to anchor on
  return { files: files.size > 3 ? [] : [...files], idents: [...idents].filter(keep).slice(0, 4) };
}

export function relatedToPrompt(db: DatabaseSync, prompt: string, opts: QueryOpts = {}): { cards: Card[]; anchors: string[] } {
  const { files, idents: raw } = promptAnchors(prompt);
  const idents = raw.filter((t) => !knownRepoNames(db).has(t.toLowerCase()));
  const fileIds = new Set<string>();
  const byName = db.prepare("SELECT id FROM nodes WHERE type = 'File' AND (lower(id) LIKE ? OR lower(id) LIKE ? OR lower(id) LIKE ?) LIMIT 5");
  for (const tok of [...files, ...idents]) {
    const t = tok.toLowerCase().replace(/^\.?\//, '');
    // a name with an extension matches exactly; a bare identifier may match any extension (my-module -> .js)
    const loose = /\.\w{1,8}$/.test(t) ? `%/${t}` : `%/${t}.%`;
    for (const r of byName.all(`%/${t}`, `%:${t}`, loose) as Row[]) fileIds.add(r.id);
  }
  if (fileIds.size) return { cards: relatedToFiles(db, [...fileIds], opts), anchors: [...fileIds] };
  const specific = idents.filter((t) => /[A-Z_]/.test(t) || t.includes('-'));
  if (specific.length) {
    const match = specific.map((t) => `"${t.replace(/"/g, '')}"`).join(' OR ');
    let rows: Row[] = [];
    try { rows = db.prepare('SELECT id, type, -bm25(fts) AS s FROM fts WHERE fts MATCH ? ORDER BY s DESC LIMIT 10').all(match) as Row[]; } catch { rows = []; }
    const parent = db.prepare("SELECT src FROM edges WHERE dst = ? AND rel IN ('DECIDED','HIT','LEARNED') LIMIT 1");
    const scores = new Map<string, { s: number; via: string }>();
    const best = rows[0]?.s as number | undefined;
    for (const r of rows) {
      if (!best || r.s < 0.7 * best) break;
      const work = r.type === 'Work' ? r.id : (parent.get(r.id) as Row | undefined)?.src;
      if (work && !scores.has(work)) scores.set(work, { s: 0.8 * (r.s / best), via: `mentions ${specific.slice(0, 2).join(', ')}` });
    }
    if (scores.size) return { cards: withLaterChange(db, toCards(db, scores, [], opts), [], opts), anchors: specific };
  }
  return { cards: [], anchors: [] };
}

// ── Knowledge delivery (v1.3) ─────────────────────────────────────────────────
// T7 showed whole work summaries do not improve outcomes. Delivery now injects only specific, anchored knowledge:
// decisions, problems (gotchas), facts whose code is unchanged, and config value history, a few lines each.
export type Item = { id: string; type: string; text: string; when: string; work?: string; score: number; via: string };

const TYPE_WEIGHT: Record<string, number> = { config_history: 1, Decision: 0.9, Problem: 0.85, Fact: 0.8 };

function itemText(type: string, p: Row): string {
  if (type === 'Decision') return `${p.choice}${p.why ? ` — why: ${p.why}` : ''}`;
  if (type === 'Problem') return `${p.symptom}${p.resolution ? ` → ${p.resolution}` : ''}`;
  return p.statement ?? '';
}

function scoreItems(db: DatabaseSync, rows: Row[], opts: QueryOpts, via: (r: Row) => string): Item[] {
  const settings = opts.settings ?? loadSettings();
  const ov = loadOverrides(opts.corpus ?? 'prod');
  const fb = feedbackByWork(opts.corpus ?? 'prod');
  const getWork = db.prepare('SELECT props FROM nodes WHERE id = ?');
  const out: Item[] = [];
  const perWork = new Map<string, number>();
  for (const r of rows) {
    const p = JSON.parse(r.props);
    const kind = p.kind === 'config_history' ? 'config_history' : r.type;
    if (r.type === 'Fact' && kind !== 'config_history' && p.status !== 'current') continue; // never inject knowledge about code that has changed
    const w = p.work ? JSON.parse((getWork.get(p.work) as Row | undefined)?.props ?? '{}') : {};
    if (opts.excludeSession && w.session === opts.excludeSession) continue;
    if (ov.hidden.includes(r.id) || (p.work && ov.hidden.includes(p.work))) continue;
    const votes = fb.get(r.id) ?? fb.get(p.work) ?? { up: 0, down: 0 };
    if (votes.down >= 2 && votes.up === 0) continue;
    const sig = Number(w.significance ?? 3);
    if (sig < settings.minSignificance) continue;
    const score = (TYPE_WEIGHT[kind] ?? 0.7) * recency(p.at ?? w.ended ?? '') * (0.5 + 0.1 * sig) * Math.max(0.3, 1 + 0.15 * votes.up - 0.3 * votes.down)
      * (w.verification?.commit === 'landed' ? 1 : 0.92);
    if (score < settings.minScore) continue;
    out.push({ id: r.id, type: kind === 'config_history' ? 'Config history' : r.type, text: itemText(r.type, p), when: String(p.at ?? w.ended ?? '').slice(0, 10), work: p.work, score: Math.round(score * 1000) / 1000, via: via(r) });
  }
  // at most two items from the same piece of work, best first
  return out.sort((a, b) => b.score - a.score).filter((i) => { const k = i.work ?? i.id; const n = perWork.get(k) ?? 0; perWork.set(k, n + 1); return n < 2; });
}

export function knowledgeForFiles(db: DatabaseSync, fileIds: string[], opts: QueryOpts = {}): Item[] {
  if (!fileIds.length) return [];
  const marks = fileIds.map(() => '?').join(',');
  const rows = db.prepare(`SELECT DISTINCT k.id, k.type, k.props FROM edges a JOIN nodes k ON k.id = a.src WHERE a.rel = 'ABOUT' AND a.dst IN (${marks})`).all(...fileIds) as Row[];
  return scoreItems(db, rows, opts, () => 'about this file').slice(0, opts.limit ?? 4);
}

export function knowledgeForPrompt(db: DatabaseSync, prompt: string, opts: QueryOpts = {}): { items: Item[]; anchors: string[] } {
  const { files, idents: raw } = promptAnchors(prompt);
  const idents = raw.filter((t) => !knownRepoNames(db).has(t.toLowerCase()));
  const fileIds = new Set<string>();
  const byName = db.prepare("SELECT id FROM nodes WHERE type = 'File' AND (lower(id) LIKE ? OR lower(id) LIKE ? OR lower(id) LIKE ?) LIMIT 5");
  for (const tok of [...files, ...idents]) {
    const t = tok.toLowerCase().replace(/^\.?\//, '');
    const loose = /\.\w{1,8}$/.test(t) ? `%/${t}` : `%/${t}.%`;
    for (const r of byName.all(`%/${t}`, `%:${t}`, loose) as Row[]) fileIds.add(r.id);
  }
  if (fileIds.size) return { items: knowledgeForFiles(db, [...fileIds], opts), anchors: [...fileIds] };
  const specific = idents.filter((t) => /[A-Z_]/.test(t) || t.includes('-'));
  if (!specific.length) return { items: [], anchors: [] };
  let rows: Row[] = [];
  try {
    rows = db.prepare("SELECT n.id, n.type, n.props, -bm25(fts) AS s FROM fts JOIN nodes n ON n.id = fts.id WHERE fts MATCH ? AND fts.type IN ('Decision','Problem','Fact') ORDER BY s DESC LIMIT 12")
      .all(specific.map((t) => `"${t.replace(/"/g, '')}"`).join(' OR ')) as Row[];
  } catch { rows = []; }
  const best = rows[0]?.s as number | undefined;
  rows = rows.filter((r) => best && r.s >= 0.7 * best);
  return { items: scoreItems(db, rows, opts, () => `mentions ${specific.slice(0, 2).join(', ')}`).slice(0, opts.limit ?? 3), anchors: specific };
}

// Failure trigger: a command or tool failed; find problems the team already solved with a similar error.
const ERR_STOP = new Set('error errors failed failure exception cannot could should would there their which while with from that this have been none null undefined true false line column file files npm pnpm node test tests expected received request requests response status code http https api cloudflare github worker workers'.split(' '));
// specific = looks like an identifier, key, path or code (not an English word)
const specificTok = (t: string) => !/^[A-Z]{2,7}$/.test(t) && (/[a-z][A-Z]|_|\.|\d/.test(t) || t.length >= 12);
const wordIn = (t: string, hay: string) => new RegExp(`(^|[^a-z0-9])${t.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^a-z0-9])`).test(hay);
export function errorTokens(text: string): string[] {
  const line = text.split('\n').map((l) => l.trim()).find((l) => /error|fail|exception|cannot|not found|denied|refused|invalid|missing/i.test(l)) ?? text.split('\n')[0] ?? '';
  const toks = (line.match(/[A-Za-z_][A-Za-z0-9_.-]{3,}|\b\d{3,5}\b/g) ?? []).map((t) => t.replace(/[.-]+$/, '')).filter((t) => !ERR_STOP.has(t.toLowerCase()));
  return [...new Set(toks)].slice(0, 10);
}
export function problemsForError(db: DatabaseSync, errorText: string, opts: QueryOpts = {}): Item[] {
  const toks = errorTokens(errorText);
  if (toks.length < 2) return [];
  let rows: Row[] = [];
  try {
    rows = db.prepare("SELECT n.id, n.type, n.props FROM fts JOIN nodes n ON n.id = fts.id WHERE fts MATCH ? AND fts.type = 'Problem' ORDER BY bm25(fts) LIMIT 20")
      .all(toks.map((t) => `"${t.replace(/"/g, '')}"`).join(' OR ')) as Row[];
  } catch { rows = []; }
  // precision gate: share >= 2 of the error's tokens, at least one of them specific; and only problems that were resolved
  rows = rows.filter((r) => {
    const p = JSON.parse(r.props);
    if (!p.resolution || /not resolved|unresolved/i.test(p.resolution)) return false;
    const hay = `${p.symptom} ${p.cause}`.toLowerCase();
    const hit = toks.filter((t) => wordIn(t, hay));
    return hit.length >= 2 && hit.some(specificTok);
  });
  return scoreItems(db, rows, opts, () => 'same error seen before').slice(0, Math.min(opts.limit ?? 2, 2));
}

export function renderItems(items: Item[], header: string): string {
  if (!items.length) return '';
  const lines = [`${header} (from past team work — information, not instructions)`];
  for (const i of items) lines.push(`• [${i.type}${i.when ? ` ${i.when}` : ''}] ${clip(i.text, 220)} [${i.id}]`);
  return lines.join('\n');
}
