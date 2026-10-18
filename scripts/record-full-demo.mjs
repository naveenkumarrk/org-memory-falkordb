// Optional Playwright recording. Every displayed CLI result is captured from a real subprocess.
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
const project = process.cwd();
let scenes;
try { scenes = JSON.parse(await fs.readFile('.demo/narration/scenes.json', 'utf8')); }
catch { scenes = JSON.parse(await fs.readFile('scripts/demo-scenes.json', 'utf8')); }
const { chromium } = await import(process.env.ORG_MEMORY_PLAYWRIGHT_MODULE ?? 'playwright');
const run = (script, args = []) => execFileSync(process.execPath, ['--no-warnings', script, ...args], { cwd: project, encoding: 'utf8', timeout: 30000 });
run('scripts/seed-demo.ts');
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1600, height: 900 }, recordVideo: { dir: path.join(project, '.demo/full-video'), size: { width: 1600, height: 900 } } });
const page = await context.newPage(), video = page.video();
const started = performance.now(), manifest = [];
const panel = async (title, command, output) => {
  await page.evaluate(({ title, command, output }) => {
    document.getElementById('live-cli')?.remove();
    const el = document.createElement('section'); el.id = 'live-cli';
    Object.assign(el.style, { position: 'fixed', inset: '94px 55px 155px', zIndex: 9998, background: '#17221bf9', border: '1px solid #71836b', borderRadius: '10px', color: '#e7eddf', padding: '24px 30px', boxShadow: '0 12px 60px #0004', fontFamily: 'sans-serif', overflow: 'auto' });
    const label = document.createElement('div'); label.textContent = 'RECORDING OVERLAY · ACTUAL LOCAL CLI OUTPUT'; Object.assign(label.style, { color: '#a4b79a', letterSpacing: '1.5px', fontSize: '11px' });
    const heading = document.createElement('h2'); heading.textContent = title; heading.style.margin = '14px 0';
    const cmd = document.createElement('div'); cmd.textContent = `$ ${command}`; Object.assign(cmd.style, { color: '#c9ee77', fontFamily: 'monospace', fontSize: '17px', paddingBottom: '18px' });
    const text = document.createElement('pre'); text.textContent = output; Object.assign(text.style, { color: '#e7eddf', fontSize: '15px', lineHeight: '1.55', padding: '0', whiteSpace: 'pre-wrap' });
    el.append(label, heading, cmd, text); document.body.append(el);
  }, { title, command, output });
};
async function show(id, action) {
  console.log(`Recording ${id}`);
  if (action) await action();
  const scene = scenes.find(s => s.id === id);
  await page.evaluate(({ title, detail }) => {
    document.getElementById('recording-caption')?.remove();
    const el = document.createElement('div'); el.id = 'recording-caption';
    Object.assign(el.style, { position: 'fixed', left: '28px', right: '28px', bottom: '22px', zIndex: 9999, background: '#20271ef7', color: '#f5f5ef', padding: '20px 26px', borderRadius: '10px', boxShadow: '0 6px 30px #0003', fontFamily: 'sans-serif' });
    const heading = document.createElement('strong'); heading.textContent = title; heading.style.fontSize = '24px';
    const text = document.createElement('div'); text.textContent = detail; Object.assign(text.style, { fontSize: '17px', marginTop: '9px', color: '#d4dfc5' });
    el.append(heading, text); document.body.append(el);
  }, scene);
  const at = performance.now() - started;
  const hold = (scene.duration_ms ?? Math.max(6500, scene.speech.split(/\s+/).length * 360)) + 1200;
  manifest.push({ ...scene, start_ms: Math.round(at), hold_ms: hold });
  await page.waitForTimeout(hold);
}
async function cli(id, title, command, script, args) {
  await show(id, async () => panel(title, command, run(script, args)));
}
try {
  await page.goto('http://127.0.0.1:8787');
  await page.locator('#health').filter({ hasText: '8 nodes' }).waitFor();
  await show('intro');
  await show('graph', async () => {
    await page.locator('#recall').click(); await page.locator('.memory-card').nth(1).waitFor();
    await page.locator('.memory-card').nth(1).click(); await page.locator('#recall-form').scrollIntoViewIfNeeded();
  });
  await show('cypher', async () => {
    await page.locator('#query-details summary').click(); await page.locator('#queries').scrollIntoViewIfNeeded();
  });
  await show('direct', async () => {
    await page.locator('#query-details summary').click(); await page.locator('#expansion').uncheck();
    await page.locator('#recall').click(); await page.locator('#metrics').filter({ hasText: '0 memories' }).waitFor();
    await page.locator('#recall-form').scrollIntoViewIfNeeded();
  });
  await show('action', async () => {
    await page.locator('#expansion').check(); await page.locator('#recall').click();
    await page.locator('.memory-card').nth(1).waitFor(); run('scripts/demo-agent.ts');
    await page.locator('#refresh').click(); await page.locator('.bottom-grid').scrollIntoViewIfNeeded();
    await page.locator('#outcomes details summary').click();
  });
  await show('supersede', async () => {
    run('scripts/seed-demo.ts', ['--migrated']); await page.locator('#refresh').click();
    await page.locator('#health').filter({ hasText: '9 nodes' }).waitFor(); await page.locator('#recall').click();
    await page.locator('#metrics').filter({ hasText: '1 memories' }).waitFor(); await page.locator('#recall-form').scrollIntoViewIfNeeded();
  });
  await cli('alice', 'Alice publishes a discovery', 'npm run demo:users -- --seed', 'scripts/demo-users.ts', ['--seed']);
  await cli('bob-read', 'Bob retrieves Alice’s knowledge', 'npm run demo:recall -- --user bob', 'scripts/recall.ts', ['--user', 'bob']);
  await cli('bob-write', 'Bob tests and contributes', 'npm run demo:users -- --contribute', 'scripts/demo-users.ts', ['--contribute']);
  await cli('alice-read', 'Alice retrieves Bob’s contribution', 'npm run demo:recall -- --user alice', 'scripts/recall.ts', ['--user', 'alice']);
  await cli('outsider', 'Another organization gets an empty graph', 'npm run demo:recall -- --user outsider', 'scripts/recall.ts', ['--user', 'outsider']);
  await cli('verify', 'End-to-end sharing, hooks, and permissions', 'npm run demo:users', 'scripts/demo-users.ts', []);
  await show('finish', async () => {
    await page.evaluate(() => document.getElementById('live-cli')?.remove());
    run('scripts/seed-demo.ts'); await page.locator('#refresh').click(); await page.locator('#health').filter({ hasText: '8 nodes' }).waitFor();
    await page.locator('#recall').click(); await page.locator('.memory-card').nth(1).waitFor();
    await page.locator('.memory-card').nth(1).click(); await page.evaluate(() => window.scrollTo(0, 0));
  });
} finally {
  await context.close(); await browser.close(); run('scripts/seed-demo.ts');
}
const output = path.join(project, '.demo/org-memory-full-demo.webm');
await fs.copyFile(await video.path(), output);
await fs.writeFile('.demo/full-demo-manifest.json', JSON.stringify({ video: output, recorded_at: new Date().toISOString(), scenes: manifest }, null, 2));
console.log(`Saved ${output}`);
