import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const HOME = os.homedir();
export const PROJECTS_DIR = path.join(HOME, '.claude', 'projects');

// prod = sessions in the company workspace, on the company org's repos; test = sessions in a personal folder, testing only
export type Corpus = 'prod' | 'test';

// Org and folder layout come from env or ~/.org-memory/settings.json ({ "org", "workspaceRoot", "testRoot" }).
const fileCfg: Record<string, string> = (() => {
  try { return JSON.parse(fs.readFileSync(path.join(process.env.ORG_MEMORY_HOME ?? path.join(HOME, '.org-memory'), 'settings.json'), 'utf8')); } catch { return {}; }
})();
const workspaceRoot = process.env.ORG_MEMORY_WORKSPACE ?? fileCfg.workspaceRoot ?? path.join(HOME, 'Desktop', 'workspace');
const testRoot = process.env.ORG_MEMORY_TEST_ROOT ?? fileCfg.testRoot ?? path.join(HOME, 'Desktop', 'not_workspace');
const slugOf = (dir: string) => dir.replace(/[^a-zA-Z0-9]/g, '-');


export const CORPUS: Record<Corpus, { projectPrefix: string; repoRoot: string; org: string | null }> = {
  prod: {
    projectPrefix: slugOf(workspaceRoot),
    repoRoot: workspaceRoot,
    org: process.env.ORG_MEMORY_ORG ?? fileCfg.org ?? null,
  },
  test: {
    projectPrefix: slugOf(testRoot),
    repoRoot: testRoot,
    org: null,
  },
};

export function dataDir(corpus: Corpus): string {
  const base = process.env.ORG_MEMORY_HOME ?? path.join(HOME, '.org-memory');
  return corpus === 'prod' ? base : path.join(base, 'test');
}

export function inScope(corpus: Corpus, slug: string | null): boolean {
  if (!slug) return false;
  const org = CORPUS[corpus].org;
  return org === null || slug.startsWith(`${org}/`);
}

export const EXTRACT = {
  model: process.env.ORG_MEMORY_MODEL ?? 'haiku',
  promptVersion: 'v1.2',
  chunkChars: 20_000,
  concurrency: Number(process.env.ORG_MEMORY_CONCURRENCY ?? 6),
  timeoutMs: 240_000,
};

export const RETRIEVE = {
  cardsPerTrigger: 2,
  linesPerCard: 5,
};
