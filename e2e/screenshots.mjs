/**
 * Captures the main screens for visual review, including the print document
 * under print media emulation.
 *
 *   node e2e/screenshots.mjs        (writes into e2e/shots/)
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = process.env.BASE_URL ?? 'http://localhost:4300';
const OUT = 'e2e/shots';
mkdirSync(OUT, { recursive: true });

const fill = async (scope, label, value) => {
  const input = scope.getByLabel(label, { exact: true }).first();
  await input.waitFor({ state: 'visible', timeout: 15000 });
  await input.fill(String(value));
};

/** Navigates, retrying past a stale Vite error overlay from a live rebuild. */
const open = async (page, url) => {
  for (let attempt = 0; attempt < 6; attempt++) {
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(600);
    if (!(await page.locator('vite-error-overlay').count())) return;
    await page.waitForTimeout(2500);
  }
  throw new Error('dev server is still reporting a build error');
};

/**
 * Grants admin in the emulator by writing /admins/{uid} as owner — the same
 * document that has to be created once by hand in the Firebase console.
 */
const grantAdmin = async (uid) => {
  const url =
    'http://127.0.0.1:8080/v1/projects/demo-e-faktura/databases/(default)' +
    `/documents/admins?documentId=${uid}`;
  await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner' },
    body: JSON.stringify({ fields: { grantedAt: { integerValue: String(Date.now()) } } }),
  });
};

const shot = async (page, name, opts = {}) => {
  await page.screenshot({ path: `${OUT}/${name}.png`, ...opts });
  console.log('  ->', `${OUT}/${name}.png`);
};

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });

