# е-Фактура

Invoicing for North Macedonia, built against the УЈП е-Фактура specification.

Angular 20 · Angular Material 3 · Firebase (Auth + Firestore) · Macedonian UI.

---

## Quick start

Three things need to be running. Java is required by the Firestore emulator
(`winget install Microsoft.OpenJDK.21` if it is missing).

```bash
npm install
npm run functions:install   # once — the Cloud Function has its own package.json
npm run emulators           # terminal 1 — Auth :9099, Firestore :8080, Functions :5001, UI :4000
npm start                   # terminal 2 — http://localhost:4200
```

Register any email/password; the emulator accepts anything. The app walks you
through company setup on first sign-in.

| Command | What it does |
| --- | --- |
| `npm start` | Dev server |
| `npm run emulators` | Firebase Emulator Suite |
| `npm run build` | Production build |
| `npm run test:ci` | Unit tests, headless, single run |
| `npm run e2e` | End-to-end smoke test (needs dev server + emulators) |
| `npm run e2e:shots` | Screenshots of every screen into `e2e/shots/` |
| `npm run codebooks:gen` | Regenerate the tax-indicator list from `docs/ujp/` |
| `npm run icons:gen` | Re-render the app icons and favicon from the brand glyph |
| `npm run functions:build` | Compile the Cloud Function (the emulator runs `lib/`) |

### Becoming the admin

The admin screen is deliberately not grantable from inside the app. Create one
document by hand in the Firebase console — collection `admins`, document ID =
your Firebase Auth uid (shown in **Поставки → Претплата**), any field — and
`/admin` appears in the navigation.

### Creating a customer

**Претплати → Нов корисник** provisions a customer in one pass: their company
details, a Firebase Auth account with a generated password, and a subscription
already paid through a date you choose. They sign in with the credentials you
hand them and land straight on an empty invoice list — no onboarding, nothing to
fill in.

The password is shown once, on the panel that appears after the account is
created, together with a ready-to-send message. It is never stored anywhere this
app can read it, so if it is lost the customer uses **Заборавена лозинка?** on
the login screen. Self-registration still works alongside this, and still opens
a 30-day trial.

This runs as a Cloud Function rather than in the browser for one reason:
`createUserWithEmailAndPassword` replaces the *caller's* session with the new
account, so doing it client-side would sign you out of the admin screen and into
the customer you just made. See `functions/src/index.ts`.

## Deployed

**https://e-faktura-1e6d0.web.app** — Firebase project `e-faktura-1e6d0`,
Firestore in `europe-west3`.

```bash
npm run deploy        # build + ship hosting, firestore.rules and functions
npm run e2e:live      # confirm the hosted app boots with no console errors
```

`npm run deploy` is scoped to `--only hosting,firestore,functions`: nothing in
the app writes files, so no Storage bucket is provisioned.
`src/environments/environment.prod.ts` holds the real config while
`environment.ts` still points at the emulators, so local development is
unaffected by a deploy.

**The project needs the Blaze plan.** Cloud Functions cannot be deployed on
Spark, and `createCustomer` is a function (see *Creating a customer* above).
Blaze is pay-as-you-go on top of a free tier that this app does not come close
to exhausting — a handful of provisioning calls a month — but it does require a
billing account on the project. Everything else still runs within the free
allowances.

The function is deployed to **europe-west1**. That region is named twice, in
`functions/src/index.ts` (`setGlobalOptions`) and in `FUNCTIONS_REGION` in
`src/app/core/firebase/firebase.providers.ts`. They must match: a mismatch is
not a build error, it is a 404 on the first call.

---

## How it is put together

