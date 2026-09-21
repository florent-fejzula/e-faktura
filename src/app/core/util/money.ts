/**
 * Money helpers.
 *
 * Every amount that ends up in a UJP payload passes through `round2`. UJP
 * re-computes the totals server-side and rejects the document when its own
 * arithmetic disagrees, so the rounding rule has to be both deterministic and
 * the same one a tax authority uses: half away from zero, not JS's `Math.round`
 * (which rounds -0.5 up to -0) and not banker's rounding.
 */

const PRECISION_DIGITS = 15;

/**
 * Rounds half away from zero at `decimals` places.
 *
 * `toPrecision(15)` first strips IEEE-754 representation noise — without it
 * `2.675 * 100` is `267.49999999999997` and would round down to `2.67`.
 */
export function round(value: number, decimals = 2): number {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** decimals;
  const scaled = Number((value * factor).toPrecision(PRECISION_DIGITS));
  const rounded = Math.sign(scaled) * Math.round(Math.abs(scaled));
  // `+ 0` normalises -0 to 0 so it never serialises as `-0` in JSON.
  return rounded / factor + 0;
}

/** Rounds to денари/cents. The default for every monetary field. */
export function round2(value: number): number {
  return round(value, 2);
}

/** Rounds to a whole currency unit — UJP's `docGrossAmountR`. */
export function roundToUnit(value: number): number {
  return round(value, 0);
}

/** Quantities allow more precision than money (e.g. 0.125 hours). */
export function round3(value: number): number {
  return round(value, 3);
}

export function sum(values: readonly number[]): number {
  return values.reduce((total, v) => total + (Number.isFinite(v) ? v : 0), 0);
}

/** Sums a projection and rounds once, at the end. */
export function sumRounded<T>(items: readonly T[], pick: (item: T) => number): number {
  return round2(sum(items.map(pick)));
}

/** Coerces user input (which may be empty, null or NaN) to a usable number. */
export function toNumber(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value !== 'string') return 0;
  const normalised = value.trim().replace(/\s/g, '').replace(',', '.');
  if (!normalised) return 0;
  const parsed = Number(normalised);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Macedonian number formatting, written out rather than delegated to `Intl`.
 *
 * `Intl.NumberFormat('mk-MK')` is not safe here. Chrome builds without the `mk`
 * CLDR data silently fall back to `en-US`, and the fallback is not a cosmetic
 * difference — 2360 renders as `2,360.00`, which a Macedonian reader parses as
 * two thousand three hundred sixty *thousandths*. On an invoice that is a
 * wrong number, not a wrong style, so the separators are fixed here and the
 * behaviour is identical in every browser.
 */
const GROUP_SEPARATOR = '.';
const DECIMAL_SEPARATOR = ',';

/** 1234.5 renders as `1.234,50` (Macedonian grouping, no currency symbol). */
export function formatAmount(value: number, decimals = 2): string {
  const rounded = round(value, decimals);
  const isNegative = rounded < 0;

  const fixed = Math.abs(rounded).toFixed(Math.max(0, decimals));
  const [whole, fraction] = fixed.split('.');

  // Insert a separator before every group of three digits from the right.
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, GROUP_SEPARATOR);

  const body = fraction ? grouped + DECIMAL_SEPARATOR + fraction : grouped;
  return isNegative ? '-' + body : body;
}

/** 1234.5 in MKD renders as `1.234,50 ден.` */
export function formatMoney(value: number, currency = 'MKD', decimals = 2): string {
  return formatAmount(value, decimals) + ' ' + currencySuffix(currency);
}

export function currencySuffix(currency: string): string {
  switch (currency) {
    case 'MKD':
      return 'ден.';
    case 'EUR':
      return '€';
    case 'USD':
      return '$';
    case 'GBP':
      return '£';
    default:
      return currency;
  }
}
