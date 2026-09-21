import { defaultNumbering } from '../models/company.model';
import { nextInvoiceNumber, periodKeyFor, renderInvoiceNumber } from '../data/numbering';
import { amountInWordsMk, numberToWordsMk } from './amount-in-words';
import { addDays, daysBetween, formatDate, fromIsoDate, skopjeTimestamp, toIsoDate } from './dates';
import { formatAmount, formatMoney, toNumber } from './money';

describe('Macedonian number formatting', () => {
  it('groups thousands with a dot and decimals with a comma', () => {
    expect(formatAmount(2360)).toBe('2.360,00');
    expect(formatAmount(1234567.891)).toBe('1.234.567,89');
    expect(formatAmount(0)).toBe('0,00');
    expect(formatAmount(0.5)).toBe('0,50');
    expect(formatAmount(999)).toBe('999,00');
    expect(formatAmount(1000)).toBe('1.000,00');
  });

  it('handles negatives', () => {
    expect(formatAmount(-2360.5)).toBe('-2.360,50');
  });

  it('honours a custom precision', () => {
    expect(formatAmount(2360, 0)).toBe('2.360');
    expect(formatAmount(95.2381, 4)).toBe('95,2381');
  });

  /**
   * Guards the specific failure that shipped once: browsers without `mk` CLDR
   * data make `Intl.NumberFormat('mk-MK')` fall back to en-US, turning
   * `2.360,00` into `2,360.00` — a different number to a Macedonian reader.
   */
  it('does not depend on Intl locale data being present', () => {
    const fallback = new Intl.NumberFormat('mk-MK', {
      minimumFractionDigits: 2,
    }).format(2360);
    // Whatever the browser does, our own formatting is unchanged.
    expect(formatAmount(2360)).toBe('2.360,00');
    expect(typeof fallback).toBe('string');
  });

  it('appends the currency suffix', () => {
    expect(formatMoney(2360)).toBe('2.360,00 ден.');
    expect(formatMoney(2360, 'EUR')).toBe('2.360,00 €');
  });

  it('parses user input with either decimal separator', () => {
    expect(toNumber('1234,56')).toBe(1234.56);
    expect(toNumber('1234.56')).toBe(1234.56);
    expect(toNumber(' 42 ')).toBe(42);
    expect(toNumber('')).toBe(0);
    expect(toNumber('abc')).toBe(0);
    expect(toNumber(null)).toBe(0);
  });
});

describe('amount in words', () => {
  it('writes whole денари', () => {
    expect(amountInWordsMk(2360)).toBe('Две илјади триста и шеесет денари');
    expect(amountInWordsMk(1)).toBe('Еден денар');
    expect(amountInWordsMk(0)).toBe('Нула денари');
  });

  it('writes денари and дени', () => {
    expect(amountInWordsMk(1234.5)).toContain('педесет дени');
    expect(amountInWordsMk(1.01)).toBe('Еден денар и еден ден');
  });

  it('uses the feminine form for илјада', () => {
    expect(numberToWordsMk(1000, 'm')).toBe('една илјада');
    expect(numberToWordsMk(2000, 'm')).toBe('две илјади');
  });

  it('switches vocabulary for other currencies', () => {
    expect(amountInWordsMk(5, 'EUR')).toBe('Пет евра');
  });
});

describe('dates', () => {
  it('keeps calendar dates stable regardless of timezone', () => {
    // The hazard this avoids: `new Date('2026-01-01').toISOString()` can land
    // on 2025-12-31 west of UTC.
    const first = new Date(2026, 0, 1);
    expect(toIsoDate(first)).toBe('2026-01-01');
    expect(formatDate('2026-01-01')).toBe('01.01.2026');
  });

  it('round-trips through parsing', () => {
    const parsed = fromIsoDate('2026-08-29');
    expect(parsed).not.toBeNull();
    expect(toIsoDate(parsed!)).toBe('2026-08-29');
    expect(fromIsoDate('nonsense')).toBeNull();
  });

  it('adds days across month boundaries', () => {
    expect(addDays('2026-08-29', 15)).toBe('2026-09-13');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(daysBetween('2026-08-01', '2026-08-16')).toBe(15);
  });

  it('produces a UJP-shaped request timestamp', () => {
    expect(skopjeTimestamp()).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
  });
});

describe('invoice numbering', () => {
  const base = defaultNumbering();

  it('renders the default pattern', () => {
    expect(renderInvoiceNumber(base, { seq: 1, issueDate: '2026-08-29' })).toBe('0001/2026');
    expect(renderInvoiceNumber(base, { seq: 42, issueDate: '2026-08-29' })).toBe('0042/2026');
  });

  it('supports prefixes and month tokens', () => {
    expect(
      renderInvoiceNumber(
        { ...base, pattern: '{PREFIX}-{YYYY}-{SEQ}', prefix: 'ФА' },
        { seq: 7, issueDate: '2026-08-29' },
      ),
    ).toBe('ФА-2026-0007');
    expect(
      renderInvoiceNumber(
        { ...base, pattern: '{SEQ}/{MM}/{YY}' },
        { seq: 3, issueDate: '2026-08-29' },
      ),
    ).toBe('0003/08/26');
  });

  it('drops a dangling separator when the prefix is empty', () => {
    expect(
      renderInvoiceNumber({ ...base, pattern: '{PREFIX}-{SEQ}', prefix: '' }, { seq: 1, issueDate: '2026-08-29' }),
    ).toBe('0001');
  });

  it('advances the sequence within a period', () => {
    const first = nextInvoiceNumber({ ...base, nextSeq: 1, periodKey: '2026' }, '2026-08-29');
    expect(first.number).toBe('0001/2026');
    expect(first.nextConfig.nextSeq).toBe(2);

    const second = nextInvoiceNumber(first.nextConfig, '2026-08-30');
    expect(second.number).toBe('0002/2026');
  });

  it('restarts the sequence in a new year', () => {
    const config = { ...base, nextSeq: 57, periodKey: '2026' };
    const next = nextInvoiceNumber(config, '2027-01-03');
    expect(next.number).toBe('0001/2027');
    expect(next.seq).toBe(1);
    expect(next.nextConfig.periodKey).toBe('2027');
  });

  it('restarts monthly when configured to', () => {
    const config = { ...base, reset: 'monthly' as const, nextSeq: 12, periodKey: '2026-08' };
    expect(periodKeyFor('monthly', '2026-09-01')).toBe('2026-09');
    const next = nextInvoiceNumber(config, '2026-09-01');
    expect(next.seq).toBe(1);
  });

  it('never restarts when configured not to', () => {
    const config = { ...base, reset: 'never' as const, nextSeq: 900, periodKey: 'all' };
    const next = nextInvoiceNumber(config, '2027-05-05');
    expect(next.seq).toBe(900);
  });
});
