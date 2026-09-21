import type { ClientSnapshot } from './client.model';
import type { CompanySnapshot } from './company.model';
import type { AuditFields } from './common.model';
import type { UjpDocStorno } from './ujp.model';

/**
 * Official UJP document status codes (`GET /api/v1/document-statuses`).
 * `00` is the only one the app owns; every other value is set by UJP.
 */
export type UjpStatusCode = '00' | '01' | '03' | '04' | '05' | '07' | '09' | '10';

export const UJP_STATUS_LABELS: Record<UjpStatusCode, string> = {
  '00': 'Нацрт',
  '01': 'Испратена',
  '03': 'Прифатена',
  '04': 'Автоматски прифатена',
  '05': 'Одбиена',
  '07': 'Сторнирана',
  '09': 'Корегирана',
  '10': 'Евидентирана',
};

/** Payment tracking, which UJP does not model — this is ours alone. */
export type PaymentStatus = 'unpaid' | 'partial' | 'paid';

/**
 * How the user typed the unit price on a line. UJP only ever receives a net
 * (VAT-exclusive) price, so `gross` lines are converted on the way out — but we
 * keep the entry mode so reopening an invoice shows what the user actually
 * typed instead of a back-calculated number with rounding drift.
 */
export type PriceMode = 'net' | 'gross';

export interface InvoiceItem {
  /** Stable id so template `@for` tracking survives reordering. */
  id: string;
  description: string;
  sku: string;
  unit: string;
  qty: number;
  priceMode: PriceMode;
  /** Unit price exactly as entered, net or gross per `priceMode`. */
  unitPrice: number;
  discountPercent: number;
  /** VAT rate as a number: 18, 10, 5 or 0. */
  vatRate: number;
  /** Tax indicator code, e.g. `DDV-A`. Determines how VAT is treated. */
  taxIndicator: string;
  /** Tax group code, e.g. `DDV-A`. */
  vatGroup: string;
  isDomesticProduct: boolean;
}

/** Everything derived from an `InvoiceItem`, computed with the UJP formulas. */
export interface ComputedLine {
  lineNo: number;
  item: InvoiceItem;
  unitOriginalPriceWoVat: number;
  unitDiscountAmount: number;
  unitPriceWoVat: number;
  unitVat: number;
  totalOriginalPriceWoVat: number;
  totalPriceWoVat: number;
  totalVat: number;
  totalPriceWVat: number;
  /** Resolved from the tax indicator; drives whether VAT is charged at all. */
  vatImpact: VatImpact;
}

/**
 * From the API spec: how a tax indicator affects the VAT calculation.
 *  - `STANDARD`  charge VAT at the rate (5 / 10 / 18)
 *  - `NULA`      0% rate, VAT reported as 0
 *  - `OSLOBODEN` exempt supply, VAT not calculated and not shown
 *  - `PRENESEN`  reverse charge (чл. 32), VAT excluded from item and document
 *                totals but reported in `vatTotals` with a note
 */
export type VatImpact = 'STANDARD' | 'NULA' | 'OSLOBODEN' | 'PRENESEN';

export interface InvoiceTotals {
  netAmount: number;
  discountAmount: number;
  netAmountDisc: number;
  vatAmount: number;
  grossAmount: number;
  grossAmountRounded: number;
  advanceAmount: number;
  finalAmount: number;
}

export interface VatTotalLine {
  taxIndicator: string;
  taxIndicatorNote: string;
  vatCode: string;
  vatPercent: number;
  taxableAmount: number;
  vatAmount: number;
  totalAmount: number;
  vatImpact: VatImpact;
}

/** Optional link to an order, contract, proforma, customs decision, etc. */
export interface DocReference {
  typeCode: string;
  typeName: string;
  number: string;
  date: string | null;
}

