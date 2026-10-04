import { enabledModules, hasModule } from '../modules/modules';
import { resolveIndicator, seedCodebooks } from '../ujp/codebooks';
import {
  CATALOG_LIMITS,
  applyCatalogItem,
  catalogFieldsFromLine,
  findByName,
  type CatalogItem,
} from './catalog.model';
import type { InvoiceItem } from './invoice.model';

function line(overrides: Partial<InvoiceItem> = {}): InvoiceItem {
  return {
    id: 'line-1',
    description: '',
    sku: '',
    unit: 'ком',
    qty: 3,
    priceMode: 'net',
    unitPrice: 0,
    discountPercent: 10,
    vatRate: 18,
    taxIndicator: 'DDV-A',
    vatGroup: 'DDV-A',
    isDomesticProduct: false,
    ...overrides,
  };
}

function entry(overrides: Partial<CatalogItem> = {}): CatalogItem {
  return {
    id: 'cat-1',
    companyId: 'co-1',
    name: 'Печатење А4 ц/б',
    sku: 'P-A4',
    unit: 'лист',
    priceMode: 'gross',
    unitPrice: 5,
    taxIndicator: 'DDV-A',
    vatGroup: 'DDV-A',
    vatRate: 18,
    createdAt: 0,
    updatedAt: 0,
    createdByUid: 'u',
    updatedByUid: 'u',
    ...overrides,
  };
}

describe('modules', () => {
  it('treats a company without the field as having none', () => {
    expect(hasModule(undefined, 'catalog')).toBeFalse();
    expect(hasModule({}, 'catalog')).toBeFalse();
    expect(enabledModules(undefined)).toEqual([]);
  });

  it('is on only when explicitly true', () => {
    expect(hasModule({ catalog: true }, 'catalog')).toBeTrue();
    expect(hasModule({ catalog: false }, 'catalog')).toBeFalse();
    expect(enabledModules({ catalog: true }).map((m) => m.id)).toEqual(['catalog']);
  });
});

describe('price list → invoice line', () => {
  it('takes what is sold and its price from the entry', () => {
    const filled = applyCatalogItem(line(), entry());
    expect(filled.description).toBe('Печатење А4 ц/б');
    expect(filled.sku).toBe('P-A4');
    expect(filled.unit).toBe('лист');
    expect(filled.unitPrice).toBe(5);
    expect(filled.priceMode).toBe('gross');
  });

  it('keeps the quantity, discount and row id that belong to this sale', () => {
    const filled = applyCatalogItem(line({ qty: 250, discountPercent: 10 }), entry());
    expect(filled.qty).toBe(250);
    expect(filled.discountPercent).toBe(10);
    expect(filled.id).toBe('line-1');
  });

  it('carries the tax treatment as a consistent set', () => {
    const reverseCharge = entry({ taxIndicator: 'DDV-11-A', vatGroup: 'DDV-A', vatRate: 18 });
    const filled = applyCatalogItem(line({ taxIndicator: 'DDV-B', vatGroup: 'DDV-B', vatRate: 5 }), reverseCharge);
    expect([filled.taxIndicator, filled.vatGroup, filled.vatRate]).toEqual(['DDV-11-A', 'DDV-A', 18]);
  });
});

describe('invoice line → price list', () => {
  it('trims and clamps to the limits UJP will accept', () => {
    const long = 'x'.repeat(CATALOG_LIMITS.name + 50);
    const fields = catalogFieldsFromLine(line({ description: `  ${long}  `, unit: ' лист ' }));
    expect(fields.name.length).toBe(CATALOG_LIMITS.name);
    expect(fields.unit).toBe('лист');
  });

  it('round-trips: saving a line and picking it again gives the same line', () => {
    const original = line({ description: 'Постер А3', unit: 'ком', unitPrice: 120, priceMode: 'gross' });
    const saved = entry({ ...catalogFieldsFromLine(original) });
    expect(applyCatalogItem(line(), saved)).toEqual({ ...original, qty: 3, discountPercent: 10 });
  });
});

describe('finding an entry by name', () => {
  const list = [entry({ id: 'a', name: 'Печатење А4 ц/б' }), entry({ id: 'b', name: 'Постер А3' })];

  it('ignores case and Latin/Cyrillic spelling', () => {
    expect(findByName(list, 'ПОСТЕР А3')?.id).toBe('b');
    expect(findByName(list, 'poster a3')?.id).toBe('b');
  });

  it('does not confuse A3 with A4', () => {
    expect(findByName(list, 'Постер А4')).toBeNull();
  });

  it('finds nothing for an empty name', () => {
    expect(findByName(list, '   ')).toBeNull();
  });
});

describe('resolving a tax indicator', () => {
  const set = seedCodebooks();

  it('gives standard VAT its rate and allows a with-VAT price', () => {
    expect(resolveIndicator(set, 'DDV-A')).toEqual({
      taxIndicator: 'DDV-A',
      vatGroup: 'DDV-A',
      vatRate: 18,
      allowsGrossPrice: true,
    });
  });

  it('keeps the rate on reverse charge but refuses a with-VAT price', () => {
    const resolved = resolveIndicator(set, 'DDV-11-A');
    expect(resolved?.vatRate).toBe(18);
    expect(resolved?.allowsGrossPrice).toBeFalse();
  });

  it('drops exempt supplies to 0%', () => {
    const resolved = resolveIndicator(set, 'DDV-10-13');
    expect(resolved?.vatRate).toBe(0);
    expect(resolved?.allowsGrossPrice).toBeFalse();
  });

  it('returns nothing for an unknown code', () => {
    expect(resolveIndicator(set, 'NOPE')).toBeNull();
  });
});
