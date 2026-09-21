import type { InvoiceItem } from '../models/invoice.model';
import { round, round2, roundToUnit } from '../util/money';
import { seedCodebooks } from './codebooks';
import { computeInvoice, computeLine, computeTotals, computeVatTotals } from './totals';

/**
 * These tests reproduce the worked examples УЈП publishes in
 * `docs/ujp/json-examples.pdf`. If one of them fails, the app is about to send
 * a document UJP will reject — the expected numbers here are theirs, not ours.
 */

const codebooks = seedCodebooks();

function item(overrides: Partial<InvoiceItem> = {}): InvoiceItem {
  return {
    id: 'i1',
    description: 'Артикл за тест',
    sku: '',
    unit: 'бр.',
    qty: 1,
    priceMode: 'net',
    unitPrice: 0,
    discountPercent: 0,
    vatRate: 18,
    taxIndicator: 'DDV-A',
    vatGroup: 'DDV-A',
    isDomesticProduct: false,
    ...overrides,
  };
}

/** 2000 MKD gross at 18%, expressed net — the base figure UJP's examples use. */
const NET_FROM_2000_AT_18 = 2000 / 1.18;

describe('money rounding', () => {
  it('rounds half away from zero', () => {
    expect(round2(2.675)).toBe(2.68);
    expect(round2(2.665)).toBe(2.67);
    expect(round2(-2.675)).toBe(-2.68);
    expect(round2(0.005)).toBe(0.01);
  });

  it('does not produce negative zero', () => {
    expect(Object.is(round2(-0.001), 0)).toBe(true);
  });

  it('rounds to whole units for docGrossAmountR', () => {
    expect(roundToUnit(3050.85)).toBe(3051);
    expect(roundToUnit(3050.49)).toBe(3050);
    expect(roundToUnit(0.5)).toBe(1);
  });

  it('keeps four decimals for line-level amounts', () => {
    expect(round(2000 / 1.18, 4)).toBe(1694.9153);
    expect(round(100 / 1.05, 4)).toBe(95.2381);
  });
});

describe('UJP example: Општа Фактура (100 MKD gross, 5% VAT)', () => {
  const line = computeLine(
    item({ qty: 1, priceMode: 'gross', unitPrice: 100, taxIndicator: 'DDV-B', unit: 'kg' }),
    1,
    codebooks,
  );

  it('derives the net unit price to four decimals', () => {
    expect(line.unitOriginalPriceWoVat).toBe(95.2381);
    expect(line.unitDiscountAmount).toBe(0);
    expect(line.unitPriceWoVat).toBe(95.2381);
    expect(line.unitVat).toBe(4.7619);
  });

  it('derives the line totals', () => {
    expect(line.totalOriginalPriceWoVat).toBe(95.2381);
    expect(line.totalPriceWoVat).toBe(95.2381);
    expect(line.totalVat).toBe(4.7619);
    expect(line.totalPriceWVat).toBe(100);
  });

  it('rounds the document totals to two decimals', () => {
    const totals = computeTotals([line]);
    expect(totals.netAmount).toBe(95.24);
    expect(totals.discountAmount).toBe(0);
    expect(totals.netAmountDisc).toBe(95.24);
    expect(totals.vatAmount).toBe(4.76);
    expect(totals.grossAmount).toBe(100);
    expect(totals.grossAmountRounded).toBe(100);
    expect(totals.finalAmount).toBe(100);
  });

  it('produces one VAT recap row for the 5% group', () => {
    const [row, ...rest] = computeVatTotals([line], codebooks);
    expect(rest).toEqual([]);
    expect(row.taxIndicator).toBe('DDV-B');
    expect(row.vatCode).toBe('DDV-B');
    expect(row.vatPercent).toBe(5);
    expect(row.taxableAmount).toBe(95.24);
    expect(row.vatAmount).toBe(4.76);
    expect(row.totalAmount).toBe(100);
  });
});

describe('UJP example: ослободен од данок (DDV-9, qty 2, 10% discount)', () => {
  const { lines, totals, vatTotals } = computeInvoice(
    [
      item({
        qty: 2,
        unitPrice: NET_FROM_2000_AT_18,
        discountPercent: 10,
        taxIndicator: 'DDV-9',
      }),
    ],
    codebooks,
  );

  it('matches the published line amounts', () => {
    const [line] = lines;
    expect(line.unitOriginalPriceWoVat).toBe(1694.9153);
    expect(line.unitDiscountAmount).toBe(169.4915);
    expect(line.unitPriceWoVat).toBe(1525.4237);
    expect(line.totalOriginalPriceWoVat).toBe(3389.8305);
    expect(line.totalPriceWoVat).toBe(3050.8475);
  });

  it('charges no VAT', () => {
    expect(lines[0].vatImpact).toBe('OSLOBODEN');
    expect(lines[0].unitVat).toBe(0);
    expect(lines[0].totalVat).toBe(0);
    expect(totals.vatAmount).toBe(0);
  });

  it('matches the published document totals', () => {
    expect(totals.netAmount).toBe(3389.83);
    expect(totals.discountAmount).toBe(338.98);
    expect(totals.netAmountDisc).toBe(3050.85);
    expect(totals.grossAmount).toBe(3050.85);
    expect(totals.grossAmountRounded).toBe(3051);
    expect(totals.finalAmount).toBe(3051);
  });

  it('reports the exempt turnover with a zero rate', () => {
    const [row] = vatTotals;
    expect(row.vatCode).toBe('DDV-G');
    expect(row.vatPercent).toBe(0);
    expect(row.taxableAmount).toBe(3050.85);
    expect(row.vatAmount).toBe(0);
    expect(row.totalAmount).toBe(3050.85);
  });
});

