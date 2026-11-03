/**
 * End-to-end smoke test.
 *
 * Drives the real app against the Firebase Emulator Suite and walks the whole
 * first-run path: register, onboard a company, add a client, build an invoice,
 * check the totals the UI shows, issue it, and confirm it lands in the list —
 * then drafts that save themselves, the print settings, and the modules.
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

/** The uid inside an ID token — enough for the emulator, no verification needed. */
function uidOf(idToken) {
  return JSON.parse(Buffer.from(idToken.split('.')[1], 'base64url').toString()).user_id;
}

/** Writes fields straight into a document as owner, bypassing the rules. */
async function ownerPatch(path, fields) {
  const mask = Object.keys(fields).map((f) => `updateMask.fieldPaths=${f}`).join('&');
  const res = await fetch(`${FIRESTORE}/${path}?${mask}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner' },
    body: JSON.stringify({ fields }),
  });
  return res.status;
}

/** `{ catalog: true }` as a Firestore REST map value. */
function modulesValue(modules) {
  return {
    mapValue: {
      fields: Object.fromEntries(Object.entries(modules).map(([k, v]) => [k, { booleanValue: v }])),
    },
  };
}

/** Tries to switch a module on as the signed-in *user* — the rules must refuse. */
async function setModulesAs(idToken, companyId, modules) {
  const res = await fetch(`${FIRESTORE}/companies/${companyId}?updateMask.fieldPaths=modules`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
    body: JSON.stringify({ fields: { modules: modulesValue(modules) } }),
  });
  return res.status;
}

/** Tries to write a price-list entry as the user, so the module switch is what decides. */
async function tryWriteCatalog(idToken, companyId, docId) {
  const res = await fetch(`${FIRESTORE}/companies/${companyId}/catalog?documentId=${docId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
    body: JSON.stringify({ fields: { name: { stringValue: 'probe' } } }),
  });
  return res.status;
}

