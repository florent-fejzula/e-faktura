import type { ClientSnapshot } from '../models/client.model';
import type { CompanySnapshot } from '../models/company.model';
import type { Address } from '../models/common.model';
import type { ComputedLine, Invoice, VatTotalLine } from '../models/invoice.model';
import type {
  UjpAddress,
  UjpBuyer,
  UjpDocument,
  UjpItem,
  UjpPayload,
  UjpSeller,
  UjpTotals,
  UjpVatTotal,
} from '../models/ujp.model';
import { skopjeTimestamp } from '../util/dates';
import type { CodebookSet } from './codebooks';
import { computeInvoice } from './totals';

/**
 * Maps an `Invoice` onto the УЈП wire format.
 *
 * Anything the document contains is derived here from the invoice plus the
 * codebooks — the builder never reads component state, so the exact payload
 * that gets signed can be produced in a test, in a preview dialog, and at
 * submission time and be byte-identical every time.
 */

/**
 * Maximum lengths from the field codebook (`docs/ujp/sifrarnici-field-codebook.txt`).
 *
 * Values are truncated rather than rejected: a name one character over the
 * limit should not block an invoice, and UJP would silently reject the whole
 * document. `UjpValidator` warns about anything truncated so the user can fix
 * it properly.
 */
export const FIELD_LIMITS = {
  docTypeName: 30,
  docNumber: 40,
  countryName: 50,
  tin: 30,
  vatNumber: 30,
  partyName: 80,
  streetAddress: 60,
  streetNumber: 10,
  postalCode: 5,
  city: 60,
  paymentTypeDesc: 30,
  vatTaxIndicatorNote: 200,
  itemDescription: 200,
  unit: 20,
} as const;

/** Trims and hard-limits a string; empty input becomes an empty string. */
export function clamp(value: string | null | undefined, max: number): string {
  if (!value) return '';
  const trimmed = value.trim();
  return trimmed.length <= max ? trimmed : trimmed.slice(0, max);
}

/** Same as `clamp`, but an empty result becomes `null` as UJP expects. */
function clampOrNull(value: string | null | undefined, max: number): string | null {
  const result = clamp(value, max);
  return result === '' ? null : result;
}

/**
 * Formats the ДДВ number.
 *
 * The official examples write it with a **Cyrillic** `МК` prefix
 * (`"МК4030995135699"`) while the country code field alongside it is the
 * **Latin** `"MK"`. That inconsistency is theirs, and getting it wrong is an
 * easy way to fail the registry cross-check, so it is encoded explicitly here.
 */
const CYRILLIC_MK = 'МК';

export function formatVatNumber(
  taxNumber: string,
  vatNumber: string,
  isVatRegistered: boolean,
): string {
  const explicit = (vatNumber ?? '').trim();
  if (explicit) return clamp(explicit, FIELD_LIMITS.vatNumber);
  if (!isVatRegistered) return '';
  const tin = (taxNumber ?? '').trim();
  return tin ? clamp(CYRILLIC_MK + tin, FIELD_LIMITS.vatNumber) : '';
}

function toUjpAddress(address: Address): UjpAddress {
  return {
    streetAddress: clamp(address.streetAddress, FIELD_LIMITS.streetAddress),
    streetNumber: clamp(address.streetNumber, FIELD_LIMITS.streetNumber),
    postalCode: clamp(address.postalCode, FIELD_LIMITS.postalCode),
    city: clamp(address.city, FIELD_LIMITS.city),
  };
}

export function buildSeller(seller: CompanySnapshot): UjpSeller {
  return {
    sellerCCode: clamp(seller.address.countryCode || 'MK', 3),
    sellerCName: clamp(seller.address.countryName || 'Северна Македонија', FIELD_LIMITS.countryName),
    sellerTin: clamp(seller.taxNumber, FIELD_LIMITS.tin),
    sellerForeignTin: null,
    sellerVatNumber: formatVatNumber(seller.taxNumber, seller.vatNumber, seller.isVatRegistered),
    sellerName: clamp(seller.name, FIELD_LIMITS.partyName),
    sellerAddress: toUjpAddress(seller.address),
    sellerContact: clampOrNull(seller.phone, 50),
    sellerEmail: clampOrNull(seller.email, 100),
  };
}

