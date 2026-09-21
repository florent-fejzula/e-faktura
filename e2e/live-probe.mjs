/**
 * Post-deploy smoke check: loads the hosted app and confirms it boots, renders
 * Macedonian, and logs no console errors. Catches the classic deploy mistakes —
 * wrong `public` directory, missing SPA rewrite, emulator config shipped to
 * production — none of which the build itself would flag.
 *
 *   node e2e/live-probe.mjs [url]
 */
import { chromium } from 'playwright';

const url = process.argv[2] ?? 'https://e-faktura-1e6d0.web.app';
const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage();
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

await page.goto(url, { waitUntil: 'networkidle' });
console.log('url      :', page.url());
console.log('title    :', await page.title());
console.log('rendered :', (await page.locator('body').innerText()).replace(/\s+/g, ' ').slice(0, 200));
console.log('google   :', (await page.getByRole('button', { name: /Google/i }).count()) ? 'button present' : 'MISSING');
await page.screenshot({ path: 'e2e/shots/live-login.png', fullPage: true });
console.log('errors   :', errors.length ? errors : 'none');

await browser.close();
process.exit(errors.length ? 1 : 0);
