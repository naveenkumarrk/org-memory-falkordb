import fs from 'node:fs';
import path from 'node:path';
import type { ClientConfig } from './client.ts';

export const profiles = ['alice', 'bob', 'outsider'] as const;
export type Profile = typeof profiles[number];
export function profileRoot(name: string) {
  if (!profiles.includes(name as Profile)) throw new Error('Choose alice, bob, or outsider.');
  return path.resolve('.demo/users', name);
}
export function profileConfig(name: string): ClientConfig {
  return JSON.parse(fs.readFileSync(path.join(profileRoot(name), 'client.json'), 'utf8'));
}
