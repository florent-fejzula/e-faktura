/**
 * Horizontal-overflow check. A page whose content is wider than the viewport
 * makes mobile browsers render it zoomed-in and cut off, which is invisible on
 * a desktop screen and obvious on a phone.
 */
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL ?? 'http://localhost:4300';
const PAGES = process.argv.slice(2).length ? process.argv.slice(2) : ['/najava'];

const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({
  viewport: { width: 360, height: 780 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
});

let bad = 0;
for (const path of PAGES) {
  await page.goto(BASE + path, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  const m = await page.evaluate(() => {
    const de = document.documentElement;
    const wide = [...document.querySelectorAll('*')]
      .filter((el) => el.getBoundingClientRect().right > de.clientWidth + 1)
      .slice(0, 6)
      .map((el) => `${el.tagName.toLowerCase()}.${(el.className || '').toString().split(' ')[0]} → ${Math.round(el.getBoundingClientRect().right)}px`);
    return { scrollW: de.scrollWidth, clientW: de.clientWidth, wide };
  });
  const overflow = m.scrollW - m.clientW;
  console.log(`${path}  viewport ${m.clientW}  content ${m.scrollW}  ${overflow > 0 ? `OVERFLOW +${overflow}px` : 'ok'}`);
  if (m.wide.length) console.log('   offenders:', m.wide.join(' | '));
  if (overflow > 0) bad++;
}

await browser.close();
process.exit(bad ? 1 : 0);
