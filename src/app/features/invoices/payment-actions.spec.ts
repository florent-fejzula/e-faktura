import { paymentStatusFor } from '../../core/models/invoice.model';
import { toIsoDate, todayIso } from '../../core/util/dates';
import { paidAtFor, paidOn } from './payment-actions';

describe('recording a payment', () => {
  it('reads nothing, part or all of the amount', () => {
    expect(paymentStatusFor(0, 6150)).toBe('unpaid');
    expect(paymentStatusFor(3000, 6150)).toBe('partial');
    expect(paymentStatusFor(6150, 6150)).toBe('paid');
  });

  it('does not leave an invoice "partial" over a rounding difference', () => {
    expect(paymentStatusFor(6149.996, 6150)).toBe('paid');
    expect(paymentStatusFor(6149.99, 6150)).toBe('partial');
  });

  it('stores an earlier day at its noon, so it reads back as that day', () => {
    const at = paidAtFor(new Date(2026, 9, 24));
    expect(new Date(at).getHours()).toBe(12);
    expect(toIsoDate(new Date(at))).toBe('2026-10-24');
  });

  it('stores today as now', () => {
    const before = Date.now();
    const at = paidAtFor(new Date());
    expect(at).toBeGreaterThanOrEqual(before);
    expect(toIsoDate(new Date(at))).toBe(todayIso());
  });

  it('gives the day the money arrived, only once some has', () => {
    const at = new Date(2026, 9, 24, 12).getTime();
    expect(paidOn({ paymentStatus: 'paid', paidAt: at })).toBe('2026-10-24');
    expect(paidOn({ paymentStatus: 'partial', paidAt: at })).toBe('2026-10-24');
    expect(paidOn({ paymentStatus: 'unpaid', paidAt: at })).toBeNull();
    expect(paidOn({ paymentStatus: 'paid', paidAt: null })).toBeNull();
  });
});
