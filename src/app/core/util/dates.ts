/**
 * Date helpers.
 *
 * Invoice dates are calendar dates, not instants. Storing them as `YYYY-MM-DD`
 * strings (rather than epoch millis or Firestore Timestamps) keeps an invoice
 * issued on the 1st from drifting to the 31st when it is read in another
 * timezone — a real hazard because `toISOString()` converts to UTC first.
 */

export type IsoDate = string;

const TWO = (n: number) => String(n).padStart(2, '0');

/** Local calendar date of a `Date`, as `YYYY-MM-DD`. */
export function toIsoDate(date: Date): IsoDate {
  return `${date.getFullYear()}-${TWO(date.getMonth() + 1)}-${TWO(date.getDate())}`;
}

/** Today, in the browser's local calendar. */
export function todayIso(): IsoDate {
  return toIsoDate(new Date());
}

/** Parses `YYYY-MM-DD` into a local-midnight `Date`. Invalid input gives null. */
export function fromIsoDate(value: IsoDate | null | undefined): Date | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const [, y, m, d] = match;
  const date = new Date(Number(y), Number(m) - 1, Number(d));
  return Number.isNaN(date.getTime()) ? null : date;
}

export function addDays(value: IsoDate, days: number): IsoDate {
  const date = fromIsoDate(value);
  if (!date) return value;
  date.setDate(date.getDate() + days);
  return toIsoDate(date);
}

/** Whole days from `from` to `to`; negative when `to` is earlier. */
export function daysBetween(from: IsoDate, to: IsoDate): number {
  const a = fromIsoDate(from);
  const b = fromIsoDate(to);
  if (!a || !b) return 0;
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

/** `2026-08-29` renders as `29.08.2026`, the Macedonian convention. */
export function formatDate(value: IsoDate | null | undefined): string {
  const date = fromIsoDate(value ?? null);
  if (!date) return '';
  return `${TWO(date.getDate())}.${TWO(date.getMonth() + 1)}.${date.getFullYear()}`;
}

export function yearOf(value: IsoDate): number {
  return Number(value.slice(0, 4)) || new Date().getFullYear();
}

export function monthOf(value: IsoDate): number {
  return Number(value.slice(5, 7)) || new Date().getMonth() + 1;
}

const SKOPJE_PARTS = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Skopje',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

/**
 * `requestTimestamp` for the UJP API: `YYYY-MM-DDTHH:mm:ss` in Europe/Skopje.
 *
 * UJP rejects anything more than ~5 minutes from its own server clock (replay
 * protection), and the value is inside the signed JWS, so it cannot be patched
 * after signing. `/api/v1/server-time` is the authoritative source when the
 * local clock is suspect.
 */
export function skopjeTimestamp(at: Date = new Date()): string {
  const parts = SKOPJE_PARTS.formatToParts(at);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? '00';
  // `en-CA` gives 24-hour time but renders midnight as "24" in some engines.
  const hour = get('hour') === '24' ? '00' : get('hour');
  return `${get('year')}-${get('month')}-${get('day')}T${hour}:${get('minute')}:${get('second')}`;
}

/** Calendar date in Skopje — used for `docCurrencyDate` and defaults. */
export function skopjeToday(): IsoDate {
  return skopjeTimestamp().slice(0, 10);
}

/** First and last day of a month, for the list view's quick date filters. */
export function monthRange(year: number, month: number): { from: IsoDate; to: IsoDate } {
  const from = `${year}-${TWO(month)}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  return { from, to: `${year}-${TWO(month)}-${TWO(lastDay)}` };
}

export function quarterRange(year: number, quarter: number): { from: IsoDate; to: IsoDate } {
  const startMonth = (quarter - 1) * 3 + 1;
  const start = monthRange(year, startMonth);
  const end = monthRange(year, startMonth + 2);
  return { from: start.from, to: end.to };
}

export function yearRange(year: number): { from: IsoDate; to: IsoDate } {
  return { from: `${year}-01-01`, to: `${year}-12-31` };
}
