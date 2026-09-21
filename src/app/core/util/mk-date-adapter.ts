import { Injectable } from '@angular/core';
import { NativeDateAdapter } from '@angular/material/core';

/**
 * Macedonian calendar labels, spelled out instead of read from ICU.
 *
 * `NativeDateAdapter` derives month and weekday names from
 * `Intl.DateTimeFormat`, which falls back to English on any browser build that
 * ships without the `mk` CLDR data — the same gap that makes
 * `Intl.NumberFormat('mk-MK')` unreliable. Since this app is Macedonian-only,
 * hardcoding the names is both simpler and guaranteed correct.
 */
const MONTHS_LONG = [
  'јануари',
  'февруари',
  'март',
  'април',
  'мај',
  'јуни',
  'јули',
  'август',
  'септември',
  'октомври',
  'ноември',
  'декември',
];

const MONTHS_SHORT = [
  'јан',
  'фев',
  'мар',
  'апр',
  'мај',
  'јун',
  'јул',
  'авг',
  'сеп',
  'окт',
  'ное',
  'дек',
];

const DAYS_LONG = [
  'недела',
  'понеделник',
  'вторник',
  'среда',
  'четврток',
  'петок',
  'сабота',
];
const DAYS_SHORT = ['нед', 'пон', 'вто', 'сре', 'чет', 'пет', 'саб'];
const DAYS_NARROW = ['н', 'п', 'в', 'с', 'ч', 'п', 'с'];

const pad = (n: number) => String(n).padStart(2, '0');

@Injectable()
export class MkDateAdapter extends NativeDateAdapter {
  override getMonthNames(style: 'long' | 'short' | 'narrow'): string[] {
    if (style === 'long') return [...MONTHS_LONG];
    if (style === 'short') return [...MONTHS_SHORT];
    return MONTHS_SHORT.map((m) => m[0]);
  }

  override getDayOfWeekNames(style: 'long' | 'short' | 'narrow'): string[] {
    if (style === 'long') return [...DAYS_LONG];
    if (style === 'short') return [...DAYS_SHORT];
    return [...DAYS_NARROW];
  }

  override getDateNames(): string[] {
    return Array.from({ length: 31 }, (_, i) => String(i + 1));
  }

  /** Macedonian weeks start on Monday. */
  override getFirstDayOfWeek(): number {
    return 1;
  }

  override format(date: Date, displayFormat: unknown): string {
    if (!this.isValid(date)) return '';
    const format = displayFormat as { month?: string; day?: string; year?: string } | undefined;

    // Calendar header ("август 2026") — month and year, no day.
    if (format?.month && format?.year && !format?.day) {
      const name = format.month === 'short' ? MONTHS_SHORT : MONTHS_LONG;
      return `${name[date.getMonth()]} ${date.getFullYear()}`;
    }

    // Accessible label for a single date.
    if (format?.month === 'long' && format?.day) {
      return `${date.getDate()} ${MONTHS_LONG[date.getMonth()]} ${date.getFullYear()}`;
    }

    return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()}`;
  }

  /**
   * Accepts what a Macedonian user actually types: `29.08.2026`, `29/08/2026`
   * or `29-8-26`. Falls back to the native parser for anything else.
   */
  override parse(value: unknown): Date | null {
    if (typeof value === 'string') {
      const match = /^\s*(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})\s*$/.exec(value);
      if (match) {
        const day = Number(match[1]);
        const month = Number(match[2]);
        let year = Number(match[3]);
        if (year < 100) year += year < 70 ? 2000 : 1900;
        const date = new Date(year, month - 1, day);
        // Reject impossible dates like 31.02 that Date would silently roll over.
        return date.getDate() === day && date.getMonth() === month - 1 ? date : null;
      }
    }
    return super.parse(value);
  }
}
