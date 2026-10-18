// Tweakable controls, curation overrides and team config. JSON files under ~/.org-memory, edited from the UI.
// Read on every hook/query call (cheap), so changes take effect immediately without a rebuild.
import fs from 'node:fs';
import path from 'node:path';
import { dataDir, CORPUS } from './config.ts';
import type { Corpus } from './config.ts';

export type Settings = {
  enabled: boolean;
  shadow: boolean;
  triggers: { prompt: boolean; read: boolean; edit: boolean };
  cardsPerTrigger: number;
  delivery: 'knowledge' | 'work';
  itemsPerTrigger: number;
  triggerOnFailure: boolean;
  maxCardsPerSession: number;
  minScore: number;
  minSignificance: number;
  weights: { touched: number; about: number; referenced: number; coChanged: number; sameDir: number };
  show: { decisions: boolean; problems: boolean; facts: boolean };
  repos: Record<string, { include: boolean }>;
  excludedSessions: string[];
  extraction: { model: string; concurrency: number };
};

export type Overrides = { hidden: string[]; pinned: string[]; notes: Record<string, string> };
export type Member = { name: string; email: string; role: 'owner' | 'member' | 'viewer'; addedAt: string };
export type Team = { name: string; repos: string[]; members: string[] };
export type TeamConfig = { org: string; members: Member[]; teams: Team[] };

export const DEFAULT_SETTINGS: Settings = {
  enabled: true,
  shadow: false,
  triggers: { prompt: true, read: true, edit: true },
  cardsPerTrigger: 2,
  delivery: 'knowledge', // v1.3: inject anchored decisions/problems/facts, not work summaries (T7)
  itemsPerTrigger: 4,
  triggerOnFailure: true,
  maxCardsPerSession: 8,
  minScore: 0.2,
  minSignificance: 2, // items the extractor rated 1 (routine) are browsable in the UI but never injected
  weights: { touched: 1.0, about: 0.9, referenced: 0.6, coChanged: 0.6, sameDir: 0 }, // same-folder: 0 useful of 10 judged (T2)
  show: { decisions: true, problems: true, facts: true },
  repos: {},
  excludedSessions: [], // sessions never extracted (test runs, private work)
  extraction: { model: 'haiku', concurrency: 6 },
};

const base = () => dataDir('prod');
const file = (corpus: Corpus, name: string) => path.join(name === 'settings.json' ? base() : dataDir(corpus), name);

function readJson<T>(p: string, fallback: T): T {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; }
}
function writeJson(p: string, v: unknown) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(`${p}.tmp`, JSON.stringify(v, null, 2));
  fs.renameSync(`${p}.tmp`, p);
}

function merge<T extends Record<string, any>>(def: T, v: any): T {
  const out: any = { ...def };
  for (const k of Object.keys(v ?? {})) {
    out[k] = def[k] && typeof def[k] === 'object' && !Array.isArray(def[k]) && k !== 'repos' && !Array.isArray(v[k]) ? merge(def[k], v[k]) : v[k];
  }
  return out;
}

export function loadSettings(): Settings {
  const s = merge(DEFAULT_SETTINGS, readJson(file('prod', 'settings.json'), {}));
  // the OFF / SHADOW marker files still work as an out-of-band kill switch
  if (fs.existsSync(path.join(base(), 'OFF'))) s.enabled = false;
  if (fs.existsSync(path.join(base(), 'SHADOW'))) s.shadow = true;
  return s;
}
export function saveSettings(s: Partial<Settings>): Settings {
  const next = merge(loadSettings(), s);
  writeJson(file('prod', 'settings.json'), next);
  return next;
}

export function repoIncluded(s: Settings, slug: string): boolean {
  return s.repos[slug]?.include !== false;
}

export function loadOverrides(corpus: Corpus): Overrides {
  return { hidden: [], pinned: [], notes: {}, ...readJson(file(corpus, 'overrides.json'), {}) };
}
export function setOverride(corpus: Corpus, id: string, action: 'hide' | 'unhide' | 'pin' | 'unpin', note?: string): Overrides {
  const o = loadOverrides(corpus);
  const drop = (xs: string[]) => xs.filter((x) => x !== id);
  if (action === 'hide') { o.hidden = [...drop(o.hidden), id]; o.pinned = drop(o.pinned); }
  if (action === 'unhide') o.hidden = drop(o.hidden);
  if (action === 'pin') { o.pinned = [...drop(o.pinned), id]; o.hidden = drop(o.hidden); }
  if (action === 'unpin') o.pinned = drop(o.pinned);
  if (note !== undefined) o.notes[id] = note;
  writeJson(file(corpus, 'overrides.json'), o);
  return o;
}

export function loadTeam(corpus: Corpus): TeamConfig {
  return { org: CORPUS[corpus].org ?? (corpus === 'prod' ? 'company' : 'personal'), members: [], teams: [], ...readJson(file(corpus, 'team.json'), {}) };
}
export function saveTeam(corpus: Corpus, t: TeamConfig): TeamConfig {
  writeJson(file(corpus, 'team.json'), t);
  return t;
}

// Human feedback on cards (from the Shadow review page). Used in ranking: the outside signal that the
// extractor's own significance rating cannot provide.
export type Vote = { work: string; vote: 'up' | 'down'; session?: string; target?: string; ts: string };
export type Feedback = { votes: Vote[] };
export function loadFeedback(corpus: Corpus): Feedback {
  return { votes: [], ...readJson(file(corpus, 'feedback.json'), {}) };
}
export function feedbackByWork(corpus: Corpus): Map<string, { up: number; down: number }> {
  const m = new Map<string, { up: number; down: number }>();
  for (const v of loadFeedback(corpus).votes) {
    const c = m.get(v.work) ?? { up: 0, down: 0 };
    c[v.vote]++;
    m.set(v.work, c);
  }
  return m;
}
export function addVote(corpus: Corpus, v: Omit<Vote, 'ts'> & { vote: 'up' | 'down' | 'clear' }): Feedback {
  const f = loadFeedback(corpus);
  // one vote per (work, trigger target, session); 'clear' removes it
  f.votes = f.votes.filter((x) => !(x.work === v.work && x.target === v.target && x.session === v.session));
  if (v.vote !== 'clear') f.votes.push({ work: v.work, vote: v.vote, session: v.session, target: v.target, ts: new Date().toISOString() });
  writeJson(file(corpus, 'feedback.json'), f);
  return f;
}
