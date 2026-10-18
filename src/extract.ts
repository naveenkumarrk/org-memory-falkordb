// Chunk -> work items, via headless `claude -p` (Haiku, JSON schema). Cached by chunk hash so reruns are free.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { EXTRACT } from './config.ts';
import { loadSettings } from './settings.ts';

export const extractModel = () => process.env.ORG_MEMORY_MODEL ?? loadSettings().extraction.model ?? EXTRACT.model;
import type { Chunk } from './condense.ts';

const fileIds = { type: 'array', items: { type: 'integer' } };
const quote = { type: 'string' };
const obj = (props: Record<string, unknown>) => ({ type: 'object', additionalProperties: false, required: Object.keys(props), properties: props });

export const SCHEMA = obj({
  work_items: {
    type: 'array',
    items: obj({
      first_prompt: { type: 'integer' },
      last_prompt: { type: 'integer' },
      title: { type: 'string' },
      goal: { type: 'string' },
      what_was_done: { type: 'string' },
      status: { type: 'string', enum: ['done', 'partial', 'abandoned', 'investigation'] },
      significance: { type: 'integer', minimum: 1, maximum: 5 },
      files: fileIds,
      commits: { type: 'array', items: { type: 'string' } },
      things: { type: 'array', items: { type: 'string' } },
      decisions: { type: 'array', items: obj({ choice: { type: 'string' }, why: { type: 'string' }, evidence_quote: quote, files: fileIds }) },
      problems: { type: 'array', items: obj({ symptom: { type: 'string' }, cause: { type: 'string' }, resolution: { type: 'string' }, evidence_quote: quote, files: fileIds }) },
      facts: { type: 'array', items: obj({ statement: { type: 'string' }, evidence_quote: quote, files: fileIds }) },
    }),
  },
});

export const SYSTEM = `You turn excerpts of coding-agent sessions on company repositories into a team WORK MEMORY.
A teammate who later touches the same code should learn what was done there, why, and what went wrong.

The excerpt lists human prompts as [P<n> time] USER: ... followed by condensed agent activity
(A: assistant text, EDIT/WRITE/READ repo:path, BASH(repo) command -> OK/FAIL, {writes: ...} = files that command changed, SUB = done by a subagent).

Return work_items. A work item is one task the user asked for and what happened; it may span several prompts.
Rules:
- Describe what happened, in past tense, factually. Never write instructions or rules ("always", "must", "should", "never").
- Skip prompts that produced nothing durable (greetings, quick status checks, trivial questions) unless they contain a decision or a durable fact.
- title <= 80 chars. goal: one sentence. what_was_done: 2-4 sentences naming what changed, where, and the outcome.
- status: done | partial | abandoned | investigation (looked into something without changing code).
- significance 1-5: how much a teammate who later touches this code would want to know it. 5 = a decision, gotcha, or change others will run into; 3 = useful background; 1-2 = routine (status checks, drafting messages, trivial edits, re-running things).
- files: ids from CANDIDATE FILES that were changed, read, or run in the prompts this item covers (not in other prompts). Never invent ids.
- commits: only commit SHAs that appear in the excerpt for this work.
- decisions: real choices between alternatives, made by the user or agreed with them, with the stated reason. Following an explicit instruction or an external requirement is not a decision; record the requirement as a fact.
- problems: only failures that cost real time or changed the approach, with their cause and what actually resolved them. Skip routine hiccups (a rejected or retried command, a search with no matches, a transient error that went away). If the fix was only planned or not shown, the resolution is "not resolved in this excerpt".
- facts: durable knowledge about the code or systems that will still be true next week and that a teammate would want (where something lives, how a component behaves, an integration detail, how an environment is set up). Do NOT record one-off observations: timestamps of a test run, counts from one query, the current state of a branch, or what the agent is about to do.
- evidence_quote: copy 10-200 characters VERBATIM from the excerpt that supports the item.
- things: names of external systems, services, or domain concepts central to the work (e.g. "Shopify", "checkout", "Redis").
- If the excerpt holds nothing durable, return an empty work_items list.`;

export type RawItem = {
  first_prompt: number; last_prompt: number; title: string; goal: string; what_was_done: string; status: string; significance?: number;
  files: number[]; commits: string[]; things: string[];
  decisions: Array<{ choice: string; why: string; evidence_quote: string; files: number[] }>;
  problems: Array<{ symptom: string; cause: string; resolution: string; evidence_quote: string; files: number[] }>;
  facts: Array<{ statement: string; evidence_quote: string; files: number[] }>;
};
export type ExtractResult = { items: RawItem[]; costUsd: number; ms: number; cached: boolean; error?: string };

export function chunkKey(c: Chunk): string {
  return crypto.createHash('sha1').update(`${EXTRACT.promptVersion}\n${extractModel()}\n${c.text}`).digest('hex');
}

// One headless call with structured output. Lean: no MCP servers, no tools, no user settings, no saved session.
export function claudeJson(o: { model: string; system: string; prompt: string; schema: unknown; cwd: string; timeoutMs?: number }): Promise<{ data: any; costUsd: number; ms: number; error?: string }> {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const args = [
      '-p', '--model', o.model, '--output-format', 'json', '--json-schema', JSON.stringify(o.schema),
      '--system-prompt', o.system, '--strict-mcp-config', '--tools', '', '--no-session-persistence',
      '--disable-slash-commands', '--setting-sources', 'project',
    ];
    const child = spawn('claude', args, { cwd: o.cwd, env: { ...process.env, ORG_MEMORY_INTERNAL: '1' }, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), o.timeoutMs ?? EXTRACT.timeoutMs);
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('close', (code) => {
      clearTimeout(timer);
      try {
        const d = JSON.parse(out);
        if (d.is_error || !d.structured_output) throw new Error(String(d.result ?? d.subtype ?? 'no structured_output').slice(0, 200));
        resolve({ data: d.structured_output, costUsd: d.total_cost_usd ?? 0, ms: Date.now() - t0 });
      } catch (e) {
        resolve({ data: null, costUsd: 0, ms: Date.now() - t0, error: `${(e as Error).message} (exit ${code}) ${err.slice(0, 200)}` });
      }
    });
    child.stdin.end(o.prompt);
  });
}

export async function extractChunk(c: Chunk, cacheDir: string, tmpDir: string): Promise<ExtractResult> {
  const k = chunkKey(c);
  // Preserve the already-redacted excerpt for traceable graph ingestion, including cache hits.
  const sourceDir = path.join(cacheDir, 'sources');
  fs.mkdirSync(sourceDir, { recursive: true });
  fs.writeFileSync(path.join(sourceDir, `${k}.txt`), c.text, { mode: 0o600 });
  const cacheFile = path.join(cacheDir, `${k}.json`);
  if (fs.existsSync(cacheFile)) {
    const hit = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
    return { ...hit, cached: true };
  }
  const prompt = `Extract the work memory from this session excerpt.\n\n${c.text}`;
  let lastErr = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await claudeJson({ model: extractModel(), system: SYSTEM, prompt, schema: SCHEMA, cwd: tmpDir });
    if (r.error) { lastErr = r.error; continue; }
    const res = { items: r.data.work_items ?? [], costUsd: r.costUsd, ms: r.ms };
    fs.writeFileSync(cacheFile, JSON.stringify(res));
    return { ...res, cached: false };
  }
  return { items: [], costUsd: 0, ms: 0, cached: false, error: lastErr };
}

export async function pool<T, R>(items: T[], limit: number, fn: (t: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}
