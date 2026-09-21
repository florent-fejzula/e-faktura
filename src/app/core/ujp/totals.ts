import type {
  ComputedLine,
  InvoiceItem,
  InvoiceTotals,
  VatImpact,
  VatTotalLine,
} from '../models/invoice.model';
import { round, round2, roundToUnit, sum } from '../util/money';
import type { CodebookSet } from './codebooks';
import { findIndicator } from './codebooks';

/**
 * The invoice arithmetic, implemented to match УЈП exactly.
 *
 * UJP re-computes every figure server-side and rejects the document when its
 * result differs, so this module is the single source of truth for amounts —
 * the UI, the PDF and the API payload all read from it, and nothing recomputes
 * a total on its own.
 *
 * Two rules were taken from the official examples in `docs/ujp/json-examples.pdf`
 * rather than from the prose, because the prose does not state them:
 *
 *  1. **Line amounts carry 4 decimals, document totals carry 2.** The general
 *     invoice example has `docItemUnitOriginalPriceWoVat: 95.2381` alongside
 *     `docNetAmount: 95.24`. Rounding lines to 2 first makes the totals drift.
 *
 *  2. **Reverse charge still reports notional VAT in `vatTotals`.** For the
 *     чл. 32 example, every item VAT field is `0` and `docVatAmount` is `0`,
 *     but the `vatTotals` row carries `vatPercent: 18` and
 *     `vatAmount: 549.15` — the VAT the *buyer* must self-account. So the
 *     documented `vatAmount = Σ docItemTotalVat` identity holds only for
 *     STANDARD lines.
 */

/** Decimals used for `docItem*` fields. */
export const ITEM_DECIMALS = 4;
/** Decimals used for `docTotals` and `vatTotals` fields. */
export const TOTAL_DECIMALS = 2;

/** Resolves the VAT rate and impact a line's tax indicator implies. */
export function resolveTax(
  codebooks: CodebookSet,
  item: Pick<InvoiceItem, 'taxIndicator' | 'vatRate'>,
): { rate: number; impact: VatImpact; vatGroup: string } {
  const indicator = findIndicator(codebooks, item.taxIndicator);
  if (!indicator) {
    // Unknown indicator (stale draft, or a codebook synced since). Fall back to
    // the rate stored on the line so amounts stay stable instead of silently
    // dropping to zero.
    return { rate: item.vatRate ?? 0, impact: 'STANDARD', vatGroup: '' };
  }
  const group = codebooks.taxGroups.find((g) => g.code === indicator.taxGroupCode);
  const groupRate = group?.percent ?? 0;

  switch (indicator.vatImpact) {
    case 'STANDARD':
      return { rate: groupRate, impact: 'STANDARD', vatGroup: indicator.taxGroupCode };
    case 'PRENESEN':
      // The rate stays on the line (`docItemVat: 18`) even though no VAT is
      // charged, because the buyer accounts for it at that rate.
      return { rate: groupRate, impact: 'PRENESEN', vatGroup: indicator.taxGroupCode };
    case 'NULA':
    case 'OSLOBODEN':
      return { rate: 0, impact: indicator.vatImpact, vatGroup: indicator.taxGroupCode };
  }
}

/**
 * Rate used to strip VAT out of a gross-entered price.
 *
 * Only STANDARD lines actually carry VAT in their price. On an exempt or
 * reverse-charge line the amount the buyer pays *is* the net amount, so a
 * "with VAT" entry means the same number.
 */
function conversionRate(rate: number, impact: VatImpact): number {
  return impact === 'STANDARD' ? rate : 0;
}

/**
 * Computes one line at full precision, rounding only the emitted fields.
 *
 * Intermediates are deliberately not rounded between steps — the official
 * example derives `unitPriceWoVat: 1525.4237` from an unrounded
 * `1694.915254...`, which a round-at-every-step implementation cannot reproduce.
 */
export function computeLine(
  item: InvoiceItem,
  lineNo: number,
  codebooks: CodebookSet,
): ComputedLine {
  const { rate, impact } = resolveTax(codebooks, item);

  const qty = Number.isFinite(item.qty) ? item.qty : 0;
  const entered = Number.isFinite(item.unitPrice) ? item.unitPrice : 0;
  const discountPercent = Number.isFinite(item.discountPercent) ? item.discountPercent : 0;

  const convRate = conversionRate(rate, impact);
  const unitOriginal =
    item.priceMode === 'gross' ? entered / (1 + convRate / 100) : entered;

  const unitDiscount = (unitOriginal * discountPercent) / 100;
  const unitNet = unitOriginal - unitDiscount;
  const unitVat = impact === 'STANDARD' ? (unitNet * rate) / 100 : 0;

  const totalOriginal = qty * unitOriginal;
  const totalNet = qty * unitNet;
  const totalVat = qty * unitVat;

  return {
    lineNo,
    item,
    unitOriginalPriceWoVat: round(unitOriginal, ITEM_DECIMALS),
    unitDiscountAmount: round(unitDiscount, ITEM_DECIMALS),
    unitPriceWoVat: round(unitNet, ITEM_DECIMALS),
    unitVat: round(unitVat, ITEM_DECIMALS),
    totalOriginalPriceWoVat: round(totalOriginal, ITEM_DECIMALS),
    totalPriceWoVat: round(totalNet, ITEM_DECIMALS),
    totalVat: round(totalVat, ITEM_DECIMALS),
    totalPriceWVat: round(totalNet + totalVat, ITEM_DECIMALS),
    vatImpact: impact,
  };
}

