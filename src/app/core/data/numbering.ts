import type { NumberingConfig, NumberingReset } from '../models/company.model';
import type { Invoice } from '../models/invoice.model';
import { monthOf, yearOf, type IsoDate } from '../util/dates';

/**
 * Invoice numbering.
 *
 * Numbers are assigned when a draft is *issued*, never when it is created —
 * otherwise abandoned drafts punch holes in the sequence, which is exactly what
 * an audit looks for. The sequence lives on the company document and is bumped
 * inside a transaction so two people issuing at the same moment cannot collide.
 */

/** Period a sequence resets on, derived from the invoice's issue date. */
export function periodKeyFor(reset: NumberingReset, issueDate: IsoDate): string {
  switch (reset) {
    case 'yearly':
      return String(yearOf(issueDate));
    case 'monthly':
      return `${yearOf(issueDate)}-${String(monthOf(issueDate)).padStart(2, '0')}`;
    case 'never':
      return 'all';
  }
}

export interface RenderContext {
  seq: number;
  issueDate: IsoDate;
}

/**
 * Substitutes the pattern tokens. Unknown tokens are left untouched so a typo
 * is visible in the result instead of silently vanishing.
 */
export function renderInvoiceNumber(config: NumberingConfig, ctx: RenderContext): string {
  const year = yearOf(ctx.issueDate);
  const month = String(monthOf(ctx.issueDate)).padStart(2, '0');
  const padding = Math.max(0, Math.min(12, config.padding ?? 0));

  return (config.pattern || '{SEQ}/{YYYY}')
    .replace(/\{SEQ\}/g, String(ctx.seq).padStart(padding, '0'))
    .replace(/\{YYYY\}/g, String(year))
    .replace(/\{YY\}/g, String(year).slice(-2))
    .replace(/\{MM\}/g, month)
    .replace(/\{PREFIX\}/g, config.prefix ?? '')
    // A blank prefix leaves a dangling separator, e.g. "-2026-0007".
    .replace(/^[-/_\s]+/, '')
    .trim();
}

/**
 * Sequence the next invoice dated `issueDate` will take. A counter left over
 * from an earlier period restarts at 1, so this — not `nextSeq` — is what the
 * settings screen shows and edits.
 */
export function effectiveNextSeq(config: NumberingConfig, issueDate: IsoDate): number {
  // Crossing into a new year or month restarts the sequence at 1.
  return config.periodKey === periodKeyFor(config.reset, issueDate)
    ? Math.max(1, config.nextSeq)
    : 1;
}

/**
 * Why a format would hand out the same number twice under its reset, or null.
 *
 * A counter that starts again at 1 every year has to print the year, or each
 * January's first invoice repeats the last January's number; one that starts
 * again every month has to print the month as well. The settings screen and
 * onboarding refuse such a pair before the first invoice ever needs it.
 */
export function numberingPatternProblem(pattern: string, reset: NumberingReset): string | null {
  if (!pattern.includes('{SEQ}')) {
    return 'Форматот мора да содржи {SEQ} — без реден број сите фактури би го добиле истиот број.';
  }
  const hasYear = pattern.includes('{YYYY}') || pattern.includes('{YY}');
  if (reset === 'yearly' && !hasYear) {
    return (
      'Бројачот почнува од 1 секоја година, па форматот мора да ја содржи годината ' +
      '({YYYY} или {YY}) — инаку бројот се повторува. Или изберете ресетирање „Никогаш“.'
    );
  }
  if (reset === 'monthly' && !(hasYear && pattern.includes('{MM}'))) {
    return (
      'Бројачот почнува од 1 секој месец, па форматот мора да ги содржи годината и месецот ' +
      '({YYYY} и {MM}) — инаку бројот се повторува.'
    );
  }
  return null;
}

/**
 * Highest sequence already issued in the period `date` falls in under `reset`
 * — 0 when there is none. The counter may never be set at or below it: within
 * a period the sequence only moves forward, or a number comes round twice.
 *
 * Counts every numbered invoice dated in that period, whichever scheme it was
 * numbered under. So switching from a yearly to a monthly counter in October,
 * with 2026-10-004 already out, continues October at 5 and starts November at 1.
 */
export function highestSeqInPeriod(
  invoices: readonly Pick<Invoice, 'seq' | 'year' | 'month'>[],
  reset: NumberingReset,
  date: IsoDate,
): number {
  const year = yearOf(date);
  const month = monthOf(date);
  return invoices
    .filter((i) => reset === 'never' || i.year === year)
    .filter((i) => reset !== 'monthly' || i.month === month)
    .reduce((highest, i) => Math.max(highest, i.seq ?? 0), 0);
}

/**
 * Next number for a company, plus the config to write back.
 *
 * Returns the updated config rather than mutating, so the caller can commit it
 * inside the same transaction that stores the invoice.
 */
export function nextInvoiceNumber(
  config: NumberingConfig,
  issueDate: IsoDate,
): { number: string; seq: number; periodKey: string; nextConfig: NumberingConfig } {
  const periodKey = periodKeyFor(config.reset, issueDate);
  const seq = effectiveNextSeq(config, issueDate);

  return {
    number: renderInvoiceNumber(config, { seq, issueDate }),
    seq,
    periodKey,
    nextConfig: { ...config, nextSeq: seq + 1, periodKey },
  };
}

/** Human-readable preview for the settings screen. */
export function previewNumbering(config: NumberingConfig, issueDate: IsoDate): string {
  return renderInvoiceNumber(config, { seq: effectiveNextSeq(config, issueDate), issueDate });
}

export const NUMBERING_TOKENS: readonly { token: string; label: string }[] = [
  { token: '{SEQ}', label: 'Реден број' },
  { token: '{YYYY}', label: 'Година (2026)' },
  { token: '{YY}', label: 'Година (26)' },
  { token: '{MM}', label: 'Месец (08)' },
  { token: '{PREFIX}', label: 'Префикс' },
];

export const NUMBERING_PRESETS: readonly { label: string; pattern: string }[] = [
  { label: '0001/2026', pattern: '{SEQ}/{YYYY}' },
  { label: '2026-0001', pattern: '{YYYY}-{SEQ}' },
  { label: 'ФА-2026-0001', pattern: '{PREFIX}-{YYYY}-{SEQ}' },
  { label: '0001/08/2026', pattern: '{SEQ}/{MM}/{YYYY}' },
  { label: '2026-08-0001', pattern: '{YYYY}-{MM}-{SEQ}' },
  { label: '0001', pattern: '{SEQ}' },
];
