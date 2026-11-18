/**
 * Browser smoke test: drives the built app in headless Microsoft Edge / Chrome (system install,
 * no browser download), visits every page as a demo analyst, fails on console errors and saves
 * screenshots. Used locally and in CI (`npm run smoke`).
 *
 *   node scripts/smoke.mjs [baseUrl] [outDir]
 */
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const base = process.argv[2] ?? 'http://localhost:4173';
const out = process.argv[3] ?? 'smoke-artifacts';
mkdirSync(out, { recursive: true });

const channel = process.env.SMOKE_CHANNEL ?? (process.platform === 'win32' ? 'msedge' : 'chrome');
const browser = await chromium.launch({ channel, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });

const errors = [];
page.on('console', (msg) => {
  if (msg.type() === 'error') errors.push(`[console] ${msg.text()}`);
});
page.on('pageerror', (err) => errors.push(`[pageerror] ${err.message}`));

// Demo session: analyst role.
await page.goto(`${base}/login`);
await page.getByRole('radio', { name: /Duty Analyst/ }).click();
await page.getByRole('button', { name: 'Enter demo console' }).click();

const visits = [
  { path: '/', name: 'orbital', wait: 6000 },
  { path: '/site/ZA-NW-002', name: 'site', wait: 9000 },
  { path: '/network', name: 'network', wait: 2500 },
  { path: '/intel', name: 'intel', wait: 2500 },
  { path: '/governance', name: 'governance', wait: 2500 },
];

for (const v of visits) {
  await page.goto(`${base}${v.path}`);
  await page.waitForTimeout(v.wait);
  await page.screenshot({ path: join(out, `${v.name}.png`) });
  console.log(`visited ${v.path}`);
}

// Interactions: select a mine on the orbital view; reveal sensors on the site twin.
await page.goto(`${base}/`);
await page.waitForTimeout(3000);
await page.getByRole('button', { name: /Buffelsfontein Shaft 11/ }).first().click();
await page.waitForTimeout(2500);
await page.screenshot({ path: join(out, 'orbital-selected.png') });

await page.goto(`${base}/site/ZA-NW-002`);
await page.waitForTimeout(2500);
await page.getByRole('button', { name: /Plain sight/ }).click();
await page.getByRole('button', { name: '90×' }).click();
await page.waitForTimeout(7000);
await page.screenshot({ path: join(out, 'site-revealed.png') });

await browser.close();

// Ignore the API health probe failing in offline demo mode — that is expected behaviour.
const real = errors.filter((e) => !/\/api\/v1\/health|Failed to load resource/.test(e));
if (real.length) {
  console.error(`\n${real.length} browser error(s):\n${real.join('\n')}`);
  process.exit(1);
}
console.log('smoke OK: no browser errors');