export function buildBuyer(client: ClientSnapshot): UjpBuyer {
  const isForeign = (client.address.countryCode || 'MK') !== 'MK';
  return {
    buyerCCode: clamp(client.address.countryCode || 'MK', 3),
    buyerCName: clamp(client.address.countryName || 'Северна Македонија', FIELD_LIMITS.countryName),
    buyerTin: clamp(client.taxNumber, FIELD_LIMITS.tin),
    buyerForeignTin: isForeign ? clampOrNull(client.foreignTaxNumber, FIELD_LIMITS.tin) : null,
    // A foreign buyer has no Macedonian ДДВ number to derive.
    buyerVatNumber: formatVatNumber(client.taxNumber, client.vatNumber, !isForeign),
    buyerName: clamp(client.name, FIELD_LIMITS.partyName),
    buyerAddress: toUjpAddress(client.address),
    buyerContact: clampOrNull(client.phone || client.contactPerson, 50),
    buyerEmail: clampOrNull(client.email, 100),
  };
}

/** `MP` is the flag the official examples use for a Macedonian product. */
const DOMESTIC_PRODUCT_CODE = 'MP';

export function buildItem(line: ComputedLine): UjpItem {
  const { item } = line;
  return {
    docItemLineNo: line.lineNo,
    docItemSku: clampOrNull(item.sku, 50),
    docItemSenderCode: clampOrNull(item.sku, 50),
    docItemReceiverCode: null,
    docItemDesc: clamp(item.description, FIELD_LIMITS.itemDescription),
    docItemMUnit: clamp(item.unit, FIELD_LIMITS.unit),
    docItemQty: item.qty,
    docItemUnitOriginalPriceWoVat: line.unitOriginalPriceWoVat,
    docItemUnitDiscountAmount: line.unitDiscountAmount,
    docItemUnitPriceWoVat: line.unitPriceWoVat,
    docItemUnitVat: line.unitVat,
    // The rate stays on the line even for reverse charge, where no VAT is
    // actually charged — see the чл. 32 example in docs/ujp/json-examples.pdf.
    docItemVat: line.vatImpact === 'OSLOBODEN' || line.vatImpact === 'NULA' ? 0 : item.vatRate,
    docItemVatGroup: item.vatGroup,
    docItemTotalOriginalPriceWoVat: line.totalOriginalPriceWoVat,
    docItemTotalPriceWoVat: line.totalPriceWoVat,
    docItemTotalVat: line.totalVat,
    docItemTotalPriceWVat: line.totalPriceWVat,
    docItemTaxIndicator: item.taxIndicator,
    docItemDomesticProduct: item.isDomesticProduct ? DOMESTIC_PRODUCT_CODE : null,
  };
}

function buildVatTotal(row: VatTotalLine): UjpVatTotal {
  return {
    vatTaxIndicator: row.taxIndicator,
    vatTaxIndicatorNote: clamp(row.taxIndicatorNote, FIELD_LIMITS.vatTaxIndicatorNote),
    vatCode: row.vatCode,
    vatPercent: row.vatPercent,
    vatTaxableAmount: row.taxableAmount,
    vatAmount: row.vatAmount,
    vatTotalAmount: row.totalAmount,
  };
}

function buildTotals(invoice: Invoice, totals: Invoice['totals']): UjpTotals {
  return {
    docNetAmount: totals.netAmount,
    docDiscountAmount: totals.discountAmount,
    docNetAmountDisc: totals.netAmountDisc,
    docVatAmount: totals.vatAmount,
    docGrossAmount: totals.grossAmount,
    docGrossAmountR: totals.grossAmountRounded,
    docAvansDate: invoice.advanceAmount > 0 ? invoice.advanceDate : null,
    docAvansDesc:
      invoice.advanceAmount > 0 ? clampOrNull(invoice.advanceDescription, 200) : null,
    docAvansAmount: totals.advanceAmount,
    docFinalAmount: totals.finalAmount,
  };
}

