// Installs the org-memory hooks into ~/.claude/settings.json for every session (or removes them).
// Backs the file up first, touches only our own hook entries, and is idempotent.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { dataDir } from './config.ts';
import { loadSettings, saveSettings } from './settings.ts';

const CLAUDE_SETTINGS = path.join(os.homedir(), '.claude', 'settings.json');
const SRC = path.dirname(new URL(import.meta.url).pathname);
const MARK = `${SRC}/hook`; // every command we install contains this path

function ours(): Record<string, unknown[]> {
  const cmd = (f: string) => ({ type: 'command', command: `node --no-warnings ${SRC}/${f}`, timeout: 5 });
  return {
    UserPromptSubmit: [{ hooks: [cmd('hook.ts')] }],
    PostToolUse: [{ matcher: 'Read|Edit|Write|MultiEdit', hooks: [cmd('hook.ts')] }],
    PostToolUseFailure: [{ hooks: [cmd('hook.ts')] }],
    // synchronous on purpose: it only spawns a detached sync and returns in <1 s; async Stop hooks never run in `claude -p`
    Stop: [{ hooks: [cmd('hook-stop.ts')] }],
  };
}

function strip(hooks: Record<string, any[]>): Record<string, any[]> {
  const out: Record<string, any[]> = {};
  for (const [ev, groups] of Object.entries(hooks ?? {})) {
    const kept = (groups ?? []).map((g) => ({ ...g, hooks: (g.hooks ?? []).filter((h: any) => !String(h.command ?? '').includes(MARK)) })).filter((g) => g.hooks.length);
    if (kept.length) out[ev] = kept;
  }
  return out;
}

// Hooks as a standalone settings file, for one-off sessions: claude --settings <file> (used by the A/B harnesses)
export function writeHooksFile(): string {
  const f = path.join(dataDir('prod'), 'hooks.settings.json');
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, JSON.stringify({ hooks: ours() }, null, 2) + '\n');
  return f;
}

export function status() {
  let installed = false;
  try { installed = JSON.stringify(JSON.parse(fs.readFileSync(CLAUDE_SETTINGS, 'utf8')).hooks ?? {}).includes(MARK); } catch { /* no settings */ }
  const s = loadSettings();
  return { installed, mode: !s.enabled ? 'off' : s.shadow ? 'shadow' : 'on', claudeSettings: CLAUDE_SETTINGS };
}

export function install(mode: 'shadow' | 'on' | 'off' | 'uninstall') {
  const raw = fs.existsSync(CLAUDE_SETTINGS) ? fs.readFileSync(CLAUDE_SETTINGS, 'utf8') : '{}';
  const cfg = JSON.parse(raw);
  const backups = path.join(dataDir('prod'), 'backups');
  fs.mkdirSync(backups, { recursive: true });
  const backup = path.join(backups, `claude-settings.${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(backup, raw);
  const hooks = strip(cfg.hooks ?? {});
  if (mode !== 'uninstall') for (const [ev, groups] of Object.entries(ours())) hooks[ev] = [...(hooks[ev] ?? []), ...groups];
  if (Object.keys(hooks).length) cfg.hooks = hooks; else delete cfg.hooks;
  fs.writeFileSync(`${CLAUDE_SETTINGS}.tmp`, JSON.stringify(cfg, null, 2) + '\n');
  fs.renameSync(`${CLAUDE_SETTINGS}.tmp`, CLAUDE_SETTINGS);
  if (mode === 'shadow') saveSettings({ enabled: true, shadow: true });
  if (mode === 'on') saveSettings({ enabled: true, shadow: false });
  if (mode === 'off') saveSettings({ enabled: false });
  return { ...status(), backup };
}