```
src/app/
  core/
    models/     domain types, including the УЈП wire format
    ujp/        codebooks, the totals engine, the document builder, validation,
                and the signer/transport seam
    data/       Firestore services (company, client, invoice, codebooks)
    auth/       authentication and route guards
    modules/    the per-customer feature registry
    util/       money, dates, Macedonian number-to-words
  features/     auth · onboarding · invoices · clients · catalog · settings · admin
  layout/       app shell (desktop rail / mobile tab bar)
  shared/       formatting pipes, status chip, confirm dialog
functions/      the one Cloud Function: provisioning a customer (Admin SDK)
docs/ujp/       the official УЈП specification, mirrored
```

### Several companies per user

A user can act for more than one company — an accountant, or an owner with two
entities. **Нова фирма** in the company switcher reruns the setup wizard with
`?nova=1`, which is the only way past the guard that otherwise keeps someone
with a company from re-running onboarding. Each company carries its own clients,
numbering and subscription.

### Data model

Firestore is organised so that one membership check covers everything:

```
users/{uid}
companies/{companyId}
companies/{companyId}/clients/{clientId}
companies/{companyId}/invoices/{invoiceId}
companies/{companyId}/logos/{logoId}          written once, never changed
companies/{companyId}/catalog/{itemId}        Ценовник module
companies/{companyId}/settings/codebooks
```

Access to a company is decided by its `memberUids` array, and invoices live
underneath their company, so no query can reach another company's records.
Issued invoices are frozen by the rules themselves — only payment tracking and
the УЈП receipt stay writable.

### Subscriptions

Billing is an invoice sent by bank transfer and reconciled by hand, so the whole
subscription is **one date** on the company: `subscription.paidUntil`. It hangs
off the company rather than the user because a company is what gets invoiced and
several people can work in one.

Two rules carry it:

- A client may never move that date. The company update rule rejects any change
  to `subscription` — otherwise anyone could grant themselves a decade from the
  browser console. It moves only from the admin screen, which is gated on a
  document under `/admins/{uid}` that the rules make unwritable from anywhere but
  the Firebase console.
- Invoice **creation** is the only thing that stops when it lapses. Reading,
  printing, exporting, and finishing an existing draft all keep working, because
  the records belong to the customer and North Macedonia requires them to be
  retained. The end-to-end test asserts this rather than trusting it.

A company created before subscriptions existed carries no such field. That reads
as *grandfathered*, not *lapsed* — in the rules and in the UI — and the app
writes an opening trial the first time its owner signs in. The rules permit that
one write only while the field is absent, so it cannot be claimed twice or
removed to reset.

When it lapses, the banner carries an **Обнови претплата** button rather than
only bad news: the dialog behind it shows the price, the bank account, the
payment reference and a way to reach a human, and its primary action opens a
prefilled e-mail requesting an invoice. Those details live in
`environment.billing` — the same for every customer, and changing them is a
deliberate act.

`/admin` lists every company sorted by whoever expires soonest, since the
recurring job is "who do I invoice this week". `+1 година` extends from the
current expiry when the account is still running, and from today when it has
already lapsed.

Deletion is allowed only while `status` is still `00`, meaning УЈП has no copy:
a draft, or an invoice numbered locally but never submitted. Removing the most
recently issued number rolls the company counter back in the same transaction so
the sequence keeps no gap; removing an earlier one cannot be repaired that way
and the confirm dialog says so. Once a document has been sent, the lawful
correction is a storno, not an erasure.

### Modules (per-customer features)

Features one customer asks for and the rest do not need are **modules**: off by
default, invisible while off, and switched on per company from **Претплати → ⋮ →
Модули**. A module appears for that customer immediately, without a reload.

- The switch is `company.modules.<id>`. Like `subscription`, the rules let only
  the operator change it, and reject it on create — a customer cannot unlock a
  module from the browser console.
- A module's own data is also gated in the rules (`moduleEnabled(...)`), so "off"
  means the writes are refused, not just that a menu entry is hidden.
- Switching a module off keeps its data; switching it back on restores it.

