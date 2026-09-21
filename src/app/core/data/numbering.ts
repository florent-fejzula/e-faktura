import type { NumberingConfig, NumberingReset } from '../models/company.model';
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

  // Crossing into a new year or month restarts the sequence at 1.
  const seq = config.periodKey === periodKey ? Math.max(1, config.nextSeq) : 1;

  return {
    number: renderInvoiceNumber(config, { seq, issueDate }),
    seq,
    periodKey,
    nextConfig: { ...config, nextSeq: seq + 1, periodKey },
  };
}

/** Human-readable preview for the settings screen. */
export function previewNumbering(config: NumberingConfig, issueDate: IsoDate): string {
  const periodKey = periodKeyFor(config.reset, issueDate);
  const seq = config.periodKey === periodKey ? Math.max(1, config.nextSeq) : 1;
  return renderInvoiceNumber(config, { seq, issueDate });
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