/** Grants or revokes the operator role, the way the Firebase console does. */
async function setAdmin(uid, on) {
  const res = on
    ? await fetch(`${FIRESTORE}/admins?documentId=${uid}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner' },
        body: JSON.stringify({ fields: { grantedAt: { integerValue: String(Date.now()) } } }),
      })
    : await fetch(`${FIRESTORE}/admins/${uid}`, {
        method: 'DELETE',
        headers: { Authorization: 'Bearer owner' },
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

  // The browser logs every failed request as a console error with no URL. The
  // Password step deliberately sends a wrong password, so one 400 from the
  // sign-in endpoint is expected — recorded here so that is the *only* kind of
  // 400 the Console check lets through.
  const failedRequests = [];
  page.on('response', (response) => {
    if (response.status() >= 400) failedRequests.push(`${response.status()} ${response.url()}`);
  });

  try {
    // --- 1. register -------------------------------------------------------
    step('Registration');
    const email = `test-${Date.now()}@efaktura.local`;
    // The rules allow one company per ЕДБ and a long-lived emulator keeps every
    // run's companies, so each run needs ЕДБs of its own.
    const runDigits = String(Date.now()).slice(-9);
    const edb = `4030${runDigits}`;
    const secondEdb = `4057${runDigits}`;
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
    await fillByLabel(page, 'ЕДБ (даночен број)', edb);
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
      payload?.document?.seller?.sellerVatNumber === `МК${edb}`,
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

    // --- 5b. a number already out is never handed out again ----------------
    step('Duplicate numbers');
    // The counter set back under 0001/2026 — the way a mid-month switch to a
    // monthly reset, or a typo in Поставки, used to repeat a number.
    const numberingCompanyId = await page.evaluate(() =>
      localStorage.getItem('efaktura.activeCompanyId'),
    );
    const setNextSeq = (n) =>
      fetch(
        `${FIRESTORE}/companies/${numberingCompanyId}?updateMask.fieldPaths=numbering.nextSeq`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner' },
          body: JSON.stringify({
            fields: { numbering: { mapValue: { fields: { nextSeq: { integerValue: String(n) } } } } },
          }),
        },
      );
    await setNextSeq(1);
    await page.waitForTimeout(800);

    await page.locator('button[aria-label="Повеќе"]').first().click();
    await page.getByRole('menuitem', { name: 'Зачувај како нова' }).click();
    // The copy saves itself and trades /nova for its own address at once.
    await page.locator('.bar__title h1', { hasText: 'Нова фактура' }).waitFor({ timeout: 20000 });
    await page.locator('.item').first().waitFor({ timeout: 15000 });
    await page.waitForTimeout(800);
    await page.getByRole('button', { name: 'Издај' }).click();
    const repeatConfirm = page.locator('mat-dialog-container');
    await repeatConfirm.waitFor({ state: 'visible' });
    await page.waitForTimeout(600);
    await repeatConfirm.getByRole('button', { name: 'Издај' }).click();
    await repeatConfirm.waitFor({ state: 'detached', timeout: 20000 });
    const repeatNotice = page
      .locator('.mat-mdc-snack-bar-label', { hasText: 'веќе го има друга фактура' })
      .last();
    await repeatNotice.waitFor({ timeout: 15000 }).catch(() => {});
    check('a number another invoice holds is refused at issue', await repeatNotice.isVisible());
    check(
      'and the invoice stays a draft',
      await page.getByRole('button', { name: 'Издај' }).isVisible(),
    );

    // Put things back: drop the copy, and the counter where it belongs.
    await page.locator('button[aria-label="Повеќе"]').first().click();
    await page.getByRole('menuitem', { name: 'Избриши нацрт' }).click();
    const copyConfirm = page.locator('mat-dialog-container');
    await copyConfirm.waitFor({ state: 'visible' });
    await page.waitForTimeout(400);
    await copyConfirm.getByRole('button', { name: 'Избриши' }).click();
    await page.waitForURL('**/fakturi', { timeout: 15000 });
    await setNextSeq(2);
    await page.waitForTimeout(800);

    // Поставки refuses the settings that would get there in the first place.
    await open(page, `${BASE}/postavki`);
    await page.getByRole('button', { name: /Нумерација/ }).first().click();
    await page.waitForTimeout(800);
    const numberingPanel = page
      .locator('mat-expansion-panel')
      .filter({ hasText: 'Ресетирање на бројачот' });
    const numberingError = numberingPanel.locator('.numbering-error');
    const saveNumbering = numberingPanel.getByRole('button', { name: 'Зачувај' });

    await numberingPanel.locator('.presets .chip').filter({ hasText: /^\s*0001\s*$/ }).click();
    await page.waitForTimeout(300);
    check(
      'a plain running number may not restart every year',
      (await numberingError.count()) === 1 &&
        (await numberingError.innerText()).includes('годината') &&
        (await saveNumbering.isDisabled()),
    );
    await numberingPanel.locator('.presets .chip').filter({ hasText: /^\s*0001\/2026\s*$/ }).click();
    await numberingPanel.getByLabel('Ресетирање на бројачот').click();
    await page.getByRole('option', { name: 'Секој месец' }).click();
    await page.waitForTimeout(300);
    check(
      'nor may a monthly counter leave the month out',
      (await numberingError.count()) === 1 &&
        (await numberingError.innerText()).includes('месецот') &&
        (await saveNumbering.isDisabled()),
    );
    await numberingPanel.getByLabel('Ресетирање на бројачот').click();
    await page.getByRole('option', { name: 'Секоја година' }).click();
    await page.waitForTimeout(300);
    check('a valid format clears the warning', (await numberingError.count()) === 0);

    // 0001/2026 is out, so the counter may not go back to 1.
    const nextSeqField = numberingPanel.getByLabel('Следен реден број');
    check('the counter shows the next number', (await nextSeqField.inputValue()) === '2');
    await nextSeqField.fill('1');
    await saveNumbering.click();
    await numberingError.waitFor({ timeout: 15000 }).catch(() => {});
    check(
      'a counter set back under an issued number is refused',
      (await numberingError.count()) === 1 &&
        (await numberingError.innerText()).includes('најмалку 2'),
    );
    check('and put right', (await nextSeqField.inputValue()) === '2');
    const savedNumbering = await fetch(`${FIRESTORE}/companies/${numberingCompanyId}`, {
      headers: { Authorization: 'Bearer owner' },
    }).then((res) => res.json());
    check(
      'nothing was saved',
      savedNumbering.fields?.numbering?.mapValue?.fields?.nextSeq?.integerValue === '2',
      JSON.stringify(savedNumbering.fields?.numbering?.mapValue?.fields?.nextSeq),
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

    // --- 6b. payments ------------------------------------------------------
    step('Payments');
    await page.locator('.filters__search input').fill('');
    await page.waitForTimeout(300);

    const invoiceDocs = await fetch(`${FIRESTORE}/companies/${numberingCompanyId}:runQuery`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner' },
      body: JSON.stringify({
        structuredQuery: {
          from: [{ collectionId: 'invoices' }],
          where: {
            fieldFilter: {
              field: { fieldPath: 'number' },
              op: 'EQUAL',
              value: { stringValue: '0001/2026' },
            },
          },
        },
      }),
    }).then((res) => res.json());
    const issuedDoc = invoiceDocs.find((row) => row.document)?.document;
    const issuedPath = issuedDoc.name.split('/documents/')[1];
    const readIssued = () =>
      fetch(`${FIRESTORE}/${issuedPath}`, { headers: { Authorization: 'Bearer owner' } })
        .then((res) => res.json())
        .then((d) => d.fields);
    const dmy = (date) =>
      `${String(date.getDate()).padStart(2, '0')}.${String(date.getMonth() + 1).padStart(2, '0')}.${date.getFullYear()}`;
    const iso = (date) =>
      `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

    // Overdue: the tile counted the invoice, but the row never showed it while
    // УЈП had no copy — which, with sending not wired up, was every invoice.
    const originalDue = issuedDoc.fields.dueDate.stringValue;
    await ownerPatch(issuedPath, { dueDate: { stringValue: `${new Date().getFullYear()}-01-02` } });
    await page.waitForTimeout(1200);
    const listRow = page.locator('.table tbody tr').first();
    check('an overdue issued invoice is marked in its row', (await listRow.locator('.overdue-icon').count()) === 1);

    // The tiles narrow the list to what is still owed.
    const overdueTile = page.locator('button.stat', { hasText: 'Во доцнење' });
    const owedTile = page.locator('button.stat', { hasText: 'Ненаплатено' });
    await overdueTile.click();
    await page.waitForTimeout(300);
    check(
      'the overdue tile shows only overdue invoices',
      (await overdueTile.getAttribute('aria-pressed')) === 'true' &&
        (await page.locator('.table tbody tr').count()) === 1 &&
        (await page.locator('.focus-note').innerText()).includes('во доцнење'),
    );
    await page.getByRole('button', { name: 'Прикажи ги сите' }).click();
    await page.waitForTimeout(300);
    check('and "Прикажи ги сите" shows everything again', (await page.locator('.focus-note').count()) === 0);
    await owedTile.click();
    await page.waitForTimeout(300);
    check(
      'the outstanding tile shows only unpaid invoices',
      (await owedTile.getAttribute('aria-pressed')) === 'true' &&
        (await page.locator('.table tbody tr').count()) === 1,
    );
    await owedTile.click();
    await page.waitForTimeout(300);
    check('pressing it again turns it off', (await owedTile.getAttribute('aria-pressed')) === 'false');
    await ownerPatch(issuedPath, { dueDate: { stringValue: originalDue } });
    await page.waitForTimeout(800);

    // Marking paid from the badge, on the day the money actually arrived.
    const yesterday = new Date(Date.now() - 86_400_000);
    const payMenu = page.locator('.pay-menu');
    await listRow.locator('.pay-trigger').click();
    await payMenu.waitFor({ state: 'visible' });
    await page.waitForTimeout(300);
    check(
      'the badge opens a payment form for the full amount',
      (await payMenu.getByLabel('Вкупно платено').inputValue()) === '2360',
      await payMenu.getByLabel('Вкупно платено').inputValue(),
    );
    await payMenu.getByLabel('Платено на').fill(dmy(yesterday));
    await payMenu.getByLabel('Платено на').press('Tab');
    check('Tab moves within the form instead of closing it', await payMenu.isVisible());
    await payMenu.getByRole('button', { name: 'Означи платена' }).click();
    await payMenu.waitFor({ state: 'detached', timeout: 15000 });
    await page.waitForTimeout(800);
    check(
      'the row shows it paid, and when',
      (await listRow.locator('.pay-trigger').innerText()).includes('Платена') &&
        (await listRow.locator('.pay-date').innerText()).includes(dmy(yesterday)),
    );
    const paidFields = await readIssued();
    check(
      'it is stored as paid on that day',
      paidFields.paymentStatus?.stringValue === 'paid' &&
        iso(new Date(Number(paidFields.paidAt?.integerValue))) === iso(yesterday),
    );

    // A wrong click costs nothing.
    const undo = page.locator('.mat-mdc-snack-bar-container').getByRole('button', { name: 'Врати' });
    await undo.click();
    await page.waitForTimeout(1200);
    check(
      '"Врати" puts it back',
      (await listRow.locator('.pay-trigger').innerText()).includes('Неплатена') &&
        (await readIssued()).paymentStatus?.stringValue === 'unpaid',
    );

    // Part of it.
    await listRow.locator('.pay-trigger').click();
    await payMenu.waitFor({ state: 'visible' });
    await page.waitForTimeout(300);
    await payMenu.getByLabel('Вкупно платено').fill('1000');
    await payMenu.getByRole('button', { name: 'Означи делумно платена' }).click();
    await payMenu.waitFor({ state: 'detached', timeout: 15000 });
    await page.waitForTimeout(800);
    check(
      'a smaller amount marks it partly paid',
      (await listRow.locator('.pay-trigger').innerText()).includes('Делумно'),
    );
    check(
      'and only the rest counts as outstanding',
      (await owedTile.locator('.stat__value').innerText()).includes('1.360,00'),
      await owedTile.locator('.stat__value').innerText(),
    );

    // On the invoice itself.
    await listRow.click();
    await page.waitForURL(/\/fakturi\/[^/]+$/, { timeout: 15000 });
    const paymentCard = page.locator('.card--payment');
    await paymentCard.waitFor({ timeout: 15000 });
    check(
      'an issued invoice has a Наплата panel that knows what is paid',
      (await paymentCard.innerText()).includes('Досега платено'),
    );
    await paymentCard.getByRole('button', { name: 'Означи платена' }).click();
    await page.waitForTimeout(1200);
    check(
      'it can be marked paid there',
      (await paymentCard.innerText()).includes('Платено 2.360,00') &&
        (await paymentCard.getByRole('button', { name: 'Измени' }).isVisible()),
    );
    await paymentCard.getByRole('button', { name: 'Измени' }).click();
    await paymentCard.getByRole('button', { name: 'Означи неплатена' }).click();
    await page.waitForTimeout(1200);
    check(
      'and back to unpaid',
      (await readIssued()).paymentStatus?.stringValue === 'unpaid' &&
        (await paymentCard.getByRole('button', { name: 'Означи платена' }).isVisible()),
    );
    await open(page, `${BASE}/fakturi`);
    await page.waitForTimeout(1000);

    // --- 7. mobile ---------------------------------------------------------
    step('Mobile layout');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(600);
    check('bottom tab bar appears on a phone', await page.locator('.tabbar').isVisible());
    check('card list replaces the table', await page.locator('.cards .card').first().isVisible());
    check(
      'the payment badge can be pressed on a phone too',
      await page.locator('.cards .card .pay-trigger').first().isVisible(),
    );
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

    // The admin screen's invoice count, short for a company that issued before
    // the counter existed, is put right the next time the company is opened.
    await ownerPatch(`companies/${companyId}`, {
      stats: {
        mapValue: {
          fields: { issuedCount: { integerValue: '99' }, lastIssuedAt: { nullValue: null } },
        },
      },
    });
    await open(page, `${BASE}/fakturi`);
    await page.waitForTimeout(2500);
    const recounted = await fetch(`${FIRESTORE}/companies/${companyId}`, {
      headers: { Authorization: 'Bearer owner' },
    }).then((res) => res.json());
    check(
      'a wrong invoice count is recounted from the invoices',
      recounted.fields?.stats?.mapValue?.fields?.issuedCount?.integerValue === '1',
      JSON.stringify(recounted.fields?.stats),
    );

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

    // Nor turn a paid company into a different one: the ЕДБ is fixed, so a
    // rename is still the same payer.
    const asToken = (method, body) => ({
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const retax = await fetch(
      `${FIRESTORE}/companies/${companyId}?updateMask.fieldPaths=taxNumber`,
      asToken('PATCH', { fields: { taxNumber: { stringValue: secondEdb } } }),
    );
    check('a user cannot change their own ЕДБ', retax.status === 403, `HTTP ${retax.status}`);
    const rename = await fetch(
      `${FIRESTORE}/companies/${companyId}?updateMask.fieldPaths=name`,
      asToken('PATCH', { fields: { name: { stringValue: 'ТЕСТ КОМПАНИЈА ДООЕЛ СКОПЈЕ' } } }),
    );
    check('the name stays editable', rename.status === 200, `HTTP ${rename.status}`);

    const claim = await fetch(`${FIRESTORE}/taxNumbers/${edb}`, {
      headers: { Authorization: 'Bearer owner' },
    }).then((res) => res.json());
    check(
      'onboarding claimed the ЕДБ for this company',
      claim.fields?.companyId?.stringValue === companyId,
      JSON.stringify(claim.fields ?? claim.error ?? {}),
    );
    const peek = await fetch(`${FIRESTORE}/taxNumbers/${edb}`, asToken('GET'));
    check('ЕДБ claims are unreadable to customers', peek.status === 403, `HTTP ${peek.status}`);

    // The claim is not optional, and cannot be made on the side.
    const unclaimed = await fetch(
      `${FIRESTORE}/companies?documentId=probe-unclaimed-${runDigits}`,
      asToken('POST', {
        fields: {
          ownerUid: { stringValue: uidOf(idToken) },
          memberUids: { arrayValue: { values: [{ stringValue: uidOf(idToken) }] } },
          taxNumber: { stringValue: `4099${runDigits}` },
          subscription: {
            mapValue: {
              fields: {
                paidUntil: { stringValue: '2099-01-01' },
                plan: { stringValue: 'trial' },
                note: { stringValue: '' },
              },
            },
          },
        },
      }),
    );
    check(
      'a company cannot be created without claiming its ЕДБ',
      unclaimed.status === 403,
      `HTTP ${unclaimed.status}`,
    );
    const sideClaim = await fetch(
      `${FIRESTORE}/taxNumbers?documentId=4098${runDigits}`,
      asToken('POST', {
        fields: {
          companyId: { stringValue: companyId },
          createdAt: { integerValue: String(Date.now()) },
        },
      }),
    );
    check(
      'an existing company cannot claim another ЕДБ',
      sideClaim.status === 403,
      `HTTP ${sideClaim.status}`,
    );

    // An expired banner that does not say how to pay is a dead end.
    await page.getByRole('button', { name: 'Обнови претплата' }).click();
    const renew = page.locator('mat-dialog-container');
    await renew.waitFor({ state: 'visible' });
    await page.waitForTimeout(400);
    const renewText = (await renew.innerText()).replace(/\s+/g, ' ');
    check('the renewal dialog names a price', renewText.includes('6.150 ден.'), renewText.slice(0, 80));
    check(
      'it does not suggest VAT on top',
      !renewText.includes('без ДДВ') && !renewText.includes('()'),
      renewText.slice(0, 120),
    );
    check('it gives an account to pay into', renewText.includes('200004007076491'));
    check('it gives a payment reference', renewText.includes(edb));
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

    // --- 10a. drafts save themselves --------------------------------------
    step('Drafts');
    await open(page, `${BASE}/fakturi`);
    await page.waitForTimeout(1000);
    await page.getByRole('link', { name: 'Нова фактура' }).first().click();
    await page.waitForURL('**/fakturi/nova', { timeout: 20000 });
    await fillByLabel(page.locator('.item').first(), 'Опис', 'Нацрт што не смее да се изгуби');
    await fillByLabel(page.locator('.item').first(), 'Цена без ДДВ', '700');
    const draftUrl = page.url();
    check(
      'a new invoice takes its own address on the first edit',
      /\/fakturi\/[^/]+$/.test(draftUrl) && !draftUrl.endsWith('/nova'),
      draftUrl,
    );

    // The reported bug: a quick look at another screen threw the invoice away.
    // Left at once, well inside the autosave delay.
    await page.locator('a[href="/klienti"]').first().click();
    await page.waitForURL('**/klienti', { timeout: 15000 });
    await page.goBack();
    await page.waitForURL(draftUrl, { timeout: 15000 });
    await page.locator('.item').first().waitFor({ timeout: 15000 });
    await page.waitForTimeout(800);
    check(
      'Back from another screen returns to the invoice as it was left',
      (await page.locator('.item').first().getByLabel('Опис', { exact: true }).inputValue()) ===
        'Нацрт што не смее да се изгуби',
    );
    check(
      'its price included',
      (await page.locator('.item').first().getByLabel('Цена без ДДВ', { exact: true }).inputValue()) === '700',
    );
    // A reopened draft has nothing unsaved to report; the next edit does.
    await fillByLabel(page.locator('.item').first(), 'Количина', '2');
    await page.waitForTimeout(2200);
    check(
      'the header says when an edit is saved',
      (await page.locator('.autosave').innerText()).includes('Зачувано'),
    );

    await open(page, `${BASE}/fakturi`);
    await page.waitForTimeout(1200);
    const draftRows = page.locator('.table tbody tr');
    check(
      'it is in the list as a draft',
      (await draftRows.count()) === 1 && (await draftRows.first().innerText()).includes('Нацрт'),
      `${await draftRows.count()} rows`,
    );

    // Deleting is final: an autosave still on its way must not bring it back.
    await draftRows.first().click();
    await page.waitForURL(draftUrl, { timeout: 15000 });
    await page.locator('.item').first().waitFor({ timeout: 15000 });
    await page.waitForTimeout(600);
    await fillByLabel(page.locator('.item').first(), 'Цена без ДДВ', '800');
    await page.locator('button[aria-label="Повеќе"]').first().click();
    await page.getByRole('menuitem', { name: 'Избриши нацрт' }).click();
    const draftConfirm = page.locator('mat-dialog-container');
    await draftConfirm.waitFor({ state: 'visible' });
    await page.waitForTimeout(400);
    await draftConfirm.getByRole('button', { name: 'Избриши' }).click();
    await page.waitForURL('**/fakturi', { timeout: 15000 });
    await page.waitForTimeout(2500);
    check(
      'a deleted draft stays deleted',
      await page.locator('.empty h2', { hasText: 'Сè уште нема фактури' }).isVisible(),
    );

    // --- 10b. printing ----------------------------------------------------
    step('Printing');
    // A wordmark-shaped logo larger than the print bounds, drawn in the page.
    const logoPng = await page.evaluate(() => {
      const canvas = document.createElement('canvas');
      canvas.width = 1800;
      canvas.height = 600;
      const context = canvas.getContext('2d');
      context.fillStyle = '#c62828';
      context.beginPath();
      context.arc(300, 300, 240, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = '#1a237e';
      context.font = 'bold 300px Arial';
      context.fillText('LOGO', 600, 410);
      return canvas.toDataURL('image/png').split(',')[1];
    });

    await open(page, `${BASE}/postavki`);
    await page.getByRole('button', { name: /Печатење/ }).click();
    await page.waitForTimeout(600);
    await page.locator('input[type="file"]').setInputFiles({
      name: 'logo.png',
      mimeType: 'image/png',
      buffer: Buffer.from(logoPng, 'base64'),
    });
    await page.locator('.paper__logo').waitFor({ timeout: 10000 });
    check('a picked logo shows in the preview before saving', await page.locator('.paper__logo').isVisible());
    await page.locator('mat-button-toggle', { hasText: 'Во средина' }).click();
    await page.getByRole('radio', { name: 'Фактура - испратница' }).check();
    await fillByLabel(page, 'Лице овластено за потпишување на фактури', 'Петар Петровски');
    await page.getByRole('radio', { name: /Купувач и број/ }).check();
    await page.waitForTimeout(400);
    check(
      'the preview follows the choices',
      (await page.locator('.paper__brand').isVisible()) &&
        (await page.locator('.paper__title').innerText()).trim() === 'ФАКТУРА - ИСПРАТНИЦА',
    );
    await page
      .locator('mat-expansion-panel', { has: page.locator('.print') })
      .getByRole('button', { name: 'Зачувај' })
      .click();
    await page.getByText('Зачувано.').first().waitFor({ timeout: 10000 });
    await page.waitForTimeout(800);

    const asOwner = { headers: { Authorization: 'Bearer owner' } };
    const printedCompany = await fetch(`${FIRESTORE}/companies/${companyId}`, asOwner).then((r) => r.json());
    const logoId = printedCompany.fields?.logoId?.stringValue;
    check('the company points at its new logo', !!logoId);
    const logoDoc = await fetch(`${FIRESTORE}/companies/${companyId}/logos/${logoId}`, asOwner).then((r) =>
      r.json(),
    );
    check(
      'the stored logo is a PNG shrunk to the print bounds',
      (logoDoc.fields?.dataUrl?.stringValue ?? '').startsWith('data:image/png;base64,') &&
        logoDoc.fields?.width?.integerValue === '960',
      `${logoDoc.fields?.width?.integerValue}×${logoDoc.fields?.height?.integerValue}`,
    );

    // A new invoice prints with all three.
    await page.getByRole('link', { name: 'Нова фактура' }).first().click();
    await page.waitForURL('**/fakturi/nova', { timeout: 20000 });
    const clientSearch = page.getByRole('combobox', { name: 'Пребарајте клиент по назив или ЕДБ' });
    await clientSearch.focus();
    await clientSearch.fill('КУПУВАЧ');
    await page.getByRole('option', { name: /КУПУВАЧ ДОО/ }).click();
    await fillByLabel(page.locator('.item').first(), 'Опис', 'Постер А2');
    await fillByLabel(page.locator('.item').first(), 'Цена без ДДВ', '250');
    await page.waitForTimeout(800);
    check(
      'the printout carries the chosen heading',
      (await page.locator('.doc__title').innerText()).trim() === 'ФАКТУРА - ИСПРАТНИЦА',
    );
    check(
      'and the logo, centred above the header',
      (await page.locator('.brand__logo').count()) === 1 && (await page.locator('.seller__logo').count()) === 0,
    );
    // Закон за ДДВ, чл. 53: name and signature of the person authorised to sign.
    const signatures = (await page.locator('.signatures').innerText()).replace(/\s+/g, ' ');
    check(
      'the signature line names the authorised person, as the VAT law asks',
      signatures.includes('Петар Петровски') &&
        signatures.includes('Лице овластено за потпишување на фактури') &&
        !signatures.includes('Издал'),
      signatures,
    );
    const pdfName = await page.evaluate(() => {
      window.dispatchEvent(new Event('beforeprint'));
      const name = document.title;
      window.dispatchEvent(new Event('afterprint'));
      return name;
    });
    check('Save as PDF is named after the buyer', pdfName === 'КУПУВАЧ ДОО - нацрт', pdfName);

    // The rules: a logo an invoice prints is never rewritten, and only a modest
    // raster image is accepted at all.
    const logoToken = await idTokenFor(email, 'lozinka123');
    const asUser = (method, body) => ({
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${logoToken}` },
      body: JSON.stringify(body),
    });
    const logoFields = (dataUrl) => ({
      fields: {
        dataUrl: { stringValue: dataUrl },
        width: { integerValue: '1' },
        height: { integerValue: '1' },
        createdAt: { integerValue: '0' },
        createdByUid: { stringValue: 'probe' },
      },
    });
    const rewrite = await fetch(
      `${FIRESTORE}/companies/${companyId}/logos/${logoId}?updateMask.fieldPaths=dataUrl`,
      asUser('PATCH', { fields: { dataUrl: { stringValue: 'data:image/png;base64,AAAA' } } }),
    );
    check('a stored logo cannot be rewritten', rewrite.status === 403, `HTTP ${rewrite.status}`);
    const svgLogo = await fetch(
      `${FIRESTORE}/companies/${companyId}/logos?documentId=probe-svg`,
      asUser('POST', logoFields('data:image/svg+xml;base64,PHN2Zz4=')),
    );
    check('an SVG logo is refused', svgLogo.status === 403, `HTTP ${svgLogo.status}`);
    const hugeLogo = await fetch(
      `${FIRESTORE}/companies/${companyId}/logos?documentId=probe-huge`,
      asUser('POST', logoFields(`data:image/png;base64,${'A'.repeat(360000)}`)),
    );
    check('an oversized logo is refused', hugeLogo.status === 403, `HTTP ${hugeLogo.status}`);

    // --- 10b2. advance invoices --------------------------------------------
    step('Advance invoices');
    const pickBuyer = async () => {
      const search = page.getByRole('combobox', { name: 'Пребарајте клиент по назив или ЕДБ' });
      await search.focus();
      await search.fill('КУПУВАЧ');
      await page.getByRole('option', { name: /КУПУВАЧ ДОО/ }).click();
    };
    const issueOnScreen = async () => {
      await page.getByRole('button', { name: 'Издај' }).click();
      const confirmIssue = page.locator('mat-dialog-container');
      await confirmIssue.waitFor({ state: 'visible' });
      await page.waitForTimeout(600);
      await confirmIssue.getByRole('button', { name: 'Издај' }).click();
      await confirmIssue.waitFor({ state: 'detached', timeout: 20000 });
      await page.waitForTimeout(1500);
    };

    // A 100.000 ден. job at 18%, half of it paid up front.
    await open(page, `${BASE}/fakturi/nova`);
    await page.waitForTimeout(1500);
    await page.locator('mat-button-toggle', { hasText: 'Авансна фактура' }).locator('button').click();
    await page.waitForTimeout(300);
    check(
      'a new document can be made an advance invoice',
      (await page.locator('.bar__title h1').innerText()).includes('Нова авансна фактура'),
    );
    await pickBuyer();
    await fillByLabel(page.locator('.item').first(), 'Опис', 'Аванс за изработка');
    await fillByLabel(page.locator('.item').first(), 'Цена без ДДВ', '50000');
    await page.waitForTimeout(800);
    check(
      'it prints as an advance invoice, whatever the usual heading',
      (await page.locator('.doc__title').innerText()).trim() === 'АВАНСНА ФАКТУРА',
    );
    check(
      'and asks for no payment',
      (await page.locator('.totals__grand dt').first().innerText()).includes('Примен аванс') &&
        !(await page.locator('.foot__left').innerText()).includes('Повикување на број'),
    );
    await issueOnScreen();
    const advanceTitle = (await page.locator('.bar__title h1').innerText()).trim();
    check('it is issued with a number', /^Авансна фактура \S+$/.test(advanceTitle), advanceTitle);
    const advanceNumber = advanceTitle.replace('Авансна фактура ', '');
    check(
      'and goes out paid, the money being already in',
      (await page.locator('.card--payment').innerText()).includes('Платено 59.000,00'),
    );

    // The invoice for the whole job offers the advance by itself.
    await open(page, `${BASE}/fakturi/nova`);
    await page.waitForTimeout(1500);
    await pickBuyer();
    await fillByLabel(page.locator('.item').first(), 'Опис', 'Изработка');
    await fillByLabel(page.locator('.item').first(), 'Цена без ДДВ', '100000');
    await page.waitForTimeout(800);
    const offer = page.locator('.advance-offer');
    check(
      'the next invoice for that client offers the advance',
      (await offer.count()) === 1 && (await offer.innerText()).includes(advanceNumber),
    );
    await offer.getByRole('button', { name: 'Одбиј ја од оваа фактура' }).click();
    await page.waitForTimeout(600);
    check(
      'one click deducts it, leaving 59.000,00 to pay',
      (await page.locator('.totals__grand dd').first().innerText()).startsWith('59.000,00') &&
        (await offer.count()) === 0,
    );
    check(
      'with the ДДВ it contained shown under it',
      (await page.locator('.card--totals .totals--sub dd').innerText()).trim() === '9.000,00',
    );
    check(
      'and the printout names the advance invoice',
      (await page.locator('table.totals').innerText()).includes(`по авансна фактура ${advanceNumber}`),
    );
    await issueOnScreen();

    // Deducted once, never offered again.
    await open(page, `${BASE}/fakturi/nova`);
    await page.waitForTimeout(1500);
    await pickBuyer();
    await page.waitForTimeout(800);
    check('a deducted advance is not offered again', (await page.locator('.advance-offer').count()) === 0);
    await page.locator('button[aria-label="Повеќе"]').first().click();
    await page.getByRole('menuitem', { name: 'Избриши нацрт' }).click();
    const leftover = page.locator('mat-dialog-container');
    await leftover.waitFor({ state: 'visible' });
    await page.waitForTimeout(400);
    await leftover.getByRole('button', { name: 'Избриши' }).click();
    await page.waitForURL('**/fakturi', { timeout: 15000 });
    await page.waitForTimeout(1000);
    check(
      'the list marks the advance invoice',
      (await page.locator('.table tbody tr', { hasText: advanceNumber }).locator('.doc-kind').count()) === 1,
    );

    // --- 10c. optional modules --------------------------------------------
    step('Modules');
    const userToken = await idTokenFor(email, 'lozinka123');

    // Off by default — and "off" has to mean more than a hidden menu entry.
    await open(page, `${BASE}/fakturi`);
    await page.waitForTimeout(1200);
    check(
      'the price list is not in the nav by default',
      (await page.locator('a[href="/cenovnik"]').count()) === 0,
    );
    await open(page, `${BASE}/cenovnik`);
    await page.waitForTimeout(1500);
    check(
      'its route is closed while the module is off',
      !page.url().includes('/cenovnik'),
      `landed on ${page.url()}`,
    );
    const writeWhileOff = await tryWriteCatalog(userToken, companyId, 'probe-off');
    check('rules refuse price-list writes while off', writeWhileOff === 403, `HTTP ${writeWhileOff}`);
    const selfEnable = await setModulesAs(userToken, companyId, { catalog: true });
    check('a user cannot switch a module on for themselves', selfEnable === 403, `HTTP ${selfEnable}`);

    // The operator switches it on from the admin screen. Company names repeat
    // across runs in a long-lived emulator, so this run's company gets a
    // unique e-mail to search the admin list by.
    await ownerPatch(`companies/${companyId}`, { email: { stringValue: email } });

    // A company from before ЕДБ claims existed. Until something claims its ЕДБ,
    // anyone could register that ЕДБ again for a fresh trial.
    const legacyId = `legacy-${runDigits}`;
    const legacyEdb = `4097${runDigits}`;
    // Not containing this run's e-mail, which the admin search below looks for.
    const legacyEmail = `old-${runDigits}@efaktura.local`;
    await fetch(`${FIRESTORE}/companies?documentId=${legacyId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner' },
      body: JSON.stringify({
        fields: {
          name: { stringValue: 'СТАРА ФИРМА ДООЕЛ' },
          taxNumber: { stringValue: legacyEdb },
          vatNumber: { stringValue: `МК${legacyEdb}` },
          email: { stringValue: legacyEmail },
          ownerUid: { stringValue: 'nobody' },
          memberUids: { arrayValue: { values: [] } },
          createdAt: { integerValue: '1' },
        },
      }),
    });

    await setAdmin(uidOf(userToken), true);
    await open(page, `${BASE}/admin`);
    await page.waitForTimeout(2500);
    await fillByLabel(page, 'Барај по назив или ЕДБ', email);
    await page.waitForTimeout(500);
    const adminRow = page.locator('table.table tbody tr');
    check(
      'the admin search finds exactly this company',
      (await adminRow.count()) === 1,
      `${await adminRow.count()} rows`,
    );
    await adminRow.first().locator('button[aria-label="Повеќе"]').click();
    await page.getByRole('menuitem', { name: 'Модули' }).click();
    const modulesDialog = page.locator('mat-dialog-container');
    await modulesDialog.waitFor({ state: 'visible' });
    await page.waitForTimeout(400);
    await modulesDialog.getByRole('switch', { name: 'Ценовник' }).click();
    await modulesDialog.getByRole('button', { name: 'Зачувај' }).click();
    await modulesDialog.waitFor({ state: 'detached', timeout: 15000 });
    await page.waitForTimeout(800);
    check(
      'the admin list shows the module on the company',
      (await adminRow.first().locator('.mod-chip', { hasText: 'Ценовник' }).count()) === 1,
    );

    const readClaim = (taxNumber) =>
      fetch(`${FIRESTORE}/taxNumbers/${taxNumber}`, {
        headers: { Authorization: 'Bearer owner' },
      }).then((res) => (res.status === 200 ? res.json() : null));
    check(
      'the admin screen claims an older company’s ЕДБ by itself',
      (await readClaim(legacyEdb))?.fields?.companyId?.stringValue === legacyId,
    );

    // Correcting an ЕДБ is the operator's job. One held by another company is
    // refused; a free one moves the claim and releases the old number.
    await fillByLabel(page, 'Барај по назив или ЕДБ', legacyEmail);
    await page.waitForTimeout(500);
    const openTaxDialog = async () => {
      await adminRow.first().locator('button[aria-label="Повеќе"]').click();
      await page.getByRole('menuitem', { name: 'Промени ЕДБ' }).click();
      const dialog = page.locator('mat-dialog-container');
      await dialog.waitFor({ state: 'visible' });
      await page.waitForTimeout(300);
      return dialog;
    };
    let taxDialog = await openTaxDialog();
    await fillByLabel(taxDialog, 'ЕДБ', edb);
    await taxDialog.getByRole('button', { name: 'Зачувај' }).click();
    await taxDialog.locator('.error').waitFor({ timeout: 15000 }).catch(() => {});
    check(
      'an ЕДБ another company holds is refused',
      (await taxDialog.locator('.error').count()) === 1 &&
        (await taxDialog.locator('.error').innerText()).includes('друга фирма'),
    );
    await taxDialog.getByRole('button', { name: 'Откажи' }).click();
    await taxDialog.waitFor({ state: 'detached' });

    const correctedEdb = `4096${runDigits}`;
    taxDialog = await openTaxDialog();
    await fillByLabel(taxDialog, 'ЕДБ', correctedEdb);
    await taxDialog.getByRole('button', { name: 'Зачувај' }).click();
    await taxDialog.waitFor({ state: 'detached', timeout: 15000 });
    const corrected = await fetch(`${FIRESTORE}/companies/${legacyId}`, {
      headers: { Authorization: 'Bearer owner' },
    }).then((res) => res.json());
    check(
      'the operator can correct an ЕДБ',
      corrected.fields?.taxNumber?.stringValue === correctedEdb,
      corrected.fields?.taxNumber?.stringValue,
    );
    check(
      'the ДДВ број follows it',
      corrected.fields?.vatNumber?.stringValue === `МК${correctedEdb}`,
      corrected.fields?.vatNumber?.stringValue,
    );
    check(
      'the claim moves with it',
      (await readClaim(correctedEdb))?.fields?.companyId?.stringValue === legacyId &&
        (await readClaim(legacyEdb)) === null,
    );

    await open(page, `${BASE}/fakturi`);
    await page.waitForTimeout(1200);
    check(
      'the price list appears in the nav once on',
      (await page.locator('a[href="/cenovnik"]').count()) >= 1,
    );

    // Build the list from the price-list screen...
    await open(page, `${BASE}/cenovnik`);
    await page.waitForTimeout(1500);
    check('the price list opens', page.url().includes('/cenovnik'), `landed on ${page.url()}`);
    await page.getByRole('button', { name: 'Нова ставка' }).first().click();
    const catalogDialog = page.locator('mat-dialog-container');
    await catalogDialog.waitFor({ state: 'visible' });
    await fillByLabel(catalogDialog, 'Назив', 'Печатење А4 ц/б');
    await fillByLabel(catalogDialog, 'Цена', '5');
    // Typed in part and picked from the suggestions, the way a print shop
    // would reach its own unit.
    await fillByLabel(catalogDialog, 'Ед. мерка', 'лис');
    await page.getByRole('option', { name: 'лист — Лист' }).click();
    await catalogDialog.getByRole('button', { name: 'Додади' }).click();
    await catalogDialog.waitFor({ state: 'detached', timeout: 15000 });
    await page.waitForTimeout(800);
    check(
      'a new entry is listed',
      (await page.locator('.item__name', { hasText: 'Печатење А4 ц/б' }).count()) === 1,
    );

    // ...then pick it on an invoice line: one choice fills the whole line.
    await open(page, `${BASE}/fakturi/nova`);
    await page.waitForTimeout(1500);
    const firstLine = page.locator('.item').first();
    const description = firstLine.getByLabel('Опис', { exact: true });
    await description.click();
    await description.fill('печ');
    await page.getByRole('option', { name: /Печатење А4 ц\/б/ }).click();
    await page.waitForTimeout(400);
    check(
      'picking an entry fills the description',
      (await description.inputValue()) === 'Печатење А4 ц/б',
    );
    check(
      'and the unit',
      (await firstLine.getByLabel('Ед. мерка', { exact: true }).inputValue()) === 'лист',
    );
    check(
      'and the price',
      (await firstLine.getByLabel('Цена без ДДВ', { exact: true }).inputValue()) === '5',
    );

    // A line typed by hand can be kept for next time from its menu.
    await description.fill('Постер А3 колор');
    await page.keyboard.press('Escape');
    await firstLine.getByLabel('Цена без ДДВ', { exact: true }).fill('150');
    await firstLine.locator('button[aria-label="Дејства за ставка"]').click();
    await page.getByRole('menuitem', { name: 'Зачувај во ценовник' }).click();
    await page.waitForTimeout(1200);
    await open(page, `${BASE}/cenovnik`);
    await page.waitForTimeout(1500);
    check(
      'a line saved from an invoice joins the list',
      (await page.locator('.item__name', { hasText: 'Постер А3 колор' }).count()) === 1,
    );

    // Switched off again: gone from the nav, writes refused, data kept.
    await ownerPatch(`companies/${companyId}`, { modules: modulesValue({ catalog: false }) });
    await open(page, `${BASE}/fakturi`);
    await page.waitForTimeout(1500);
    check(
      'switching it off removes the nav entry',
      (await page.locator('a[href="/cenovnik"]').count()) === 0,
    );
    const writeAfterOff = await tryWriteCatalog(userToken, companyId, 'probe-after-off');
    check('and writes are refused again', writeAfterOff === 403, `HTTP ${writeAfterOff}`);
    const kept = await fetch(`${FIRESTORE}/companies/${companyId}/catalog`, {
      headers: { Authorization: `Bearer ${userToken}` },
    }).then((r) => r.json());
    check(
      'the list is kept for when it is switched back on',
      (kept.documents ?? []).length === 2,
      `${(kept.documents ?? []).length} entries`,
    );
    await setAdmin(uidOf(userToken), false);

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

    // The first company's ЕДБ again — the "rename and keep going" trick, and a
    // second trial for the same business. Refused by the rules, explained in
    // the UI, and nothing is left half-created.
    await fillByLabel(page, 'Назив на фирма', 'ВТОРА ФИРМА ДООЕЛ');
    await fillByLabel(page, 'ЕДБ (даночен број)', edb);
    await page.getByRole('button', { name: 'Продолжи' }).click();
    await fillByLabel(page, 'Улица', 'Македонија');
    await fillByLabel(page, 'Број', '5');
    await fillByLabel(page, 'Поштенски број', '1000');
    await fillByLabel(page, 'Град', 'Скопје');
    await page.getByRole('button', { name: 'Продолжи' }).click();
    await page.getByRole('button', { name: 'Зачувај фирма' }).click();
    const duplicateNotice = page
      .locator('.mat-mdc-snack-bar-label', { hasText: 'веќе е регистрирана' })
      .last();
    await duplicateNotice.waitFor({ timeout: 15000 }).catch(() => {});
    check('an ЕДБ already on the app is refused, in plain words', await duplicateNotice.isVisible());
    check('the wizard stays open after the refusal', page.url().includes('/registracija'), page.url());
    const holders = await fetch(`${FIRESTORE}:runQuery`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner' },
      body: JSON.stringify({
        structuredQuery: {
          from: [{ collectionId: 'companies' }],
          where: {
            fieldFilter: {
              field: { fieldPath: 'taxNumber' },
              op: 'EQUAL',
              value: { stringValue: edb },
            },
          },
        },
      }),
    }).then((res) => res.json());
    const holderCount = holders.filter((row) => row.document).length;
    check('the refused company was not created', holderCount === 1, `${holderCount} companies`);

    await page.getByRole('button', { name: 'Назад' }).click();
    await page.getByRole('button', { name: 'Назад' }).click();
    await fillByLabel(page, 'ЕДБ (даночен број)', secondEdb);
    await page.getByRole('button', { name: 'Продолжи' }).click();
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

    // --- 11b. changing the password ----------------------------------------
    step('Password');
    await open(page, `${BASE}/fakturi`);
    await page.waitForTimeout(1000);
    await page.locator('button[aria-label="Сметка"]').first().click();
    await page.getByRole('menuitem', { name: 'Промени лозинка' }).click();
    const pwDialog = page.locator('mat-dialog-container');
    await pwDialog.waitFor({ state: 'visible' });
    await page.waitForTimeout(400);

    // The customer was handed a password; replacing it must be safe to attempt.
    await fillByLabel(pwDialog, 'Тековна лозинка', 'погрешна-лозинка');
    await fillByLabel(pwDialog, 'Нова лозинка', 'novaLozinka456');
    await fillByLabel(pwDialog, 'Повторете ја новата лозинка', 'novaLozinka456');
    await pwDialog.getByRole('button', { name: 'Промени лозинка' }).click();
    await pwDialog.locator('.error').waitFor({ timeout: 15000 });
    check(
      'a wrong current password is refused, in plain words',
      (await pwDialog.locator('.error').innerText()).includes('Тековната лозинка не е точна'),
    );

    await fillByLabel(pwDialog, 'Тековна лозинка', 'lozinka123');
    await fillByLabel(pwDialog, 'Повторете ја новата лозинка', 'различна456');
    await pwDialog.getByRole('button', { name: 'Промени лозинка' }).click();
    await page.waitForTimeout(300);
    check(
      'two different new passwords are caught before anything is sent',
      (await pwDialog.locator('mat-error').allInnerTexts()).some((t) => t.includes('не се исти')),
    );

    await fillByLabel(pwDialog, 'Нова лозинка', 'abc');
    await fillByLabel(pwDialog, 'Повторете ја новата лозинка', 'abc');
    await pwDialog.getByRole('button', { name: 'Промени лозинка' }).click();
    await page.waitForTimeout(300);
    check(
      'a too-short password is caught too',
      (await pwDialog.locator('mat-error').allInnerTexts()).some((t) => t.includes('прекратка')),
    );

    await fillByLabel(pwDialog, 'Нова лозинка', 'novaLozinka456');
    await fillByLabel(pwDialog, 'Повторете ја новата лозинка', 'novaLozinka456');
    await pwDialog.getByRole('button', { name: 'Промени лозинка' }).click();
    await pwDialog.waitFor({ state: 'detached', timeout: 15000 });
    await page.getByText('Лозинката е променета.').first().waitFor({ timeout: 10000 });
    check('the right current password changes it', true);
    check(
      'the old password no longer signs in',
      !(await idTokenFor(email, 'lozinka123')),
    );
    check(
      'the new one does',
      !!(await idTokenFor(email, 'novaLozinka456')),
    );

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
    const unexpectedFailures = failedRequests.filter(
      (r) => !(r.startsWith('400 ') && r.includes('accounts:signInWithPassword')),
    );
    const expectedFailures = failedRequests.length - unexpectedFailures.length;
    const realErrors = consoleErrors.filter(
      (e) =>
        !e.includes('favicon') &&
        !e.includes('Download the React DevTools') &&
        !e.toLowerCase().includes('font') &&
        // Only the deliberate wrong-password request(s), never an unexplained 400.
        !(
          expectedFailures > 0 &&
          unexpectedFailures.length === 0 &&
          e.includes('status of 400')
        ),
    );
    check('no console errors', realErrors.length === 0, realErrors.slice(0, 3).join(' | '));
    check(
      'the only failed request was the deliberate wrong password',
      unexpectedFailures.length === 0,
      unexpectedFailures.slice(0, 3).join(' | '),
    );
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