| Module | What the customer gets |
| --- | --- |
| `catalog` — **Ценовник** | A price list (`companies/{id}/catalog`). The invoice line's *Опис* field autocompletes from it, and picking an entry fills the unit, price (with or without VAT, as entered) and tax. Any line can be kept for next time with **⋮ → Зачувај во ценовник**. Lines keep their own copy, so a later price change never alters an issued invoice. |

**Adding a module:** an entry in `core/modules/modules.ts` (the admin dialog
lists it automatically), its screens behind `moduleGuard(id)` and a `module`
entry in the shell nav, other UI behind `CompanyService.hasModule(id)`, and a
`moduleEnabled(companyId, '<id>')` condition on any collection it owns in
`firestore.rules`. The smoke test's *Modules* section shows how to test one.

### Three decisions worth knowing about

**Amounts are computed in one place.** `core/ujp/totals.ts` is the only module
that does invoice arithmetic. The editor, the printed document and the API
payload all read from it, so the number on screen is by construction the number
that gets saved and signed. It implements УЈП's published formulas, including
two rules that appear only in their worked examples and not in the prose: line
amounts carry four decimals while document totals carry two, and reverse-charge
lines report notional VAT in `vatTotals` even though they charge none. Both are
covered by tests that reproduce УЈП's own numbers.

**Invoice numbers are allocated at issue, not at creation.** A number is drawn
inside a Firestore transaction on the company document, so simultaneous issues
cannot collide and abandoned drafts do not leave gaps in the sequence. That is
also what makes it free for drafts to save themselves: a new invoice takes its
own address (`/fakturi/{id}`) on its first edit and is written a moment after
each change, when the editor is left and when the tab is hidden, so a look at
another screen and Back returns to it. `/fakturi/nova` and `/fakturi/:id` are
one route, so that change of address keeps the page instead of rebuilding it.

**Money formatting does not use `Intl`.** `Intl.NumberFormat('mk-MK')` silently
falls back to `en-US` on browsers built without the `mk` CLDR data — and that
turns `2.360,00` into `2,360.00`, which a Macedonian reader parses as a
different number. The separators are written out in `core/util/money.ts`
instead. The datepicker's month names are hardcoded for the same reason.

---

## УЈП integration

The specification is mirrored in [`docs/ujp/`](docs/ujp/), captured 2026-08-29
from `efakturawiki.ujp.gov.mk`, including the official API documentation and
JSON examples as PDFs.

### What is built

- The complete document builder (`core/ujp/ujp-document.builder.ts`) producing
  the exact `{ requestTimestamp, document }` payload УЈП expects.
- The official totals formulas and VAT treatment for all four `vatImpact`
  categories: `STANDARD`, `NULA`, `OSLOBODEN` and `PRENESEN` (чл. 32).
- All 87 outbound tax indicators, generated from the official codebook, with the
  16 УЈП documents individually marked as the short list for the picker.
- Pre-flight validation mirroring УЈП's server-side checks — mandatory fields,
  ЕДБ format, codebook membership, amount reconciliation — so a document is
  checked before anyone plugs in a smart card.
- The status model (`00` Нацрт, `01` Испратена, `03` Прифатена, `04`, `05`, `07`
  Сторнирана, `09`, `10`) plus `EUID` / QR fields on the invoice.
- A **Провери УЈП документ** dialog showing the exact JSON that would be signed,
  next to the validation result, with copy and download.

### What is not wired up, and why

Submission needs a JWS signed with a qualified certificate (КИБС, Македонски
Телеком, Halcom), which normally lives on a smart card behind a PIN. A browser
tab cannot reach it — УЈП's own answer is a Windows *Native App* plus a browser
extension. The API host also does not send CORS headers, so even an unsigned
call cannot be made from a page.

Both are therefore interfaces, in `core/ujp/ujp-signer.ts`:

```ts
abstract class UjpSigner    { status(); sign(payloadJson, context); }
abstract class UjpTransport { status(); send(request, headers); call(path, headers, body); }
```

