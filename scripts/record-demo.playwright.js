// Optional Node recording helper. Install Playwright and its Chromium/ffmpeg first.
// Requires the local API. This captures live interactions with synthetic fixtures.
async function main() {
  const { execFileSync } = await import('node:child_process');
  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  const project = process.cwd();
  const { chromium } = await import(process.env.ORG_MEMORY_PLAYWRIGHT_MODULE ?? 'playwright');
  const browser = await chromium.launch({ headless: true });
  const run = (script) => execFileSync(process.execPath, ['--no-warnings', script], { cwd: project, encoding: 'utf8', timeout: 30000 });
  run('scripts/seed-demo.ts');
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, recordVideo: { dir: path.join(project, '.demo/video'), size: { width: 1440, height: 1000 } } });
  const demo = await context.newPage();
  const video = demo.video();
  const caption = async (title, detail) => {
    await demo.evaluate(({ title, detail }) => {
      document.getElementById('recording-caption')?.remove();
      const panel = document.createElement('div'); panel.id = 'recording-caption';
      Object.assign(panel.style, { position: 'fixed', left: '28px', right: '28px', bottom: '24px', zIndex: 9999, background: '#20271ef5', color: '#f5f5ef', padding: '18px 24px', borderRadius: '10px', boxShadow: '0 6px 30px #0003', fontFamily: 'sans-serif' });
      const heading = document.createElement('strong'); heading.textContent = title; heading.style.fontSize = '20px';
      const text = document.createElement('div'); text.textContent = detail; Object.assign(text.style, { fontSize: '15px', marginTop: '8px', color: '#d4dfc5' });
      panel.append(heading, text); document.body.append(panel);
    }, { title, detail });
  };
  try {
    await demo.goto('http://127.0.0.1:8787');
    await demo.locator('#health').filter({ hasText: '8 nodes' }).waitFor();
    await caption('Org Memory · The next coding session should know why.', 'Synthetic scenario · Live FalkorDB engine · Actual Cypher and test execution · Deterministic demo policy');
    await demo.waitForTimeout(4500);
    await demo.locator('#recall').click();
    await demo.locator('.memory-card').nth(1).waitFor();
    await demo.locator('.memory-card').nth(1).click();
    await demo.locator('#recall-form').scrollIntoViewIfNeeded();
    await caption('1 / Fetch memory through real graph relationships', 'authentication.ts → past investigation → mobile-client fact. The source quote and path accompany the context.');
    await demo.waitForTimeout(6000);
    await demo.locator('#query-details summary').click();
    await demo.locator('#queries').scrollIntoViewIfNeeded();
    await caption('2 / Inspect what FalkorDB actually executed', 'Parameterized Cypher, actual returned row counts and measured query timings from this request.');
    await demo.waitForTimeout(6500);
    await demo.locator('#query-details summary').click();
    await demo.locator('#expansion').uncheck(); await demo.locator('#recall').click();
    await demo.locator('#metrics').filter({ hasText: '0 memories' }).waitFor();
    await demo.locator('#recall-form').scrollIntoViewIfNeeded();
    await caption('3 / Disable graph expansion: no direct result', 'The relevant fact belongs to the mobile client. The request needs the relationship through earlier work.');
    await demo.waitForTimeout(4500);
    await demo.locator('#expansion').check(); await demo.locator('#recall').click();
    await demo.locator('.memory-card').nth(1).waitFor();
    run('scripts/demo-agent.ts');
    await demo.locator('#refresh').click();
    await demo.locator('.bottom-grid').scrollIntoViewIfNeeded();
    await caption('4 / Retrieved evidence changes the code action', 'The local policy selects the compatibility check. Removal fails; a real compatibility-preserving simplification passes all 4 tests.');
    await demo.waitForTimeout(6500);
    await demo.locator('#outcomes details summary').click();
    await demo.locator('#outcomes details pre').scrollIntoViewIfNeeded();
    await caption('5 / Inspect the real test process output', 'These are local subprocess results reported to the API. Source grounding and behavioral execution have different evidence labels.');
    await demo.waitForTimeout(5500);
    execFileSync(process.execPath, ['--no-warnings', 'scripts/seed-demo.ts', '--migrated'], { cwd: project, timeout: 30000 });
    await demo.locator('#refresh').click();
    await demo.locator('#health').filter({ hasText: '9 nodes' }).waitFor();
    await demo.locator('#recall').click();
    await demo.locator('#metrics').filter({ hasText: '1 memories' }).waitFor();
    await demo.locator('#recall-form').scrollIntoViewIfNeeded();
    await caption('6 / Update memory without silently rewriting history', 'New migration evidence supersedes the old requirement. The next recall returns only the replacement fact.');
    await demo.waitForTimeout(6500);
    await caption('Shared discoveries. Relevant context. Inspectable evidence.', 'Local setup and reproducible proof: github.com/naveenkumarrk/org-memory-falkordb');
    await demo.waitForTimeout(4500);
  } finally {
    await context.close(); await browser.close(); run('scripts/seed-demo.ts');
  }
  const output = path.join(project, '.demo/org-memory-demo.webm');
  await fs.copyFile(await video.path(), output);
  console.log(JSON.stringify({ video: output, note: 'Captioned recording of live interactions; no microphone narration.' }));
}
await main();
