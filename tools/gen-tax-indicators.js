/**
 * Generates `src/app/core/ujp/tax-indicators.generated.ts` from the saved copy
 * of https://efakturawiki.ujp.gov.mk/danocni-indikatori.
 *
 * Usage: node tools/gen-tax-indicators.js docs/ujp/tax-indicators.txt \
 *          src/app/core/ujp/tax-indicators.generated.ts
 *
 * The page carries two lists:
 *
 *  1. A wide table (five columns: code | name | note | description | rate code)
 *     holding every indicator, sales and purchase alike. The heading
 *     "Влезни Даночни Индикатори" separates the outbound half from the inbound
 *     half — only the outbound half belongs on a sales invoice.
 *
 *  2. A curated set of per-indicator sections further down, each headed
 *     "¶ Код на даночен индикатор: X". These are the codes a seller actually
 *     reaches for, so they are flagged `common` and shown first in the picker.
 *     A few of them (DDV-11-A/V/B) appear *only* here, not in the table.
 */
const fs = require('fs');

const [, , inputPath, outputPath] = process.argv;
const lines = fs.readFileSync(inputPath, 'utf8').split('\n').map((s) => s.trim());

const purchaseSectionAt = lines.findIndex((l) => /^¶\s*Влезни Даночни Индикатори/.test(l));
const tableEnd = purchaseSectionAt === -1 ? lines.length : purchaseSectionAt;

/** Rate implied by a tax-group code, per the wiki's own "(Даночна стапка: N%)". */
const GROUP_PERCENT = { 'DDV-A': 18, 'DDV-V': 10, 'DDV-B': 5, 'DDV-G': 0 };

const byCode = new Map();

/** Tax group for a code the wide table does not list. See call site. */
function inferTaxGroup(code, text) {
  const suffix = /-(A|V|B|G)$/.exec(code);
  if (suffix) return `DDV-${suffix[1]}`;

  if (/\b18\s*%/.test(text)) return 'DDV-A';
  if (/\b10\s*%/.test(text)) return 'DDV-V';
  if (/\b5\s*%/.test(text)) return 'DDV-B';

  // "општа даночна стапка" is the statutory name for the 18% rate.
  if (/општа даночна стапка/i.test(text)) return 'DDV-A';
  // "повластена" covers both 5% and 10% without saying which; 10% is the one
  // that applies to the чл. 32 cases these codes describe.
  if (/повластена даночна стапка/i.test(text)) return 'DDV-V';

  return 'DDV-G';
}