They are currently provided as `UnavailableUjpSigner` / `UnavailableUjpTransport`,
which refuse politely and explain why. Wiring a real one is a provider swap in
`app.config.ts`. Three implementations are realistic: the УЈП extension bridge,
a Cloud Function holding a soft PFX certificate, or an Electron shell using
Windows CryptoAPI.

Everything else works today: invoices are created, validated, numbered, frozen,
printed and exported.

### Codebooks

Every УЈП code-list endpoint requires `X-EUJP-ID` and `X-EDB` headers belonging
to a **registered** e-УЈП user, so a company that has not completed registration
cannot fetch them at all. The app therefore ships lists seeded from the
official documentation and syncs live ones once credentials are entered in
**Поставки → Поврзување со УЈП**. Nothing hardcodes a code outside
`core/ujp/codebooks.ts`.

### Two points to verify before going live

1. **`requestTimestamp` format.** The API specification page states
   `2026-01-05T12:00:00` in Europe/Skopje with no suffix; every example in the
   JSON examples PDF writes `2026-04-27T11:24:10Z`. The spec wins by default —
   flip `zSuffix` in `buildUjpPayload` if УЈП rejects it during the pilot.
2. **The law is not final.** The УЈП wiki currently leads with the *draft*
   e-Faktura law published on ENER for public consultation, and published phase
   dates disagree (B2G October 2026 with B2B in 2027, versus both in October
   2026). Codebooks sync from the API rather than being compiled in, so rule
   changes do not require a redeploy.

---

## Testing

**Unit tests** (47) cover the parts where a mistake is expensive: the totals
engine against УЈП's published examples, rounding, Macedonian number formatting
and number-to-words, date handling, and invoice numbering.

```bash
npm run test:ci
```

**End-to-end** drives the real app against the emulators through the whole first
run — register, onboard, create a client, build an invoice, verify the totals
and the generated УЈП payload, issue it, and check the list, filtering and
mobile layout.

```bash
npm run emulators     # terminal 1
npm start             # terminal 2
npm run e2e           # terminal 3
```

`npm run e2e:shots` writes screenshots of every screen, including the printed
invoice under print-media emulation, into `e2e/shots/`.

Both use the locally installed Chrome (`channel: 'chrome'`), so no browser
download is needed.

---

## Sending and printing

**Печати / PDF** renders a dedicated A4 document
(`features/invoices/invoice-print.component.ts`) that is hidden on screen and
revealed only for print, so the same live totals the editor shows are what comes
out of the printer. Browser "Save as PDF" is deliberate: it renders Cyrillic
with the page's own webfont, which a client-side PDF library would need a
bundled Cyrillic font to match. Once a document has been through УЈП,
`POST /documents/sales-invoice/pdf` returns the official PDF and that becomes
the authoritative copy.

**Поставки → Печатење** sets four things per company: a logo (beside the
company name, or centred above the header), the heading, the person authorised
to sign invoices, and whose name the saved PDF starts with — the company's own,
or the buyer's for a company filing its own copies. The heading is a fixed
choice, Фактура or Фактура - испратница, not free text: it says what the
document legally is, and it is print only, since УЈП always receives „Фактура“.
The signature line is captioned „Лице овластено за потпишување на фактури“:
since 2016 the VAT law (чл. 53) asks for that person's name and signature in
place of the company stamp, and the name may be printed, so it is. Logos are
documents of their own, shrunk in the browser to at most 960 × 320 px. An
invoice stores only the logo's id, so the invoice list does not download a copy
per invoice, and the rules refuse to change or delete a logo once written. The
heading, logo and signatory are frozen into an invoice when it is issued, so
reprinting an old invoice never changes them.

