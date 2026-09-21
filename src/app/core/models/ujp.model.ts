/**
 * Wire format for the УЈП е-Фактура API.
 *
 * Field names mirror the official codebook at
 * https://efakturawiki.ujp.gov.mk/шифрарници/шифрарник and the request examples
 * in the API specification page — they are deliberately *not* renamed to
 * app-style camelCase concepts, because any drift makes the payload fail
 * server-side validation with an opaque error code.
 *
 * The document is serialised, signed as a JWS with a qualified certificate, and
 * POSTed to `/JSONReceiver/api/v1/sales-invoices/send` wrapped in
 * `{ requestTimestamp, jws }`.
 */

export interface UjpAddress {
  streetAddress: string;
  streetNumber: string;
  postalCode: string;
  city: string;
}

/** `0` normal document, `1` storno (cancellation), `2` correction. */
export type UjpDocStorno = 0 | 1 | 2;

export interface UjpHeader {
  docStorno: UjpDocStorno;
  /** Document type code — `100` is Фактура. */
  docType: string;
  docTypeName: string;
  docDate: string;
  /** Date the supply actually took place; drives the VAT period. */
  docTurnoverDate: string;
  docNumber: string;
  /** Issuer's own unique id for the document (we use the Firestore id). */
  docId: string;
  docNotes: string | null;
  docHeader: string | null;
  docFooter: string | null;
  /** Present in the official storno example; null on a plain invoice. */
  docDeliveryDate?: string | null;
  docDelivery?: string | null;
  /** Billing period, for recurring/period invoices. */
  docPeriodStartDate?: string | null;
  docPeriodEndDate?: string | null;
  /** Reference document type code, e.g. `NAR_DOC`, `DOG`, `PRO_FAK`. */
  docTypeRef?: string | null;
  docNameRef?: string | null;
  docNumberRef?: string | null;
  docDateRef?: string | null;
  /** Populated on storno (`S-*`) and correction (`C*`) documents. */
  voidReasonCode?: string | null;
  correctionReasonCode?: string | null;
}

export interface UjpParty {
  cCode: string;
  cName: string;
  tin: string;
  foreignTin: string | null;
  vatNumber: string;
  name: string;
  address: UjpAddress;
  contact: string | null;
  email: string | null;
}

/** Seller block — the API uses a `seller`-prefixed flat naming. */
export interface UjpSeller {
  sellerCCode: string;
  sellerCName: string;
  sellerTin: string;
  sellerForeignTin: string | null;
  sellerVatNumber: string;
  sellerName: string;
  sellerAddress: UjpAddress;
  sellerContact: string | null;
  sellerEmail: string | null;
}

export interface UjpBuyer {
  buyerCCode: string;
  buyerCName: string;
  buyerTin: string;
  buyerForeignTin: string | null;
  buyerVatNumber: string;
  buyerName: string;
  buyerAddress: UjpAddress;
  buyerContact: string | null;
  buyerEmail: string | null;
}

export interface UjpPayment {
  docPaymentTypeCode: string;
  docPaymentTypeDesc: string;
  docPaymentTypeDueDays: number | null;
  docPaymentTypeDueDate: string | null;
  docPaymentTerms: string | null;
  docPaymentNote: string | null;
  docPaymentInterest: string | null;
  docPaymentDiscount: string | null;
  docCurrency: string;
  docCurrencyCode: string;
  docCurrencyDate: string;
  docCurrencyExchRate: number;
}

export interface UjpItem {
  docItemLineNo: number;
  docItemSku: string | null;
  docItemSenderCode: string | null;
  docItemReceiverCode: string | null;
  docItemDesc: string;
  docItemMUnit: string;
  docItemQty: number;
  docItemUnitOriginalPriceWoVat: number;
  docItemUnitDiscountAmount: number;
  docItemUnitPriceWoVat: number;
  docItemUnitVat: number;
  /** The applied VAT *rate* as a number, e.g. 18. */
  docItemVat: number;
  /** Tax group code from the `tax-groups` codebook, e.g. `DDV-A`. */
  docItemVatGroup: string;
  docItemTotalOriginalPriceWoVat: number;
  docItemTotalPriceWoVat: number;
  docItemTotalVat: number;
  docItemTotalPriceWVat: number;
  /** Tax indicator code from the `tax-indicators` codebook. */
  docItemTaxIndicator: string;
  docItemDomesticProduct: string | null;
}

export interface UjpTotals {
  docNetAmount: number;
  docDiscountAmount: number;
  docNetAmountDisc: number;
  docVatAmount: number;
  docGrossAmount: number;
  /** Gross rounded to whole currency units — what the buyer actually pays. */
  docGrossAmountR: number;
  docAvansDate: string | null;
  docAvansDesc: string | null;
  docAvansAmount: number;
  docFinalAmount: number;
}

export interface UjpVatTotal {
  vatTaxIndicator: string;
  vatTaxIndicatorNote: string;
  vatCode: string;
  vatPercent: number;
  vatTaxableAmount: number;
  vatAmount: number;
  vatTotalAmount: number;
}

export interface UjpDocument {
  header: UjpHeader;
  seller: UjpSeller;
  buyer: UjpBuyer;
  docPayment: UjpPayment;
  docItems: UjpItem[];
  docTotals: UjpTotals;
  vatTotals: UjpVatTotal[];
}

export interface UjpPayload {
  /** `YYYY-MM-DDTHH:mm:ss` in Europe/Skopje. Replay window is ±5 minutes. */
  requestTimestamp: string;
  document: UjpDocument;
}

/** Envelope actually POSTed once the payload has been signed. */
export interface UjpSendRequest {
  requestTimestamp: string;
  jws: string;
}

export interface UjpSendResponse {
  euid: string;
  message: string;
  qr_link: string;
  status: number;
  e_invoice_user?: boolean;
  timestamp: string;
}

export interface UjpErrorStatus {
  errorCode: string;
  errorMessage: string;
  errorPropertyMap: Record<string, string> | null;
}
