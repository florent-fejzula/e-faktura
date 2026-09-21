import type { Address, AuditFields } from './common.model';

export interface Client extends AuditFields {
  id: string;
  companyId: string;

  /** UJP `buyerName`, max 80 chars. */
  name: string;
  /** ЕДБ — UJP `buyerTin`. */
  taxNumber: string;
  /** ДДВ број — UJP `buyerVatNumber`. */
  vatNumber: string;
  /** Set for non-МК buyers; maps to `buyerForeignTin`. */
  foreignTaxNumber: string;
  registrationNumber: string;

  address: Address;
  email: string;
  phone: string;
  contactPerson: string;
  notes: string;

  /** Overrides the company default when creating an invoice for this client. */
  defaultDueDays: number | null;
  defaultPaymentTypeCode: string | null;
  defaultCurrency: string | null;

  isActive: boolean;

  /** Maintained on issue so the list can sort by activity without a join. */
  invoiceCount: number;
  lastInvoiceAt: number | null;
  totalBilled: number;
}

/** Snapshot embedded in an invoice — editing a client never rewrites history. */
export interface ClientSnapshot {
  id: string | null;
  name: string;
  taxNumber: string;
  vatNumber: string;
  foreignTaxNumber: string;
  address: Address;
  email: string;
  phone: string;
  contactPerson: string;
}

export function snapshotClient(c: Client): ClientSnapshot {
  return {
    id: c.id,
    name: c.name,
    taxNumber: c.taxNumber,
    vatNumber: c.vatNumber,
    foreignTaxNumber: c.foreignTaxNumber,
    address: c.address,
    email: c.email,
    phone: c.phone,
    contactPerson: c.contactPerson,
  };
}
