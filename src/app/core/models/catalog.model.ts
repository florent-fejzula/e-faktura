import type { AuditFields } from './common.model';
import type { InvoiceItem, PriceMode } from './invoice.model';
import { normalizeForSearch } from '../util/id';

/**
 * One entry in a company's price list (the Ценовник module): something it
 * sells, with the price and tax treatment it usually sells it at.
 *
 * Stored in `companies/{companyId}/catalog`. Picking an entry on an invoice
 * line copies these fields onto the line — the line keeps its own copy, so
 * changing a price later never rewrites an invoice already issued.
 */
export interface CatalogItem extends AuditFields {
  id: string;
  companyId: string;

  /** Becomes the line description. UJP allows 200 characters. */
  name: string;
  /** Optional own code, printed under the description. */
  sku: string;
  unit: string;

  /** As entered — the price list keeps "with VAT" prices the way they are quoted. */
  priceMode: PriceMode;
  unitPrice: number;

  taxIndicator: string;
  vatGroup: string;
  vatRate: number;
}

/** UJP limits that also bound the price list, since entries become lines. */
export const CATALOG_LIMITS = { name: 200, sku: 50, unit: 20 } as const;

/**
 * Fills an invoice line from a price-list entry.
 *
 * Quantity and discount are the line's own — they differ per sale — and so is
 * the id, which the editor tracks rows by. Everything describing *what* is
 * sold and at what price comes from the entry.
 */
export function applyCatalogItem(line: InvoiceItem, entry: CatalogItem): InvoiceItem {
  return {
    ...line,
    description: entry.name,
    sku: entry.sku,
    unit: entry.unit,
    priceMode: entry.priceMode,
    unitPrice: entry.unitPrice,
    taxIndicator: entry.taxIndicator,
    vatGroup: entry.vatGroup,
    vatRate: entry.vatRate,
  };
}

/** The fields a price-list entry takes from an invoice line ("save to price list"). */
export function catalogFieldsFromLine(
  line: InvoiceItem,
): Pick<
  CatalogItem,
  'name' | 'sku' | 'unit' | 'priceMode' | 'unitPrice' | 'taxIndicator' | 'vatGroup' | 'vatRate'
> {
  return {
    name: line.description.trim().slice(0, CATALOG_LIMITS.name),
    sku: line.sku.trim().slice(0, CATALOG_LIMITS.sku),
    unit: line.unit.trim().slice(0, CATALOG_LIMITS.unit),
    priceMode: line.priceMode,
    unitPrice: line.unitPrice,
    taxIndicator: line.taxIndicator,
    vatGroup: line.vatGroup,
    vatRate: line.vatRate,
  };
}

/**
 * The entry with this name, compared the way search compares — case, accents
 * and Latin/Cyrillic spelling ignored — so "Печатење А4" and "pecatenje a4"
 * are one entry, not two.
 */
export function findByName(entries: readonly CatalogItem[], name: string): CatalogItem | null {
  const key = normalizeForSearch(name);
  if (!key) return null;
  return entries.find((entry) => normalizeForSearch(entry.name) === key) ?? null;
}
