/**
 * End-to-end smoke test.
 *
 * Drives the real app against the Firebase Emulator Suite and walks the whole
 * first-run path: register, onboard a company, add a client, build an invoice,
 * check the totals the UI shows, issue it, and confirm it lands in the list.
 *
 * Run with the dev server on :4200 and `npm run emulators` already up:
 *   node e2e/smoke.spec.mjs
 *
 * Uses the locally installed Chrome (`channel: 'chrome'`) so no browser
 * download is needed.
 */
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL ?? 'http://localhost:4200';
const HEADLESS = process.env.HEADED !== '1';

const results = [];
let failures = 0;

function check(name, condition, detail = '') {
  if (condition) {
    results.push(`  PASS  ${name}`);
  } else {
    failures++;
    results.push(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function step(name) {
  results.push(`\n[${name}]`);
}

/**
 * Types into a Material field located by its exact label.
 *
 * Exactness matters: a substring match for "Број" also hits "ДДВ број" and
 * "Пошт. број", which silently fills the wrong control.
 */
async function fillByLabel(scope, label, value) {
  const input = scope.getByLabel(label, { exact: true }).first();
  await input.waitFor({ state: 'visible', timeout: 15000 });
  await input.fill(String(value));
  return input;
}

/**
 * Navigates, retrying past Vite's error overlay.
 *
 * The dev server rebuilds on every save, and a page loaded during a rebuild
 * keeps the overlay pinned on top — where it swallows every click and makes
 * the whole run fail for a reason that has nothing to do with the app.
 */
async function open(page, url) {
  for (let attempt = 0; attempt < 6; attempt++) {
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(500);
    const overlay = await page.locator('vite-error-overlay').count();
    if (!overlay) return;
    await page.waitForTimeout(2500);
  }
  throw new Error('dev server is still reporting a build error');
}


const PROJECT = 'demo-e-faktura';
const FIRESTORE = `http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents`;
const AUTH = `http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts`;

/** Signs in against the Auth emulator to get a real ID token for rule tests. */
async function idTokenFor(email, password) {
  const res = await fetch(`${AUTH}:signInWithPassword?key=demo-api-key`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  const body = await res.json();
  return body.idToken;
}

/** Writes a subscription straight into Firestore, bypassing rules as owner. */
async function setSubscription(companyId, paidUntil, plan = 'paid') {
  const url =
    `${FIRESTORE}/companies/${companyId}` +
    `?updateMask.fieldPaths=subscription&currentDocument.exists=true`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner' },
    body: JSON.stringify({
      fields: {
        subscription: {
          mapValue: {
            fields: {
              paidUntil: { stringValue: paidUntil },
              plan: { stringValue: plan },
              note: { stringValue: '' },
            },
          },
        },
      },
    }),
  });
  return res.status;
}

/**
 * Tries to create an invoice as the signed-in *user*, so the security rules
 * decide. This is the only check that proves the paywall exists anywhere other
 * than in the UI.
 */
async function tryCreateInvoice(idToken, companyId, docId) {
  const res = await fetch(`${FIRESTORE}/companies/${companyId}/invoices?documentId=${docId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
    body: JSON.stringify({ fields: { companyId: { stringValue: companyId } } }),
  });
  return res.status;
}

/**
 * Content wider than the viewport makes mobile browsers render a page zoomed in
 * and clipped. It is invisible on a desktop screen, so it has to be measured.
 */
async function horizontalOverflow(page) {
  return page.evaluate(() => {
    const de = document.documentElement;
    return de.scrollWidth - de.clientWidth;
  });
}

const run = async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: HEADLESS });
  const context = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  const page = await context.newPage();

  const consoleErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (error) => consoleErrors.push(String(error)));

  try {
    // --- 1. register -------------------------------------------------------
    step('Registration');
    const email = `test-${Date.now()}@efaktura.local`;
    await open(page, `${BASE}/najava`);

    check('login page renders', await page.locator('h1', { hasText: 'е-Фактура' }).isVisible());

    await page.getByRole('button', { name: 'Создадете нова сметка' }).click();
    await fillByLabel(page, 'Име и презиме', 'Тест Корисник');
    await fillByLabel(page, 'Е-пошта', email);
    await fillByLabel(page, 'Лозинка', 'lozinka123');
    await page.getByRole('button', { name: 'Создај сметка' }).click();

    await page.waitForURL('**/registracija', { timeout: 25000 });
    check('new user is sent to onboarding', page.url().includes('/registracija'));

    // --- 2. onboarding -----------------------------------------------------
    step('Onboarding');
    await fillByLabel(page, 'Назив на фирма', 'ТЕСТ КОМПАНИЈА ДООЕЛ СКОПЈЕ');
    await fillByLabel(page, 'ЕДБ (даночен број)', '4030995135699');
    await page.getByRole('button', { name: 'Продолжи' }).click();

    await fillByLabel(page, 'Улица', 'Орце Николов');
    await fillByLabel(page, 'Број', '133');
    await fillByLabel(page, 'Поштенски број', '1000');
    await fillByLabel(page, 'Град', 'Скопје');
    await page.getByRole('button', { name: 'Продолжи' }).click();

    const preview = await page.locator('.preview__value').first().textContent();
    check('numbering preview shows the first number', preview?.trim() === '0001/2026', `got "${preview?.trim()}"`);

    await page.getByRole('button', { name: 'Зачувај и започни' }).click();
    await page.waitForURL('**/fakturi', { timeout: 25000 });
    check('onboarding lands on the invoice list', page.url().includes('/fakturi'));
    await page.locator('.empty, .table tbody tr').first().waitFor({ timeout: 20000 });
    check(
      'empty state is shown for a new company',
      await page.locator('.empty h2', { hasText: 'Сè уште нема фактури' }).isVisible(),
    );

    // --- 3. new invoice ----------------------------------------------------
    step('Invoice editor');
    await page.getByRole('link', { name: 'Нова фактура' }).first().click();
    await page.waitForURL('**/fakturi/nova', { timeout: 20000 });

    // create the buyer inline
    await page.getByRole('button', { name: 'Нов клиент' }).click();
    const dialog = page.locator('mat-dialog-container');
    await dialog.waitFor({ state: 'visible' });
    await fillByLabel(dialog, 'Назив', 'КУПУВАЧ ДОО');
    await fillByLabel(dialog, 'ЕДБ', '4080012345678');
    await fillByLabel(dialog, 'Улица', 'Партизански одреди');
    await fillByLabel(dialog, 'Број', '12');
    await fillByLabel(dialog, 'Пошт. број', '1000');
    await fillByLabel(dialog, 'Град', 'Скопје');
    await page.waitForTimeout(400); // let the dialog settle before clicking
    await dialog.getByRole('button', { name: 'Додади клиент' }).click();
    await dialog.waitFor({ state: 'detached', timeout: 15000 });

    check(
      'client is attached to the invoice',
      (await page.locator('.party__name').textContent())?.includes('КУПУВАЧ ДОО'),
    );

    // line 1: 2 x 1000 net @ 18%
    await fillByLabel(page, 'Опис', 'Консултантски услуги');
    const qty = page.locator('.item').first().locator('input[type="number"]').first();
    await qty.fill('2');
    await fillByLabel(page, 'Цена без ДДВ', '1000');
    await page.waitForTimeout(400);

    const grand = (await page.locator('.totals__grand dd').textContent())?.trim();
    check('totals compute 2 × 1000 @ 18% = 2.360,00', grand?.startsWith('2.360,00'), `got "${grand}"`);

    const vatRow = await page.locator('.totals__sep dd').textContent();
    check('VAT total is 360,00', vatRow?.trim() === '360,00', `got "${vatRow?.trim()}"`);

    const words = (await page.locator('.in-words').textContent())?.trim();
    check(
      'amount in words is rendered in Macedonian',
      words?.includes('денари') && words?.includes('илјади'),
      `got "${words}"`,
    );

    // --- 4. UJP document preview ------------------------------------------
    step('UJP document');
    await page.getByRole('button', { name: 'Провери УЈП документ' }).click();
    const ujpDialog = page.locator('mat-dialog-container');
    await ujpDialog.waitFor({ state: 'visible' });
    // Wait for the tab body to actually render, otherwise "no issues shown"
    // is indistinguishable from "not painted yet".
    await ujpDialog.locator('.ok, .issues li').first().waitFor({ timeout: 15000 });

    const validationOk = await ujpDialog.locator('.ok strong').isVisible().catch(() => false);
    const reportedIssues = await ujpDialog.locator('.issues li').allTextContents();
    check('document passes local UJP validation', validationOk, reportedIssues.join(' | '));

    await ujpDialog.getByRole('tab', { name: 'JSON' }).click();
    const json = await ujpDialog.locator('pre.json code').textContent();
    const payload = JSON.parse(json ?? '{}');

    check('payload docType is 100', payload?.document?.header?.docType === '100');
    check(
      'seller VAT number carries the Cyrillic МК prefix',
      payload?.document?.seller?.sellerVatNumber === 'МК4030995135699',
      `got "${payload?.document?.seller?.sellerVatNumber}"`,
    );
    check(
      'seller country code is Latin MK',
      payload?.document?.seller?.sellerCCode === 'MK',
    );
    check(
      'line total without VAT is 2000',
      payload?.document?.docItems?.[0]?.docItemTotalPriceWoVat === 2000,
      `got ${payload?.document?.docItems?.[0]?.docItemTotalPriceWoVat}`,
    );
    check(
      'document VAT amount is 360',
      payload?.document?.docTotals?.docVatAmount === 360,
      `got ${payload?.document?.docTotals?.docVatAmount}`,
    );
    check(
      'gross rounded to whole денари is 2360',
      payload?.document?.docTotals?.docGrossAmountR === 2360,
    );
    check(
      'vatTotals has one 18% row',
      payload?.document?.vatTotals?.length === 1 &&
        payload.document.vatTotals[0].vatPercent === 18 &&
        payload.document.vatTotals[0].vatAmount === 360,
    );
    check(
      'requestTimestamp matches the UJP format',
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(payload?.requestTimestamp ?? ''),
      `got "${payload?.requestTimestamp}"`,
    );
    check(
      'submit button is disabled without a signer',
      await ujpDialog.getByRole('button', { name: 'Испрати до УЈП' }).isDisabled(),
    );

    await ujpDialog.getByRole('button', { name: 'Затвори' }).click();
    await ujpDialog.waitFor({ state: 'detached' });

    // --- 5. issue ----------------------------------------------------------
    step('Issuing');
    await page.getByRole('button', { name: 'Издај' }).click();
    const confirm = page.locator('mat-dialog-container');
    await confirm.waitFor({ state: 'visible' });
    await page.waitForTimeout(600); // let the dialog finish animating in
    await confirm.getByRole('button', { name: 'Издај' }).click();
    await confirm.waitFor({ state: 'detached', timeout: 20000 });

    await page.waitForTimeout(1500);
    const heading = await page.locator('.bar__title h1').textContent();
    check('invoice receives number 0001/2026', heading?.includes('0001/2026'), `got "${heading?.trim()}"`);
    check(
      'issued invoice is locked for editing',
      await page.getByRole('button', { name: 'Печати' }).isVisible(),
    );
    check(
      'status chip reads "Издадена"',
      (await page.locator('.bar__chips app-status-chip').first().textContent())?.trim() ===
        'Издадена',
      `got "${(await page.locator('.bar__chips app-status-chip').first().textContent())?.trim()}"`,
    );

    // --- 6. list -----------------------------------------------------------
    step('Invoice list');
    await open(page, `${BASE}/fakturi`);
    await page.waitForTimeout(1200);

    const rowCount = await page.locator('.table tbody tr').count();
    check('the issued invoice appears in the list', rowCount === 1, `rows: ${rowCount}`);

    const totalTile = await page.locator('.stat').first().locator('.stat__value').textContent();
    check('summary total is 2.360,00 ден.', totalTile?.includes('2.360,00'), `got "${totalTile?.trim()}"`);

    // An issued invoice keeps УЈП status "00" until it is actually submitted,
    // so an outstanding figure keyed on status hid every unpaid invoice.
    const outstandingTile = await page
      .locator('.stat')
      .nth(2)
      .locator('.stat__value')
      .textContent();
    check(
      'unpaid issued invoice counts as outstanding',
      outstandingTile?.includes('2.360,00'),
      `got "${outstandingTile?.trim()}"`,
    );

    // filtering
    await fillByLabel(page, 'Барај по број, клиент, ЕДБ…', 'непостоечки');
    await page.waitForTimeout(300);
    check(
      'search with no matches shows the empty state',
      await page.locator('.empty h2', { hasText: 'Нема резултати' }).isVisible(),
    );

    await page.locator('.filters__search input').fill('КУПУВАЧ');
    await page.waitForTimeout(300);
    check(
      'search by client name finds the invoice',
      (await page.locator('.table tbody tr').count()) === 1,
    );

    // --- 7. mobile ---------------------------------------------------------
    step('Mobile layout');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(600);
    check('bottom tab bar appears on a phone', await page.locator('.tabbar').isVisible());
    check('card list replaces the table', await page.locator('.cards .card').first().isVisible());
    check('desktop rail is hidden', !(await page.locator('.rail').isVisible().catch(() => false)));

    // Narrowest common Android width. Anything past the viewport here is what
    // made the login screen open zoomed in and cut off on a real phone.
    await page.setViewportSize({ width: 360, height: 780 });
    for (const path of ['/fakturi', '/klienti', '/postavki']) {
      await open(page, `${BASE}${path}`);
      await page.waitForTimeout(900);
      const overflow = await horizontalOverflow(page);
      check(`${path} fits a 360px screen`, overflow <= 0, `${overflow}px too wide`);
    }

    // --- 8. sharing --------------------------------------------------------
    step('Sharing');
    await page.setViewportSize({ width: 1440, height: 950 });
    await open(page, `${BASE}/fakturi`);
    await page.waitForTimeout(1000);

    await page.locator('.actions-col button').first().click();
    await page.waitForTimeout(400);
    await page.getByRole('menuitem', { name: 'Сподели' }).click();
    const shareDialog = page.locator('mat-dialog-container');
    await shareDialog.waitFor({ state: 'visible' });
    await page.waitForTimeout(400);

    const shareText = await shareDialog.locator('textarea').inputValue();
    check('share message names the invoice', shareText.includes('0001/2026'), shareText.slice(0, 60));
    check('share message carries the amount', shareText.includes('2.360,00 MKD'), shareText.slice(0, 120));
    check('share message states the deadline', /Рок на плаќање: \d{2}\.\d{2}\.\d{4}/.test(shareText));
    check(
      'WhatsApp and Viber channels are offered',
      (await shareDialog.getByRole('button', { name: 'WhatsApp' }).count()) === 1 &&
        (await shareDialog.getByRole('button', { name: 'Viber' }).count()) === 1,
    );
    check(
      'e-mail is disabled until an address is known',
      await shareDialog.getByRole('button', { name: 'Е-пошта' }).isDisabled(),
    );

    await shareDialog.getByRole('button', { name: 'Затвори' }).click();
    await shareDialog.waitFor({ state: 'detached' });

    // --- 9. the paywall ----------------------------------------------------
    step('Subscription');
    const companyId = await page.evaluate(() =>
      localStorage.getItem('efaktura.activeCompanyId'),
    );
    const idToken = await idTokenFor(email, 'lozinka123');
    check('company id and user token are available', !!companyId && !!idToken);

    // A new company is inside its trial, so the rules must allow a write.
    const whileActive = await tryCreateInvoice(idToken, companyId, 'probe-active');
    check('rules allow creating while subscribed', whileActive === 200, `HTTP ${whileActive}`);

    await setSubscription(companyId, '2020-01-01');
    const whileExpired = await tryCreateInvoice(idToken, companyId, 'probe-expired');
    check(
      'rules refuse creating once lapsed',
      whileExpired === 403,
      `HTTP ${whileExpired} — the paywall is UI-only!`,
    );

    // The promise that matters: an unpaid customer keeps their records.
    await open(page, `${BASE}/fakturi`);
    await page.waitForTimeout(1500);
    check(
      'existing invoices stay readable after expiry',
      (await page.locator('.table tbody tr').count()) >= 1,
    );
    check(
      'export stays available after expiry',
      await page.getByRole('button', { name: 'Извези' }).isEnabled(),
    );
    check(
      'the expiry banner explains what stopped',
      (await page.locator('.sub-banner').textContent())?.includes('истече'),
    );
    check(
      'the new invoice button is disabled',
      await page.locator('.new-invoice').first().isDisabled(),
    );

    await open(page, `${BASE}/fakturi/nova`);
    await page.waitForTimeout(1200);
    check(
      'the new invoice route redirects away',
      !page.url().includes('/nova'),
      `landed on ${page.url()}`,
    );

    // A user may not lift their own paywall from the browser.
    const selfGrant = await fetch(
      `${FIRESTORE}/companies/${companyId}?updateMask.fieldPaths=subscription`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({
          fields: {
            subscription: {
              mapValue: {
                fields: {
                  paidUntil: { stringValue: '2099-01-01' },
                  plan: { stringValue: 'paid' },
                  note: { stringValue: '' },
                },
              },
            },
          },
        }),
      },
    );
    check(
      'a user cannot extend their own subscription',
      selfGrant.status === 403,
      `HTTP ${selfGrant.status}`,
    );

    // An expired banner that does not say how to pay is a dead end.
    await page.getByRole('button', { name: 'Обнови претплата' }).click();
    const renew = page.locator('mat-dialog-container');
    await renew.waitFor({ state: 'visible' });
    await page.waitForTimeout(400);
    const renewText = (await renew.innerText()).replace(/\s+/g, ' ');
    check('the renewal dialog names a price', renewText.includes('6.000 ден.'), renewText.slice(0, 80));
    check('it gives an account to pay into', renewText.includes('200004007076491'));
    check('it gives a payment reference', renewText.includes('4030995135699'));
    check('it offers a way to reach a human', renewText.includes('@'));
    check(
      'requesting an invoice is the primary action',
      await renew.getByRole('button', { name: 'Побарај фактура' }).isVisible(),
    );
    await renew.getByRole('button', { name: 'Затвори' }).click();
    await renew.waitFor({ state: 'detached' });

    // Put it back so the remaining steps run against a working account.
    await setSubscription(companyId, '2099-01-01');
    await open(page, `${BASE}/fakturi`);
    await page.waitForTimeout(1200);

    // --- 10. deleting a mistake -------------------------------------------
    step('Delete');
    await page.locator('.actions-col button').first().click();
    await page.waitForTimeout(400);
    check(
      'an unsubmitted issued invoice offers deletion',
      (await page.getByRole('menuitem', { name: 'Избриши фактура' }).count()) === 1,
    );
    await page.getByRole('menuitem', { name: 'Избриши фактура' }).click();

    const delConfirm = page.locator('mat-dialog-container');
    await delConfirm.waitFor({ state: 'visible' });
    await page.waitForTimeout(400);
    const warning = await delConfirm.locator('.message').textContent();
    check(
      'the dialog says the number comes back',
      warning?.includes('Бројот ќе се врати'),
      `got "${warning?.trim().slice(0, 90)}"`,
    );
    await delConfirm.getByRole('button', { name: 'Избриши' }).click();
    await delConfirm.waitFor({ state: 'detached', timeout: 20000 });
    await page.waitForTimeout(1500);

    check(
      'the invoice is gone from the list',
      await page.locator('.empty h2', { hasText: 'Сè уште нема фактури' }).isVisible(),
    );

    // Deleting the newest number must hand it back, or the invoice book gains
    // a gap that an inspection will ask about.
    await open(page, `${BASE}/postavki`);
    await page.getByRole('button', { name: /Нумерација/ }).first().click();
    await page.waitForTimeout(800);
    const nextNumber = (await page.locator('.preview__value').first().textContent())?.trim();
    check('the freed number is reused', nextNumber === '0001/2026', `got "${nextNumber}"`);

    // --- 11. a second company ---------------------------------------------
    step('Second company');
    await open(page, `${BASE}/fakturi`);
    await page.waitForTimeout(1000);

    await page.locator('.company-switch').click();
    await page.waitForTimeout(400);
    await page.getByRole('menuitem', { name: 'Нова фирма' }).click();
    await page.waitForURL('**/registracija**', { timeout: 20000 });
    check('the switcher can start another company', page.url().includes('nova=1'));
    check(
      'the wizard knows this is not first-run',
      (await page.locator('.wizard__header h1').textContent())?.includes('Нова фирма'),
    );

    await fillByLabel(page, 'Назив на фирма', 'ВТОРА ФИРМА ДООЕЛ');
    await fillByLabel(page, 'ЕДБ (даночен број)', '4057015512345');
    await page.getByRole('button', { name: 'Продолжи' }).click();
    await fillByLabel(page, 'Улица', 'Македонија');
    await fillByLabel(page, 'Број', '5');
    await fillByLabel(page, 'Поштенски број', '1000');
    await fillByLabel(page, 'Град', 'Скопје');
    await page.getByRole('button', { name: 'Продолжи' }).click();
    await page.getByRole('button', { name: 'Зачувај фирма' }).click();

    await page.waitForURL('**/fakturi', { timeout: 25000 });
    await page.waitForTimeout(1800);
    check(
      'the new company becomes the active one',
      (await page.locator('.company-switch__name').textContent())?.includes('ВТОРА ФИРМА'),
    );

    await page.locator('.company-switch').click();
    await page.waitForTimeout(500);
    const switcherItems = await page.locator('.mat-mdc-menu-content button, .mat-mdc-menu-content a').allTextContents();
    check(
      'both companies are listed in the switcher',
      switcherItems.some((t) => t.includes('ВТОРА ФИРМА')) &&
        switcherItems.some((t) => t.includes('ТЕСТ КОМПАНИЈА')),
      switcherItems.join(' | '),
    );
    await page.keyboard.press('Escape');

    // --- 12. sign out ------------------------------------------------------
    step('Sign out');
    await page.setViewportSize({ width: 390, height: 844 });
    await open(page, `${BASE}/fakturi`);
    await page.waitForTimeout(1200);

    // The editor's actions must stay readable on a phone, not collapse to a
    // lone floppy disk and tick.
    await open(page, `${BASE}/fakturi/nova`);
    await page.waitForTimeout(1200);
    const actionLabels = (await page.locator('.bar__actions').innerText()).replace(/\s+/g, ' ');
    check(
      'editor actions keep their labels on a phone',
      actionLabels.includes('Зачувај') && actionLabels.includes('Издај'),
      `got "${actionLabels}"`,
    );
    check(
      'the new-invoice button keeps a word next to the +',
      (await page.locator('.new-invoice').first().innerText()).trim().length > 1,
    );

    await open(page, `${BASE}/fakturi`);
    await page.waitForTimeout(1000);
    await page.locator('.topbar button[aria-label="Сметка"]').click();
    await page.waitForTimeout(500);

    // One click, not two: signing out used to resolve before the auth state
    // flipped, so guestGuard bounced the redirect straight back.
    await page.getByRole('menuitem', { name: 'Одјава' }).click();
    await page.waitForURL('**/najava**', { timeout: 15000 }).catch(() => {});
    check(
      'one click on Одјава reaches the login screen',
      page.url().includes('/najava'),
      `landed on ${page.url()}`,
    );

    // --- console -----------------------------------------------------------
    step('Console');
    const realErrors = consoleErrors.filter(
      (e) =>
        !e.includes('favicon') &&
        !e.includes('Download the React DevTools') &&
        !e.toLowerCase().includes('font'),
    );
    check('no console errors', realErrors.length === 0, realErrors.slice(0, 3).join(' | '));
  } catch (error) {
    failures++;
    results.push(`\n  FAIL  exception: ${error?.message ?? error}`);
    await page.screenshot({ path: 'e2e/failure.png', fullPage: true }).catch(() => {});
  } finally {
    await browser.close();
  }

  console.log(results.join('\n'));
  console.log(`\n${failures === 0 ? 'ALL PASSED' : `${failures} FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
};

run();