describe('UJP example: член 32 reverse charge (DDV-11-A)', () => {
  const { lines, totals, vatTotals } = computeInvoice(
    [
      item({
        qty: 2,
        unitPrice: NET_FROM_2000_AT_18,
        discountPercent: 10,
        taxIndicator: 'DDV-11-A',
      }),
    ],
    codebooks,
  );

  it('keeps the rate on the line but charges no VAT', () => {
    const [line] = lines;
    expect(line.vatImpact).toBe('PRENESEN');
    expect(line.unitVat).toBe(0);
    expect(line.totalVat).toBe(0);
    expect(line.totalPriceWoVat).toBe(3050.8475);
  });

  it('excludes the VAT from the document totals — the buyer pays net', () => {
    expect(totals.vatAmount).toBe(0);
    expect(totals.grossAmount).toBe(3050.85);
    expect(totals.grossAmountRounded).toBe(3051);
  });

  it('still reports the notional VAT the buyer must self-account', () => {
    const [row] = vatTotals;
    expect(row.taxIndicator).toBe('DDV-11-A');
    expect(row.vatCode).toBe('DDV-A');
    expect(row.vatPercent).toBe(18);
    expect(row.taxableAmount).toBe(3050.85);
    expect(row.vatAmount).toBe(549.15);
    expect(row.totalAmount).toBe(3600);
  });

  it('carries the чл. 32-а note for printing on the invoice', () => {
    expect(vatTotals[0].taxIndicatorNote).toContain('член 32-а');
  });
});

describe('mixed-rate invoice', () => {
  const { totals, vatTotals } = computeInvoice(
    [
      item({ id: 'a', qty: 1, unitPrice: 1000, taxIndicator: 'DDV-A' }),
      item({ id: 'b', qty: 2, unitPrice: 500, taxIndicator: 'DDV-V' }),
      item({ id: 'c', qty: 3, unitPrice: 100, taxIndicator: 'DDV-B' }),
    ],
    codebooks,
  );

  it('groups the recap by tax indicator', () => {
    expect(vatTotals.map((r) => r.taxIndicator)).toEqual(['DDV-A', 'DDV-B', 'DDV-V']);
    expect(vatTotals.map((r) => r.vatPercent)).toEqual([18, 5, 10]);
  });

  it('sums VAT across the rates', () => {
    // 1000*18% = 180, 1000*10% = 100, 300*5% = 15
    expect(totals.vatAmount).toBe(295);
    expect(totals.netAmountDisc).toBe(2300);
    expect(totals.grossAmount).toBe(2595);
  });

  it('keeps the recap rows summing to the document totals', () => {
    const taxable = round2(vatTotals.reduce((s, r) => s + r.taxableAmount, 0));
    const vat = round2(vatTotals.reduce((s, r) => s + r.vatAmount, 0));
    expect(taxable).toBe(totals.netAmountDisc);
    expect(vat).toBe(totals.vatAmount);
  });
});

describe('advance payments and rounding', () => {
  it('subtracts the advance from the rounded gross', () => {
    const { totals } = computeInvoice(
      [item({ qty: 1, unitPrice: 1000, taxIndicator: 'DDV-A' })],
      codebooks,
      { advanceAmount: 200 },
    );
    expect(totals.grossAmount).toBe(1180);
    expect(totals.grossAmountRounded).toBe(1180);
    expect(totals.advanceAmount).toBe(200);
    expect(totals.finalAmount).toBe(980);
  });

  it('rounds the payable amount to whole денари', () => {
    const { totals } = computeInvoice(
      [item({ qty: 3, unitPrice: 33.33, taxIndicator: 'DDV-A' })],
      codebooks,
    );
    // 99.99 net + 17.9982 VAT = 117.9882 -> 117.99 -> 118
    expect(totals.netAmountDisc).toBe(99.99);
    expect(totals.vatAmount).toBe(18);
    expect(totals.grossAmount).toBe(117.99);
    expect(totals.grossAmountRounded).toBe(118);
  });
});

describe('gross price entry', () => {
  it('treats a "with VAT" price as net on non-standard lines', () => {
    // Exempt supply: the price the buyer pays is the net price, so toggling
    // "with VAT" must not silently shrink the amount by 18%.
    const line = computeLine(
      item({ priceMode: 'gross', unitPrice: 1000, taxIndicator: 'DDV-9' }),
      1,
      codebooks,
    );
    expect(line.unitPriceWoVat).toBe(1000);
    expect(line.unitVat).toBe(0);
  });

  it('round-trips a gross price through the net conversion', () => {
    const line = computeLine(
      item({ priceMode: 'gross', unitPrice: 1180, taxIndicator: 'DDV-A' }),
      1,
      codebooks,
    );
    expect(line.unitPriceWoVat).toBe(1000);
    expect(line.unitVat).toBe(180);
    expect(line.totalPriceWVat).toBe(1180);
  });
});

describe('degenerate input', () => {
  it('survives empty invoices', () => {
    const { totals, vatTotals } = computeInvoice([], codebooks);
    expect(totals.grossAmount).toBe(0);
    expect(totals.finalAmount).toBe(0);
    expect(vatTotals).toEqual([]);
  });

  it('treats NaN quantities and prices as zero', () => {
    const line = computeLine(
      item({ qty: Number.NaN, unitPrice: Number.NaN }),
      1,
      codebooks,
    );
    expect(line.totalPriceWVat).toBe(0);
  });

  it('falls back to the stored rate for an unknown indicator', () => {
    const line = computeLine(
      item({ qty: 1, unitPrice: 100, taxIndicator: 'DDV-DOES-NOT-EXIST', vatRate: 18 }),
      1,
      codebooks,
    );
    expect(line.unitVat).toBe(18);
  });
});
