// Isolated recall-only Claude settings. Does not install global hooks or read past sessions.
import fs from 'node:fs';
import path from 'node:path';
import { clientConfig } from './client.ts';

const root = path.resolve('.demo/hook-home');
fs.mkdirSync(root, { recursive: true });
fs.writeFileSync(path.join(root, 'remote.json'), JSON.stringify(clientConfig()), { mode: 0o600 });
const hook = path.resolve('src/hook.ts');
const shellQuote = (s: string) => `'${s.replaceAll("'", "'\\''")}'`;
const command = `ORG_MEMORY_HOME=${shellQuote(root)} ${shellQuote(process.execPath)} --no-warnings ${shellQuote(hook)}`;
const handler = { type: 'command', command, timeout: 5 };
fs.writeFileSync(path.join(root, 'hooks.settings.json'), JSON.stringify({ hooks: {
  UserPromptSubmit: [{ hooks: [handler] }],
  PostToolUse: [{ matcher: 'Read|Edit|Write|MultiEdit', hooks: [handler] }],
  PostToolUseFailure: [{ hooks: [handler] }],
} }, null, 2));
console.log(`Recall-only Claude settings: ${path.join(root, 'hooks.settings.json')}`);
console.log('Use claude --settings <that absolute path> from .demo/workspace/commerce. No global settings were edited.');
