import { emptyAddress } from '../../core/models/common.model';
import type { Invoice } from '../../core/models/invoice.model';
import { seedCodebooks } from '../../core/ujp/codebooks';
import { computeInvoice } from '../../core/ujp/totals';
import { validateInvoice } from '../../core/ujp/ujp-validator';
import { describeProblems, listMk } from './invoice-problems';

const codebooks = seedCodebooks();

const address = {
  ...emptyAddress(),
  streetAddress: 'Партизански одреди',
  streetNumber: '12',
  postalCode: '1000',
  city: 'Скопје',
};

/** A complete invoice, then whatever a case takes away from it. */
function invoice(overrides: Partial<Invoice> = {}): Invoice {
  const base = {
    id: 'inv',
    status: '00',
    docType: '100',
    docTypeName: 'Фактура',
    docStorno: 0,
    number: '',
    issueDate: '2026-11-03',
    turnoverDate: '2026-11-03',
    dueDate: '2026-11-18',
    seller: {
      name: 'ПРОДАВАЧ ДООЕЛ',
      taxNumber: '4030000000001',
      vatNumber: '',
      isVatRegistered: true,
      address,
    },
    client: { id: 'c1', name: 'КУПУВАЧ ДОО', taxNumber: '4080012345678', vatNumber: '', address },
    currency: 'MKD',
    exchangeRate: 1,
    paymentTypeCode: 'P12',
    paymentTypeDesc: 'Плаќање преку банка',
    items: [
      {
        id: 'l1',
        description: 'Печатење',
        sku: '',
        unit: 'ком',
        qty: 1,
        priceMode: 'net',
        unitPrice: 1000,
        discountPercent: 0,
        vatRate: 18,
        taxIndicator: 'DDV-A',
        vatGroup: 'DDV-A',
        isDomesticProduct: false,
      },
    ],
    advanceAmount: 0,
    advanceDate: null,
    advanceDescription: '',
    references: [],
    notes: '',
    headerText: '',
    footerText: '',
    ...overrides,
  } as unknown as Invoice;
  const { totals, vatTotals } = computeInvoice(base.items, codebooks, {
    advanceAmount: base.advanceAmount,
  });
  return { ...base, totals, vatTotals } as Invoice;
}

function problemsOf(inv: Invoice) {
  return describeProblems(inv, validateInvoice(inv, codebooks).errors);
}

describe('editor problems', () => {
  it('are none for a complete invoice', () => {
    const problems = problemsOf(invoice());
    expect(problems.fields.size).toBe(0);
    expect(problems.client).toBeNull();
    expect(problems.lines.size).toBe(0);
    expect(problems.other).toEqual([]);
  });

  it('ask for a buyer, once, when none is chosen', () => {
    const problems = problemsOf(
      invoice({ client: { name: '', taxNumber: '', vatNumber: '', address: emptyAddress() } } as never),
    );
    expect(problems.client).toBe('Изберете купувач или додадете нов.');
    expect(problems.fields.has('client')).toBe(true);
    expect(problems.other).toEqual([]);
  });

  it("gather a chosen buyer's missing details into one line", () => {
    const problems = problemsOf(
      invoice({
        client: {
          id: 'c1',
          name: 'КУПУВАЧ ДОО',
          taxNumber: '',
          vatNumber: '',
          address: { ...emptyAddress(), city: 'Скопје' },
        },
      } as never),
    );
    expect(problems.client).toBe(
      'Во податоците за купувачот недостига ЕДБ, улица, број на улица и поштенски број.',
    );
  });

  it('say what is wrong with a buyer that is not just missing something', () => {
    const problems = problemsOf(
      invoice({
        client: { id: 'c1', name: 'КУПУВАЧ ДОО', taxNumber: '408001', vatNumber: '', address },
      } as never),
    );
    expect(problems.client).toBe('ЕДБ мора да има точно 13 цифри (внесено: 6).');
  });

  it('put a line problem under its line, as what to do', () => {
    const inv = invoice();
    const items = [
      inv.items[0],
      { ...inv.items[0], id: 'l2', description: ' ', qty: 0 },
    ];
    const problems = problemsOf(invoice({ items }));
    expect(problems.lines.get(0)).toBeUndefined();
    expect(problems.lines.get(1)).toBe('Внесете опис. Количината мора да биде поголема од 0.');
    expect(problems.fields.has('items.1.description')).toBe(true);
    expect(problems.fields.has('items.1.qty')).toBe(true);
  });

  it('put a Детали problem under its field', () => {
    const problems = problemsOf(invoice({ advanceAmount: 5000 }));
    expect(problems.details.get('advanceAmount')).toBe(
      'Авансот е поголем од вкупниот износ на фактурата.',
    );
    expect(problems.fields.has('advanceAmount')).toBe(true);
  });

  it("send the company's own missing data to Поставки", () => {
    const inv = invoice();
    const problems = problemsOf(
      invoice({ seller: { ...inv.seller, address: { ...address, streetNumber: '' } } }),
    );
    expect(problems.seller).toBe(true);
    expect(problems.other).toEqual(['Во податоците за вашата фирма недостига број на улица.']);
    expect(problems.fields.size).toBe(0);
  });

  it('keep what has no field on this screen as the validator said it', () => {
    const problems = problemsOf(invoice({ items: [] }));
    expect(problems.other).toEqual(['Фактурата нема ниту една ставка.']);
    expect(problems.seller).toBe(false);
  });

  it('list fields the Macedonian way', () => {
    expect(listMk([])).toBe('');
    expect(listMk(['улица'])).toBe('улица');
    expect(listMk(['улица', 'град'])).toBe('улица и град');
    expect(listMk(['ЕДБ', 'улица', 'град'])).toBe('ЕДБ, улица и град');
  });
});
