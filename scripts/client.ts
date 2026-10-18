import fs from 'node:fs';

export type ClientConfig = { url: string; token: string };
export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) { super(`${status}: ${message}`); this.status = status; }
}

export function clientConfig() {
  let local: Record<string, string> = {};
  try { local = JSON.parse(fs.readFileSync(process.env.ORG_MEMORY_CLIENT_CONFIG ?? '.demo/client.json', 'utf8')); } catch { /* hosted env */ }
  const url = process.env.ORG_MEMORY_API_URL ?? local.url ?? 'http://127.0.0.1:8787';
  const token = process.env.ORG_MEMORY_API_TOKEN ?? local.token;
  if (!token) throw new Error('No API token. Run npm run setup:local or set ORG_MEMORY_API_TOKEN.');
  return { url, token };
}

export async function api(route: string, body?: unknown, config: ClientConfig = clientConfig()) {
  const { url, token } = config;
  const response = await fetch(`${url}${route}`, {
    method: body === undefined ? 'GET' : 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(10000),
  });
  const data = await response.json() as any;
  if (!response.ok) throw new ApiError(response.status, data.error ?? 'Memory request failed');
  return data;
}