try {
  await open(page, `${BASE}/najava`);
  await page.waitForTimeout(1200);
  await shot(page, '01-login');

  // Same screen on the narrowest common Android width, where the missing
  // border-box reset used to push the panel 48px past the viewport.
  await page.setViewportSize({ width: 360, height: 780 });
  await page.waitForTimeout(500);
  await shot(page, '01b-login-mobile');
  await page.setViewportSize({ width: 1440, height: 950 });
  await page.waitForTimeout(400);

  await page.getByRole('button', { name: 'Создадете нова сметка' }).click();
  await fill(page, 'Име и презиме', 'Марко Петковски');
  const shotsEmail = `shots-${Date.now()}@efaktura.local`;
  await fill(page, 'Е-пошта', shotsEmail);
  await fill(page, 'Лозинка', 'lozinka123');
  await page.getByRole('button', { name: 'Создај сметка' }).click();
  await page.waitForURL('**/registracija', { timeout: 25000 });
  await page.waitForTimeout(700);
  await shot(page, '02-onboarding-step1');

  await fill(page, 'Назив на фирма', 'ПРОФИНГ ИНЖЕНЕРИНГ ДООЕЛ СКОПЈЕ');
  await fill(page, 'ЕДБ (даночен број)', '4030995135699');
  await fill(page, 'ЕМБС (матичен број)', '6612345');
  await page.getByRole('button', { name: 'Продолжи' }).click();
  await fill(page, 'Улица', 'Орце Николов');
  await fill(page, 'Број', '133/Д3');
  await fill(page, 'Поштенски број', '1000');
  await fill(page, 'Град', 'Скопје');
  await fill(page, 'Е-пошта', 'info@profing.mk');
  await fill(page, 'Телефон', '+389 2 3123 456');
  await fill(page, 'Банка', 'Комерцијална банка АД Скопје');
  await fill(page, 'Трансакциска сметка', '300000000123456');
  await page.getByRole('button', { name: 'Продолжи' }).click();
  await page.waitForTimeout(500);
  await shot(page, '03-onboarding-numbering');

  await page.getByRole('button', { name: 'Зачувај и започни' }).click();
  await page.waitForURL('**/fakturi', { timeout: 25000 });
  await page.waitForTimeout(1200);
  await shot(page, '04-empty-list');

  // --- build an invoice ---------------------------------------------------
  await page.getByRole('link', { name: 'Нова фактура' }).first().click();
  await page.waitForURL('**/fakturi/nova', { timeout: 20000 });
  await page.getByRole('button', { name: 'Нов клиент' }).click();
  const dialog = page.locator('mat-dialog-container');
  await dialog.waitFor({ state: 'visible' });
  await fill(dialog, 'Назив', 'ИНТЕЛ ОФИС ДОО СКОПЈЕ');
  await fill(dialog, 'ЕДБ', '4080012345678');
  await fill(dialog, 'Улица', 'Партизански одреди');
  await fill(dialog, 'Број', '12');
  await fill(dialog, 'Пошт. број', '1000');
  await fill(dialog, 'Град', 'Скопје');
  await fill(dialog, 'Е-пошта', 'smetkovodstvo@intelofis.mk');
  await page.waitForTimeout(200);
  await shot(page, '05-client-dialog');
  await dialog.getByRole('button', { name: 'Додади клиент' }).click();
  await dialog.waitFor({ state: 'detached', timeout: 15000 });

  await fill(page, 'Опис', 'Проектантски услуги за објект „Аеродром“');
  const items = page.locator('.item');
  await items.nth(0).locator('input[type="number"]').first().fill('12');
  await fill(page, 'Цена без ДДВ', '4500');

  // second line, entered with VAT included
  await page.getByRole('button', { name: 'Додади ставка' }).click();
  await page.waitForTimeout(300);
  const second = page.locator('.item').nth(1);
  await second.getByLabel('Опис', { exact: true }).fill('Надзор на изведба');
  await second.locator('input[type="number"]').first().fill('1');
  await second.getByLabel('Цена без ДДВ', { exact: true }).fill('35400');
  await page.waitForTimeout(500);
  await shot(page, '06-editor', { fullPage: true });

  await page.getByRole('button', { name: 'Провери УЈП документ' }).click();
  const ujp = page.locator('mat-dialog-container');
  await ujp.waitFor({ state: 'visible' });
  await page.waitForTimeout(500);
  await shot(page, '07-ujp-check');
  await ujp.getByRole('tab', { name: 'JSON' }).click();
  await page.waitForTimeout(400);
  await shot(page, '08-ujp-json');
  await ujp.getByRole('button', { name: 'Затвори' }).click();
  await ujp.waitFor({ state: 'detached' });

  // --- issue --------------------------------------------------------------
  await page.getByRole('button', { name: 'Издај' }).click();
  const confirm = page.locator('mat-dialog-container');
  await confirm.waitFor({ state: 'visible' });
  await page.waitForTimeout(600); // let the dialog finish animating in
  await confirm.getByRole('button', { name: 'Издај' }).click();
  await confirm.waitFor({ state: 'detached', timeout: 20000 });
  await page.waitForTimeout(1500);
  await shot(page, '09-issued', { fullPage: true });

  // the printable document
  await page.emulateMedia({ media: 'print' });
  await page.waitForTimeout(500);
  await shot(page, '10-print', { fullPage: true });
  const printVisible = await page.locator('app-invoice-print .sheet').isVisible();
  const editorHidden = !(await page.locator('.editor').isVisible());
  console.log('print sheet visible:', printVisible, '| editor hidden:', editorHidden);
  const printedTotal = await page.locator('.totals__grand td').textContent();
  console.log('printed grand total:', printedTotal?.trim());
  await page.emulateMedia({ media: 'screen' });

  // --- list ---------------------------------------------------------------
  await open(page, `${BASE}/fakturi`);
  await page.waitForTimeout(1800);
  await shot(page, '11-list');
  await page.locator('.filters__toggle').click();
  await page.waitForTimeout(400);
  await shot(page, '12-list-filters');

  await open(page, `${BASE}/klienti`);
  await page.waitForTimeout(1500);
  await shot(page, '13-clients');

  await open(page, `${BASE}/postavki`);
  await page.waitForTimeout(1500);
  await shot(page, '14-settings');

  // The share sheet, reached from the issued invoice.
  await open(page, `${BASE}/fakturi`);
  await page.waitForTimeout(900);
  await page.locator('.actions-col button').first().click();
  await page.waitForTimeout(400);
  await page.getByRole('menuitem', { name: 'Сподели' }).click();
  await page.locator('mat-dialog-container').waitFor({ state: 'visible' });
  await page.waitForTimeout(500);
  await shot(page, '17-share');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);

  // Renewal dialog, in its expired state.
  const shotsCompanyId = await page.evaluate(() =>
    localStorage.getItem('efaktura.activeCompanyId'),
  );
  const setPaidUntil = (companyId, paidUntil) =>
    fetch(
      `http://127.0.0.1:8080/v1/projects/demo-e-faktura/databases/(default)/documents/companies/${companyId}?updateMask.fieldPaths=subscription`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner' },
        body: JSON.stringify({
          fields: {
            subscription: {
              mapValue: {
                fields: {
                  paidUntil: { stringValue: paidUntil },
                  plan: { stringValue: 'paid' },
                  note: { stringValue: '' },
                },
              },
            },
          },
        }),
      },
    );

  if (shotsCompanyId) {
    await setPaidUntil(shotsCompanyId, '2020-01-01');
    await open(page, `${BASE}/fakturi`);
    await page.waitForTimeout(1600);
    await shot(page, '19-expired');
    await page.getByRole('button', { name: 'Обнови претплата' }).click();
    await page.locator('mat-dialog-container').waitFor({ state: 'visible' });
    await page.waitForTimeout(500);
    await shot(page, '20-renew');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
    // Put it back, or every later screen renders behind the paywall.
    await setPaidUntil(shotsCompanyId, '2099-01-01');
  }

  // Admin screen. Needs the /admins document that the console creates for real.
  // Auth persists in IndexedDB, so ask the Auth emulator for the uid instead.
  const uid = await fetch(
    'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-api-key',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: shotsEmail, password: 'lozinka123', returnSecureToken: true }),
    },
  )
    .then((r) => r.json())
    .then((b) => b.localId ?? null)
    .catch(() => null);
  if (uid) {
    await grantAdmin(uid);
    await open(page, `${BASE}/admin`);
    await page.waitForTimeout(1600);
    await shot(page, '18-admin');
  } else {
    console.log('  !! could not read uid — skipping admin shot');
  }

  // --- mobile -------------------------------------------------------------
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page, `${BASE}/fakturi`);
  await page.waitForTimeout(1800);
  await shot(page, '15-mobile-list');
  await page.locator('.cards .card__main').first().click();
  await page.waitForTimeout(1800);
  await shot(page, '16-mobile-invoice', { fullPage: true });

  // The editor's action row on a phone, where the labels used to disappear.
  await open(page, `${BASE}/fakturi/nova`);
  await page.waitForTimeout(1400);
  await shot(page, '16b-mobile-editor');

  console.log('\nDONE');
} catch (error) {
  console.error('FAILED:', error?.message ?? error);
  await page.screenshot({ path: `${OUT}/error.png`, fullPage: true }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
}