**Сподели** composes the covering message — number, amount, deadline, bank
account, all in Macedonian — and hands it to a channel: `mailto:` for e-mail,
`wa.me` for WhatsApp, `viber://forward` for Viber, the clipboard, or the native
share sheet where the browser offers one. The wording is editable before it
goes, and the composer itself is pure functions in `core/util/share.ts` with
tests. The document is *not* attached: a page cannot put a file into a `mailto:`
draft or a WhatsApp web intent, so the PDF comes from the browser's print dialog
and the sender attaches it. Attaching automatically needs either a bundled
Cyrillic PDF font or a server-side renderer — see the note in that file.

## Installing as an app

The app is a PWA: on a phone, **Chrome → ⋮ → Install app** (Android) or
**Share → Add to Home Screen** (iOS Safari) puts it on the home screen, where it
opens full-screen without the browser around it. Long-pressing the Android icon
offers a **Нова фактура** shortcut.

What makes that work:

- `public/manifest.webmanifest` — name, colours, icons, the shortcut.
- `public/icons/` — rendered by `npm run icons:gen` (`tools/gen-icons.mjs`) from
  the `receipt_long` glyph the navigation rail uses, in the theme's primary
  colour. There is a *maskable* variant because Android crops icons to its own
  shape; the glyph sits inside the central safe zone so no crop clips it.
- The Angular service worker (`ngsw-config.json`), **production builds only** —
  `ng serve` and the tests run without it, so a cached shell never hides an edit.
  It precaches the app shell and every lazy chunk, so the installed app opens
  with no connection; the icon font is cached on first use for the same reason.
  Firestore keeps its own offline copy of the data, so invoices already seen
  stay readable offline too.

**Updates.** A service worker keeps running the version it was opened with and
swaps on the next load. An installed app can sit in the background for days
without loading, so `core/pwa/app-update.service.ts` checks for a new version
whenever the app comes back to the foreground and shows *Достапна е нова
верзија* with an **Освежи** button. It never reloads by itself — that would throw
away an invoice being edited.

**Cache headers matter.** In `firebase.json` only the content-hashed bundles
(`main-*.js`, `chunk-*.js`, …) are cached for a year. `index.html`,
`ngsw-worker.js`, `ngsw.json` and the manifest are `no-cache`: a broader
`*.js` rule would have pinned the service worker itself for a year. So is every
app address (`/`, `/fakturi`, `/fakturi/{id}` — the regex `^/[^.]*$`, any path
without a dot). Those are served `index.html` through the rewrite, but header
rules match the address requested rather than the file served, so the
`index.html` rule alone missed them and they got Hosting's default of an hour —
long enough for a browser without the service worker to load a page that
points at bundles the next deploy had already removed.

**Google sign-in on iOS.** An app added to the home screen on iPhone runs in its
own sandbox, where Firebase's sign-in pop-up is known to be unreliable. E-mail
and password sign-in does not use a pop-up and is unaffected. Neither platform
has been tested on a physical device yet.

## Notes

- **`box-sizing: border-box` is set globally** in `styles.scss` rather than
  inherited from Tailwind's preflight, which is not imported. Without it any
  `width: 100%` element with horizontal padding overflows its parent — the login
  panel ran 48px past a 360px phone viewport, which mobile Chrome renders as a
  zoomed-in, clipped page. `npm run e2e:overflow` measures the public routes and
  the end-to-end test measures the rest at 360px.
- **Tailwind** is installed and wired (with the M3 tokens bridged into its
  theme) but currently unused — Material's system variables plus component SCSS
  covered the layout. Tailwind v4 only emits the utilities you use, so it costs
  nothing while idle; remove `src/tailwind.css`, `.postcssrc.json` and the
  dependency if you would rather not keep it. Its *preflight* is deliberately
  not imported: it forces `border-style: solid` on every element, which paints a
  line through Material's notched form-field outline.
- The app is Macedonian-only. Routes use Macedonian paths (`/fakturi`,
  `/klienti`, `/postavki`) so shared links read naturally.
