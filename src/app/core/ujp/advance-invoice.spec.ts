import { emptyAddress } from '../models/common.model';
import {
  DOC_TYPES,
  docLabel,
  isAdvanceInvoice,
  type Invoice,
  type InvoiceItem,
} from '../models/invoice.model';
import { shareBody, shareSubject } from '../util/share';
import { seedCodebooks } from './codebooks';
import { buildUjpPayload } from './ujp-document.builder';

/**
 * The example the feature was built around: a 100.000 ден. job at 18%, half
 * paid up front. The advance invoice is for 59.000; the final invoice is for
 * the whole job and deducts it, leaving 59.000 to pay.
 */

const codebooks = seedCodebooks();

function line(description: string, unitPrice: number): InvoiceItem {
  return {
    id: description,
    description,
    sku: '',
    unit: 'услуга',
    qty: 1,
    priceMode: 'net',
    unitPrice,
    discountPercent: 0,
    vatRate: 18,
    taxIndicator: 'DDV-A',
    vatGroup: 'DDV-A',
    isDomesticProduct: false,
  };
}

function invoice(overrides: Partial<Invoice>): Invoice {
  const party = { name: 'КУПУВАЧ ДОО', taxNumber: '4080012345678', address: emptyAddress() };
  return {
    id: 'inv',
    docType: DOC_TYPES.invoice.code,
    docTypeName: DOC_TYPES.invoice.name,
    docStorno: 0,
    number: '0007/2026',
    issueDate: '2026-12-10',
    turnoverDate: '2026-12-10',
    dueDate: '2026-12-25',
    seller: { ...party, name: 'ПРОДАВАЧ ДООЕЛ', vatNumber: '', isVatRegistered: true },
    client: { ...party, vatNumber: '' },
    currency: 'MKD',
    exchangeRate: 1,
    paymentTypeCode: 'P12',
    paymentTypeDesc: 'Плаќање преку банка',
    items: [line('Изработка', 100000)],
    advanceAmount: 0,
    advanceDate: null,
    advanceDescription: '',
    references: [],
    notes: '',
    headerText: '',
    footerText: '',
    ...overrides,
  } as unknown as Invoice;
}

describe('advance invoices', () => {
  const advance = invoice({
    docType: DOC_TYPES.advance.code,
    docTypeName: DOC_TYPES.advance.name,
    number: '0005/2026',
    issueDate: '2026-11-05',
    items: [line('Аванс за изработка', 50000)],
    totals: { finalAmount: 59000 } as Invoice['totals'],
  });

  it('are told apart by their УЈП type', () => {
    expect(isAdvanceInvoice(advance)).toBe(true);
    expect(isAdvanceInvoice(invoice({}))).toBe(false);
    expect(docLabel(advance)).toBe('Авансна фактура');
  });

  it('go to УЈП as type 130, for the advance and its ДДВ', () => {
    const { document } = buildUjpPayload(advance, codebooks);
    expect(document.header.docType).toBe('130');
    expect(document.header.docTypeName).toBe('Авансна фактура');
    expect(document.docTotals.docVatAmount).toBe(9000);
    expect(document.docTotals.docGrossAmountR).toBe(59000);
  });

  it('carry none of the deduction fields, which УЈП defines only on a Фактура', () => {
    const { document } = buildUjpPayload(advance, codebooks);
    expect('docAvansAmount' in document.docTotals).toBe(false);
    expect('docFinalAmount' in document.docTotals).toBe(false);
  });

  it('are deducted on the final invoice, which states what is left', () => {
    const final = invoice({
      advanceAmount: 59000,
      advanceDate: '2026-11-05',
      advanceDescription: 'Авансна фактура бр. 0005/2026',
    });
    const { document } = buildUjpPayload(final, codebooks);
    expect(document.header.docType).toBe('100');
    expect(document.docTotals.docGrossAmountR).toBe(118000);
    expect(document.docTotals.docAvansAmount).toBe(59000);
    expect(document.docTotals.docAvansDate).toBe('2026-11-05');
    expect(document.docTotals.docFinalAmount).toBe(59000);
  });

  it('are shared as a receipt for money received, not as a bill', () => {
    expect(shareSubject(advance)).toBe('Авансна фактура 0005/2026 — ПРОДАВАЧ ДООЕЛ');
    const body = shareBody(advance);
    expect(body).toContain('авансна фактура бр. 0005/2026');
    expect(body).toContain('Примен аванс: 59.000,00 MKD');
    expect(body).not.toContain('Рок на плаќање');
  });
});