// --- 1. the wide table (outbound half only) -------------------------------
for (let i = 0; i < tableEnd; i++) {
  if (!/^DDV-[^|]*\|$/.test(lines[i])) continue;
  const cells = lines.slice(i, i + 5).map((s) => s.replace(/\s*\|$/, '').trim());
  if (cells.length < 5) continue;
  const [code, name, note, description, rateCell] = cells;
  const m = /^(DDV-[A-Z])\s*\(/.exec(rateCell);
  if (!m) continue;
  if (!byCode.has(code)) {
    byCode.set(code, {
      code,
      name,
      note,
      description,
      taxGroupCode: m[1],
      common: false,
    });
  }
  i += 4;
}

// --- 2. the curated per-indicator sections --------------------------------
const field = (line, label) => {
  const m = new RegExp(`^${label}:\\s*(.*)$`).exec(line);
  return m ? m[1].trim() : null;
};

for (let i = 0; i < lines.length; i++) {
  const head = /^¶\s*Код на даночен индикатор:\s*(DDV-\S+)\s*$/.exec(lines[i]);
  if (!head) continue;
  const code = head[1];

  let name = null;
  let note = null;
  let description = null;
  for (let j = i + 1; j < Math.min(i + 6, lines.length); j++) {
    if (/^¶/.test(lines[j])) break;
    name ??= field(lines[j], 'Назив на даночен индикатор');
    description ??= field(lines[j], 'Опис на даночен индикатор');
    note ??= field(lines[j], 'Напомена');
  }

  const existing = byCode.get(code);
  if (existing) {
    existing.common = true;
    // The section wording is the more precise of the two; prefer it.
    if (name) existing.name = name;
    if (note) existing.note = note;
    continue;
  }

  // Codes such as DDV-11-A appear only in this section list, so they have no
  // rate cell to read. Recover the tax group from, in order of reliability:
  // the trailing group letter (…-A = 18%, …-V = 10%, …-B = 5%), an explicit
  // percentage in the name, then the law's wording for the general rate.
  // Anything left is a zero-rated code (exempt / out of scope) -> DDV-G, which
  // is what the official DDV-9 example uses for `vatCode`.
  const taxGroupCode = inferTaxGroup(code, `${name ?? ''} ${description ?? ''}`);
  byCode.set(code, {
    code,
    name: name ?? code,
    note: note ?? '',
    description: description ?? '',
    taxGroupCode,
    common: true,
  });
}

/**
 * Infers `vatImpact`, which the wiki table does not carry. Order matters:
 * reverse charge is checked first because those entries also mention rates.
 * Verified against the worked examples in docs/ujp/json-examples.pdf, where
 * DDV-11-A is PRENESEN and DDV-9 is OSLOBODEN.
 */
function impactOf(r) {
  const text = `${r.name} ${r.note} ${r.description}`.toLowerCase();
  if (/пренесување на даночна обврска|данокот го пресметува примателот|даночен должник|член 32/.test(text)) {
    return 'PRENESEN';
  }
  if (/не е ддв обврзник|член 51 став 3/.test(text)) return 'NULA';
  if (/ослободен|не е предмет на оданочување|не подлежи/.test(text)) return 'OSLOBODEN';
  return GROUP_PERCENT[r.taxGroupCode] > 0 ? 'STANDARD' : 'OSLOBODEN';
}

const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\s+/g, ' ').trim();

// Common codes first, then alphabetically — this is the picker's display order.
const all = [...byCode.values()].sort((a, b) => {
  if (a.common !== b.common) return a.common ? -1 : 1;
  return a.code.localeCompare(b.code);
});

const body = all
  .map(
    (r) => `  {
    code: '${esc(r.code)}',
    categoryName: '${esc(r.name)}',
    note: '${esc(r.note)}',
    vatImpact: '${impactOf(r)}',
    taxGroupCode: '${esc(r.taxGroupCode)}',
    common: ${r.common},
  },`,
  )
  .join('\n');

const out = `import type { TaxIndicator } from './codebooks';

/**
 * The УЈП outbound tax-indicator list, generated from the official page at
 * https://efakturawiki.ujp.gov.mk/danocni-indikatori (mirrored in
 * \`docs/ujp/tax-indicators.txt\`, captured 2026-08-29).
 *
 * GENERATED FILE — do not edit by hand. Regenerate with:
 *   node tools/gen-tax-indicators.js docs/ujp/tax-indicators.txt \\
 *     src/app/core/ujp/tax-indicators.generated.ts
 *
 * \`vatImpact\` is not a column on that page; it is inferred from the wording
 * and cross-checked against the worked examples in
 * \`docs/ujp/json-examples.pdf\`. Once a company has e-УЈП access the app
 * replaces this list wholesale with a live \`GET /api/v1/tax-indicators\`
 * response, which carries \`vatImpact\` authoritatively.
 *
 * \`common: true\` marks the codes УЈП documents individually — the short list
 * a seller actually picks from. The rest are shown behind "сите шифри".
 */
export const UJP_TAX_INDICATORS: readonly TaxIndicator[] = [
${body}
];
`;

fs.writeFileSync(outputPath, out, 'utf8');

const counts = all.reduce((acc, r) => {
  const k = impactOf(r);
  acc[k] = (acc[k] || 0) + 1;
  return acc;
}, {});
console.log(`wrote ${all.length} indicators (${all.filter((r) => r.common).length} common)`);
console.log('by impact:', counts);
console.log('common:', all.filter((r) => r.common).map((r) => `${r.code}=${impactOf(r)}`).join(' '));