export function computeLines(
  items: readonly InvoiceItem[],
  codebooks: CodebookSet,
): ComputedLine[] {
  return items.map((item, index) => computeLine(item, index + 1, codebooks));
}

/**
 * Document totals.
 *
 * `netAmountDisc` follows the documented identity
 * `docNetAmountDisc = docNetAmount - docDiscountAmount` using the *rounded*
 * operands, which is what reproduces the official example (3389.83 - 338.98 =
 * 3050.85) — summing the unrounded line nets can land a денар off.
 */
export function computeTotals(
  lines: readonly ComputedLine[],
  options: { advanceAmount?: number } = {},
): InvoiceTotals {
  const netAmount = round2(sum(lines.map((l) => l.totalOriginalPriceWoVat)));
  const discountAmount = round2(
    sum(lines.map((l) => l.item.qty * l.unitDiscountAmount)),
  );
  const netAmountDisc = round2(netAmount - discountAmount);
  const vatAmount = round2(sum(lines.map((l) => l.totalVat)));
  const grossAmount = round2(netAmountDisc + vatAmount);
  const grossAmountRounded = roundToUnit(grossAmount);

  const advanceAmount = round2(options.advanceAmount ?? 0);
  const finalAmount = round2(grossAmountRounded - advanceAmount);

  return {
    netAmount,
    discountAmount,
    netAmountDisc,
    vatAmount,
    grossAmount,
    grossAmountRounded,
    advanceAmount,
    finalAmount,
  };
}

/**
 * VAT recap, grouped by tax indicator and tax group exactly as UJP expects.
 *
 * Reverse-charge groups report the notional VAT the buyer owes; every other
 * group reports what was actually charged.
 */
export function computeVatTotals(
  lines: readonly ComputedLine[],
  codebooks: CodebookSet,
): VatTotalLine[] {
  const groups = new Map<string, ComputedLine[]>();

  for (const line of lines) {
    const { vatGroup } = resolveTax(codebooks, line.item);
    const key = `${line.item.taxIndicator}|${vatGroup || line.item.vatGroup}`;
    const bucket = groups.get(key);
    if (bucket) bucket.push(line);
    else groups.set(key, [line]);
  }

  const result: VatTotalLine[] = [];

  for (const [key, bucket] of groups) {
    const [taxIndicator, vatCode] = key.split('|');
    const { rate, impact } = resolveTax(codebooks, bucket[0].item);
    const indicator = findIndicator(codebooks, taxIndicator);

    const taxableAmount = round2(sum(bucket.map((l) => l.totalPriceWoVat)));

    // Charged VAT for standard lines; the amount the buyer self-accounts for
    // reverse-charge lines; zero for exempt and non-taxable lines.
    const vatAmount =
      impact === 'STANDARD'
        ? round2(sum(bucket.map((l) => l.totalVat)))
        : impact === 'PRENESEN'
          ? round2((taxableAmount * rate) / 100)
          : 0;

    result.push({
      taxIndicator,
      taxIndicatorNote: indicator?.note ?? '',
      vatCode,
      vatPercent: impact === 'PRENESEN' || impact === 'STANDARD' ? rate : 0,
      taxableAmount,
      vatAmount,
      totalAmount: round2(taxableAmount + vatAmount),
      vatImpact: impact,
    });
  }

  // Stable order so the printed recap does not reshuffle between renders.
  return result.sort((a, b) => a.taxIndicator.localeCompare(b.taxIndicator));
}

export interface ComputedInvoice {
  lines: ComputedLine[];
  totals: InvoiceTotals;
  vatTotals: VatTotalLine[];
}

/** One-shot computation of everything derived from a set of invoice lines. */
export function computeInvoice(
  items: readonly InvoiceItem[],
  codebooks: CodebookSet,
  options: { advanceAmount?: number } = {},
): ComputedInvoice {
  const lines = computeLines(items, codebooks);
  return {
    lines,
    totals: computeTotals(lines, options),
    vatTotals: computeVatTotals(lines, codebooks),
  };
}

/**
 * Gross unit price for display — the "price with VAT" column in the editor.
 * Derived rather than stored so it can never disagree with the net price.
 */
export function grossUnitPrice(line: ComputedLine): number {
  return round(line.unitPriceWoVat + line.unitVat, ITEM_DECIMALS);
}

/** Difference introduced by rounding the gross to whole currency units. */
export function roundingAdjustment(totals: InvoiceTotals): number {
  return round2(totals.grossAmountRounded - totals.grossAmount);
}