export interface BuildOptions {
  /**
   * Timestamp to stamp on the request. Defaults to now in Europe/Skopje.
   * Pass an explicit value to make a payload reproducible in a test.
   */
  requestTimestamp?: string;
  /**
   * Append a `Z` suffix to `requestTimestamp`.
   *
   * The API specification page states the format as `2026-01-05T12:00:00`
   * "во временска зона со Скопје" (no suffix), while every worked example in
   * the JSON examples PDF writes `2026-04-27T11:24:10Z`. The spec wins by
   * default; flip this during pilot testing if UJP rejects the timestamp.
   */
  zSuffix?: boolean;
}

/**
 * Builds the complete signable payload for an invoice.
 *
 * Amounts are recomputed from the line items rather than read off the stored
 * totals, so a document can never be submitted with totals that drifted from
 * its own lines.
 */
export function buildUjpPayload(
  invoice: Invoice,
  codebooks: CodebookSet,
  options: BuildOptions = {},
): UjpPayload {
  const { lines, totals, vatTotals } = computeInvoice(invoice.items, codebooks, {
    advanceAmount: invoice.advanceAmount,
  });

  const reference = invoice.references[0] ?? null;

  const document: UjpDocument = {
    header: {
      docStorno: invoice.docStorno,
      docType: invoice.docType,
      docTypeName: clamp(invoice.docTypeName, FIELD_LIMITS.docTypeName),
      docDate: invoice.issueDate,
      docTurnoverDate: invoice.turnoverDate,
      docNumber: clamp(invoice.number, FIELD_LIMITS.docNumber),
      docId: invoice.id,
      docNotes: clampOrNull(invoice.notes, 500),
      docHeader: clampOrNull(invoice.headerText, 500),
      docFooter: clampOrNull(invoice.footerText, 500),
      docTypeRef: reference ? reference.typeCode : null,
      docNameRef: reference ? clamp(reference.typeName, 30) : null,
      docNumberRef: reference ? clamp(reference.number, 50) : null,
      docDateRef: reference ? reference.date : null,
    },
    seller: buildSeller(invoice.seller),
    buyer: buildBuyer(invoice.client),
    docPayment: {
      docPaymentTypeCode: invoice.paymentTypeCode,
      docPaymentTypeDesc: clamp(invoice.paymentTypeDesc, FIELD_LIMITS.paymentTypeDesc),
      docPaymentTypeDueDays: null,
      docPaymentTypeDueDate: invoice.dueDate || null,
      docPaymentTerms: clampOrNull(invoice.paymentTerms, 200),
      docPaymentNote: clampOrNull(invoice.paymentNote, 200),
      docPaymentInterest: null,
      docPaymentDiscount: null,
      docCurrency: invoice.currency,
      docCurrencyCode: invoice.currency,
      docCurrencyDate: invoice.exchangeRateDate || invoice.issueDate,
      docCurrencyExchRate: invoice.exchangeRate || 1,
    },
    docItems: lines.map(buildItem),
    docTotals: buildTotals(invoice, totals),
    vatTotals: vatTotals.map(buildVatTotal),
  };

  const stamp = options.requestTimestamp ?? skopjeTimestamp();

  return {
    requestTimestamp: options.zSuffix ? `${stamp}Z` : stamp,
    document,
  };
}

/**
 * Canonical JSON for signing.
 *
 * `JSON.stringify` on the payload object is stable because every field is
 * written in a fixed order by the builder above — but going through this
 * helper documents the intent and gives one place to change if UJP ever
 * specifies a canonicalisation (JCS) requirement.
 */
export function serializePayload(payload: UjpPayload): string {
  return JSON.stringify(payload);
}