/** What came back from UJP once the document was accepted. */
export interface UjpSubmission {
  euid: string;
  qrLink: string;
  /** Server-side receipt timestamp, ISO 8601. */
  receivedAt: string;
  statusCode: UjpStatusCode;
  statusName: string;
  lastSyncedAt: number;
  /** Rejection / storno reason as reported by UJP, when applicable. */
  reasonCode: string | null;
  reasonText: string | null;
}

export interface UjpSubmissionError {
  at: number;
  errorCode: string;
  errorMessage: string;
  /** Per-field messages, keyed by the offending JSON path. */
  fields: Record<string, string> | null;
}

export interface Invoice extends AuditFields {
  id: string;
  companyId: string;

  /** Always `100` (Фактура) today; other types are a later phase. */
  docType: string;
  docTypeName: string;
  docStorno: UjpDocStorno;

  /** Rendered number, e.g. `0007/2026`. Assigned when the draft is issued. */
  number: string;
  /** Sequence and period the number was drawn from, for gap detection. */
  seq: number | null;
  periodKey: string | null;
  /** Denormalised for range queries and grouping in the list view. */
  year: number;
  month: number;

  /**
   * The status УЈП knows about. Stays `00` (Нацрт) until the document is
   * actually signed and accepted — claiming `01` before that would be false,
   * since `01` means "потпишана и валидирана, снимена во системот".
   */
  status: UjpStatusCode;

  /**
   * When the invoice was issued locally: a number was allocated and the
   * document was frozen.
   *
   * UJP has no code for this state, but it is a real one — an invoice can be
   * numbered, printed and sent to the buyer before it has ever reached УЈП
   * (and today, before a signing certificate is even wired up). Editability
   * keys off this, not off `status`.
   */
  issuedAt: number | null;

  paymentStatus: PaymentStatus;

  /** ISO `YYYY-MM-DD`. Dates are stored as plain dates, never timestamps —
   *  an invoice issued on the 1st must not drift across a timezone boundary. */
  issueDate: string;
  turnoverDate: string;
  dueDate: string;

  seller: CompanySnapshot;
  client: ClientSnapshot;

  currency: string;
  exchangeRate: number;
  exchangeRateDate: string;

  paymentTypeCode: string;
  paymentTypeDesc: string;
  paymentTerms: string;
  paymentNote: string;

  items: InvoiceItem[];
  totals: InvoiceTotals;
  vatTotals: VatTotalLine[];

  advanceAmount: number;
  advanceDate: string | null;
  advanceDescription: string;

  notes: string;
  headerText: string;
  footerText: string;
  amountInWords: string;

  references: DocReference[];

  ujp: UjpSubmission | null;
  ujpErrors: UjpSubmissionError[];

  /** Set when this document storno's or corrects another one. */
  relatedInvoiceId: string | null;
  relatedEuid: string | null;

  paidAmount: number;
  paidAt: number | null;

  /** Denormalised so the list can sort/filter without reading every line. */
  searchName: string;
  grandTotal: number;
}

/** A document is editable only while it is still an unissued draft. */
export function isEditable(invoice: Pick<Invoice, 'status' | 'issuedAt'>): boolean {
  return invoice.status === '00' && invoice.issuedAt === null;
}

/** True once УЈП holds a copy. */
export function isSubmitted(invoice: Pick<Invoice, 'status'>): boolean {
  return invoice.status !== '00';
}

/** Numbered and frozen locally, but not yet sent to УЈП. */
export function isIssuedLocally(invoice: Pick<Invoice, 'status' | 'issuedAt'>): boolean {
  return invoice.status === '00' && invoice.issuedAt !== null;
}

/**
 * Deletable while УЈП has no copy — a draft, or an invoice numbered locally but
 * never submitted. Once `status` moves off "00" the document exists in the tax
 * authority's records and the lawful correction is a storno, not an erasure.
 *
 * Deleting a numbered invoice leaves a hole in the sequence unless it was the
 * most recent one, which `InvoiceService.remove` handles by rolling the
 * counter back.
 */
export function isDeletable(invoice: Pick<Invoice, 'status'>): boolean {
  return invoice.status === '00';
}
