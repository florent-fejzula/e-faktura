/**
 * Renders the app icons from the brand mark — the `receipt_long` glyph the
 * navigation rail shows — so the installed app, the favicon and the rail agree.
 *
 *   npm run icons:gen
 *
 * Writes into public/: the manifest icons, the iOS touch icon and favicon.ico.
 * Uses the locally installed Chrome through Playwright, and the Material
 * Symbols font from Google Fonts, so it needs a network connection.
 *
 * Colours are the theme's resolved values (azure palette): `--mat-sys-primary`
 * and `--mat-sys-on-primary`. Change them here if the theme changes.
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

const PRIMARY = '#005cbb';
const ON_PRIMARY = '#ffffff';
const OUT = 'public/icons';

/**
 * Three shapes, because the platforms crop differently:
 *
 * - `rounded`: a rounded square on transparency. Desktop installs and anything
 *   that shows the icon as-is.
 * - `maskable`: full bleed, glyph inside the central 80% "safe zone". Android
 *   cuts these to its own shape (circle, squircle), so nothing important may
 *   sit near the edge.
 * - `square`: full bleed and opaque. iOS rounds the corners itself and fills
 *   transparency with black, so a transparent corner would show as a black
 *   notch.
 */
const SHAPES = {
  rounded: { radius: 0.22, glyph: 0.62 },
  maskable: { radius: 0, glyph: 0.5 },
  square: { radius: 0, glyph: 0.6 },
};

const ICONS = [
  { file: `${OUT}/icon-192.png`, size: 192, shape: 'rounded' },
  { file: `${OUT}/icon-512.png`, size: 512, shape: 'rounded' },
  { file: `${OUT}/icon-maskable-192.png`, size: 192, shape: 'maskable' },
  { file: `${OUT}/icon-maskable-512.png`, size: 512, shape: 'maskable' },
  { file: `${OUT}/apple-touch-icon.png`, size: 180, shape: 'square' },
  { file: `${OUT}/shortcut-new-invoice.png`, size: 96, shape: 'maskable', glyph: 'add' },
];

/** Sizes packed into favicon.ico; browsers pick the closest. */
const FAVICON_SIZES = [16, 32, 48];

const page_html = `<!doctype html>
<html><head>
<link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200&display=block" rel="stylesheet">
<style>
  html, body { margin: 0; background: transparent; }
  .tile { display: grid; place-items: center; background: ${PRIMARY}; color: ${ON_PRIMARY}; }
  .glyph {
    font-family: 'Material Symbols Outlined';
    font-variation-settings: 'FILL' 0, 'wght' 500, 'GRAD' 0, 'opsz' 48;
    line-height: 1;
    -webkit-font-smoothing: antialiased;
  }
</style>
</head><body><div class="tile"><span class="glyph"></span></div></body></html>`;

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ deviceScaleFactor: 1 });
await page.setContent(page_html, { waitUntil: 'networkidle' });
await page.evaluate(() => document.fonts.load('48px "Material Symbols Outlined"', 'receipt_long'));

async function render(size, shapeName, glyphName = 'receipt_long') {
  const shape = SHAPES[shapeName];
  await page.setViewportSize({ width: size, height: size });
  await page.evaluate(
    ({ size, shape, glyphName }) => {
      const tile = document.querySelector('.tile');
      const glyph = document.querySelector('.glyph');
      tile.style.width = `${size}px`;
      tile.style.height = `${size}px`;
      tile.style.borderRadius = `${Math.round(size * shape.radius)}px`;
      glyph.style.fontSize = `${Math.round(size * shape.glyph)}px`;
      glyph.textContent = glyphName;
    },
    { size, shape, glyphName },
  );
  await page.evaluate(() => document.fonts.ready);
  return page.screenshot({ clip: { x: 0, y: 0, width: size, height: size }, omitBackground: true });
}

mkdirSync(OUT, { recursive: true });

for (const icon of ICONS) {
  writeFileSync(icon.file, await render(icon.size, icon.shape, icon.glyph));
  console.log('  ->', icon.file);
}

// ICO with PNG payloads (supported by every browser since IE Vista-era), so
// there is no BMP encoding to get wrong. Small sizes use the square shape: a
// rounded corner at 16px is two grey pixels.
const pngs = [];
for (const size of FAVICON_SIZES) pngs.push(await render(size, 'square'));
writeFileSync('public/favicon.ico', ico(FAVICON_SIZES, pngs));
console.log('  -> public/favicon.ico');

await browser.close();

function ico(sizes, images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(images.length, 4);

  const entries = [];
  let offset = 6 + 16 * images.length;
  images.forEach((png, i) => {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(sizes[i] >= 256 ? 0 : sizes[i], 0); // width
    entry.writeUInt8(sizes[i] >= 256 ? 0 : sizes[i], 1); // height
    entry.writeUInt8(0, 2); // palette
    entry.writeUInt8(0, 3); // reserved
    entry.writeUInt16LE(1, 4); // colour planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += png.length;
    entries.push(entry);
  });

  return Buffer.concat([header, ...entries, ...images]);
}
