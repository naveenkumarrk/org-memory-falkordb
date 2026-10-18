// Claude Code session JSONL -> ordered events. The format is internal to Claude Code, so parsing is defensive.
import fs from 'node:fs';
import path from 'node:path';

export type ToolResult = { isError: boolean; text: string };
export type Ev =
  | { kind: 'prompt'; uuid: string; ts: string; text: string; cwd: string }
  | { kind: 'text'; uuid: string; ts: string; text: string; sidechain: boolean }
  | { kind: 'tool'; uuid: string; ts: string; id: string; name: string; input: any; cwd: string; sidechain: boolean; result?: ToolResult };

export type Session = { id: string; file: string; project: string; events: Ev[]; firstTs: string; lastTs: string };

const SKIP_PROMPT = /^(<command-name>|<command-message>|<local-command|<task-notification>|<bash-input>|<bash-stdout>|\[Request interrupted|Caveat: The messages below)/;

function blockText(c: unknown): string {
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.map((b) => (b && typeof b === 'object' && 'text' in b ? String((b as any).text) : '')).join('\n');
  return '';
}

function cleanPrompt(s: string): string {
  return s.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '').trim();
}

function parseFile(file: string, seen: Set<string>, sidechain: boolean): Ev[] {
  const out: Ev[] = [];
  const tools = new Map<string, Extract<Ev, { kind: 'tool' }>>();
  let raw: string;
  try { raw = fs.readFileSync(file, 'utf8'); } catch { return out; }
  for (const line of raw.split('\n')) {
    if (!line) continue;
    let r: any;
    try { r = JSON.parse(line); } catch { continue; }
    if (r.type !== 'user' && r.type !== 'assistant') continue;
    const uuid: string = r.uuid ?? '';
    if (uuid && seen.has(uuid)) continue;
    if (uuid) seen.add(uuid);
    const ts: string = r.timestamp ?? '';
    const cwd: string = r.cwd ?? '';
    const side = sidechain || r.isSidechain === true;
    const content = r.message?.content;
    if (r.type === 'assistant') {
      if (!Array.isArray(content)) continue;
      for (const b of content) {
        if (b?.type === 'text' && b.text?.trim()) out.push({ kind: 'text', uuid, ts, text: b.text, sidechain: side });
        else if (b?.type === 'tool_use') {
          const ev = { kind: 'tool' as const, uuid, ts, id: b.id, name: b.name, input: b.input ?? {}, cwd, sidechain: side };
          tools.set(b.id, ev);
          out.push(ev);
        }
      }
      continue;
    }
    // user record: either tool results or a human prompt
    if (Array.isArray(content) && content.some((b: any) => b?.type === 'tool_result')) {
      for (const b of content) {
        if (b?.type !== 'tool_result') continue;
        const ev = tools.get(b.tool_use_id);
        if (!ev) continue;
        let text = blockText(b.content);
        const tur = r.toolUseResult;
        if (tur && typeof tur === 'object' && typeof tur.stderr === 'string' && tur.stderr && !text.includes(tur.stderr)) text += `\n${tur.stderr}`;
        ev.result = { isError: b.is_error === true, text };
      }
      continue;
    }
    if (r.isMeta || side) continue;
    const text = cleanPrompt(blockText(content));
    if (!text || SKIP_PROMPT.test(text)) continue;
    out.push({ kind: 'prompt', uuid, ts, text, cwd });
  }
  return out;
}

export function listSessionFiles(projectPrefix: string, projectsDir: string): string[] {
  const out: string[] = [];
  for (const proj of fs.readdirSync(projectsDir)) {
    if (!proj.startsWith(projectPrefix)) continue;
    const dir = path.join(projectsDir, proj);
    for (const f of fs.readdirSync(dir)) if (f.endsWith('.jsonl')) out.push(path.join(dir, f));
  }
  return out.sort((a, b) => fs.statSync(a).mtimeMs - fs.statSync(b).mtimeMs);
}

// Parses a session plus its subagent transcripts (<project>/<sessionId>/subagents/*.jsonl), merged by time.
export function parseSession(file: string, seen: Set<string>): Session {
  const id = path.basename(file, '.jsonl');
  const events = parseFile(file, seen, false);
  const subDir = path.join(path.dirname(file), id, 'subagents');
  if (fs.existsSync(subDir)) {
    for (const f of fs.readdirSync(subDir)) {
      if (f.endsWith('.jsonl')) events.push(...parseFile(path.join(subDir, f), seen, true).filter((e) => e.kind !== 'prompt'));
    }
    events.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));
  }
  const tss = events.map((e) => e.ts).filter(Boolean);
  return { id, file, project: path.basename(path.dirname(file)), events, firstTs: tss[0] ?? '', lastTs: tss[tss.length - 1] ?? '' };
}
