import { Injectable, inject } from '@angular/core';
import {
  Firestore,
  collection,
  collectionData,
  doc,
  docData,
  orderBy,
  query,
  runTransaction,
  setDoc,
  updateDoc,
  where,
} from '@angular/fire/firestore';
import { Observable, map, of } from 'rxjs';
import { AuthService } from '../auth/auth.service';
import type { Client, ClientSnapshot } from '../models/client.model';
import type { Company } from '../models/company.model';
import { snapshotClient } from '../models/client.model';
import { snapshotCompany } from '../models/company.model';
import { emptyAddress } from '../models/common.model';
import type { Invoice, InvoiceItem, PaymentStatus } from '../models/invoice.model';
import type { CodebookSet } from '../ujp/codebooks';
import { computeInvoice } from '../ujp/totals';
import { amountInWordsMk } from '../util/amount-in-words';
import { addDays, monthOf, skopjeToday, todayIso, yearOf, type IsoDate } from '../util/dates';
import { newId, normalizeForSearch } from '../util/id';
import { round2 } from '../util/money';
import { nextInvoiceNumber } from './numbering';
import { injectFirebaseContext } from '../firebase/injection';

/**
 * Invoices live in a subcollection of their company
 * (`companies/{companyId}/invoices/{id}`).
 *
 * That keeps the security rule to a single membership check and makes every
 * query naturally scoped — there is no way to accidentally read another
 * company's documents, which matters a great deal for tax records.
 */
@Injectable({ providedIn: 'root' })
export class InvoiceService {
  private readonly firestore = inject(Firestore);
  private readonly auth = inject(AuthService);
  private readonly inContext = injectFirebaseContext();

  private path(companyId: string): string {
    return `companies/${companyId}/invoices`;
  }

  /**
   * Live list for one company, bounded by issue date.
   *
   * The window is deliberately server-side and everything else (status, client,
   * amount, text search) is filtered in memory: a year of invoices is a small
   * set, and filtering locally makes the list respond instantly to every
   * keystroke instead of round-tripping.
   */
  list(companyId: string | null, from: IsoDate, to: IsoDate): Observable<Invoice[]> {
    if (!companyId) return of([]);
    return this.inContext(() => {
      const q = query(
        collection(this.firestore, this.path(companyId)),
        where('issueDate', '>=', from),
        where('issueDate', '<=', to),
        orderBy('issueDate', 'desc'),
      );
      return collectionData(q, { idField: 'id' }) as Observable<Invoice[]>;
    });
  }

  watch(companyId: string, invoiceId: string): Observable<Invoice | null> {
    return this.inContext(
      () =>
        docData(doc(this.firestore, this.path(companyId), invoiceId), {
          idField: 'id',
        }) as Observable<Invoice | undefined>,
    ).pipe(map((invoice) => invoice ?? null));
  }

  /**
   * A new, unsaved draft carrying the company's defaults.
   *
   * The id is generated up front so the document can be referenced (and its
   * `docId` sent to UJP) before it has ever been written.
   */
  createDraft(company: Company, client?: Client | null): Invoice {
    const issueDate = skopjeToday();
    const dueDays = client?.defaultDueDays ?? company.defaults.dueDays;
    const currency = client?.defaultCurrency ?? company.defaults.currency;
    const paymentTypeCode = client?.defaultPaymentTypeCode ?? company.defaults.paymentTypeCode;
    const uid = this.auth.user()?.uid ?? '';
    const now = Date.now();

    return {
      id: newId(),
      companyId: company.id,

      docType: '100',
      docTypeName: 'Фактура',
      docStorno: 0,

      number: '',
      seq: null,
      periodKey: null,
      year: yearOf(issueDate),
      month: monthOf(issueDate),

      status: '00',
      issuedAt: null,
      paymentStatus: 'unpaid',

      issueDate,
      turnoverDate: issueDate,
      dueDate: addDays(issueDate, dueDays),

      seller: snapshotCompany(company),
      client: client ? snapshotClient(client) : emptyClientSnapshot(),

      currency,
      exchangeRate: 1,
      exchangeRateDate: issueDate,

      paymentTypeCode,
      paymentTypeDesc: '',
      paymentTerms: '',
      paymentNote: '',

      items: [createItem(company)],
      totals: {
        netAmount: 0,
        discountAmount: 0,
        netAmountDisc: 0,
        vatAmount: 0,
        grossAmount: 0,
        grossAmountRounded: 0,
        advanceAmount: 0,
        finalAmount: 0,
      },
      vatTotals: [],

      advanceAmount: 0,
      advanceDate: null,
      advanceDescription: '',

      notes: '',
      headerText: '',
      footerText: company.defaults.invoiceFooter,
      amountInWords: '',

      references: [],

      ujp: null,
      ujpErrors: [],
      relatedInvoiceId: null,
      relatedEuid: null,

      paidAmount: 0,
      paidAt: null,

      searchName: '',
      grandTotal: 0,

      createdAt: now,
      updatedAt: now,
      createdByUid: uid,
      updatedByUid: uid,
    };
  }

  /**
   * Copies an existing invoice into a fresh draft — the "зачувај како нова"
   * flow. Everything identifying the original (number, status, UJP receipt) is
   * dropped; the lines, client and terms carry over.
   */
  duplicate(source: Invoice, company: Company): Invoice {
    const draft = this.createDraft(company);
    return {
      ...draft,
      issuedAt: null,
      client: source.client,
      currency: source.currency,
      exchangeRate: source.exchangeRate,
      paymentTypeCode: source.paymentTypeCode,
      paymentTypeDesc: source.paymentTypeDesc,
      paymentTerms: source.paymentTerms,
      paymentNote: source.paymentNote,
      notes: source.notes,
      headerText: source.headerText,
      footerText: source.footerText,
      references: source.references.map((r) => ({ ...r })),
      // Fresh ids so the editor's @for tracking does not confuse the copies.
      items: source.items.map((item) => ({ ...item, id: newId() })),
    };
  }

  /** Recomputes every derived field. Call before any write. */
  finalize(invoice: Invoice, codebooks: CodebookSet): Invoice {
    const { totals, vatTotals } = computeInvoice(invoice.items, codebooks, {
      advanceAmount: invoice.advanceAmount,
    });

    return {
      ...invoice,
      totals,
      vatTotals,
      year: yearOf(invoice.issueDate),
      month: monthOf(invoice.issueDate),
      grandTotal: totals.finalAmount,
      amountInWords: amountInWordsMk(totals.finalAmount, invoice.currency),
      searchName: normalizeForSearch(
        [invoice.number, invoice.client.name, invoice.client.taxNumber, invoice.notes].join(' '),
      ),
      updatedAt: Date.now(),
      updatedByUid: this.auth.user()?.uid ?? invoice.updatedByUid,
    };
  }

  async save(invoice: Invoice, codebooks: CodebookSet): Promise<Invoice> {
    const finalized = this.finalize(invoice, codebooks);
    const { id, ...data } = finalized;
    await this.inContext(() =>
      setDoc(doc(this.firestore, this.path(invoice.companyId), id), data, { merge: true }),
    );
    return finalized;
  }

  /**
   * Assigns the next number and marks the invoice issued.
   *
   * The sequence lives on the company document and is read *and* written
   * inside a transaction, so two users issuing simultaneously get different
   * numbers rather than a duplicate.
   */
  async issue(invoice: Invoice, codebooks: CodebookSet): Promise<Invoice> {
    if (invoice.number) {
      // Already numbered (re-issuing after a failed submission) — keep the
      // number, and make sure it is marked issued.
      return this.save({ ...invoice, issuedAt: invoice.issuedAt ?? Date.now() }, codebooks);
    }

    const companyRef = doc(this.firestore, 'companies', invoice.companyId);
    const invoiceRef = doc(this.firestore, this.path(invoice.companyId), invoice.id);

    const finalized = await this.inContext(() =>
      runTransaction(this.firestore, async (tx) => {
        const companySnap = await tx.get(companyRef);
        if (!companySnap.exists()) throw new Error('Компанијата не постои.');

        const company = companySnap.data() as Company;
        const assigned = nextInvoiceNumber(company.numbering, invoice.issueDate);

        const numbered = this.finalize(
          {
            ...invoice,
            number: assigned.number,
            seq: assigned.seq,
            periodKey: assigned.periodKey,
            issuedAt: Date.now(),
          },
          codebooks,
        );

        const { id, ...data } = numbered;
        const stats = company.stats ?? { issuedCount: 0, lastIssuedAt: null };

        tx.set(invoiceRef, data);
        tx.update(companyRef, {
          numbering: assigned.nextConfig,
          // Same write, so the usage figure cannot drift from the sequence.
          stats: { issuedCount: stats.issuedCount + 1, lastIssuedAt: Date.now() },
        });

        return numbered;
      }),
    );

    return finalized;
  }

  /**
   * Deletes an invoice — permitted only while УЈП has no copy of it, which the
   * security rules enforce independently.
   *
   * Deleting a *numbered* invoice would normally leave a hole in the sequence,
   * and gaps in an invoice book are exactly what a tax inspection asks about.
   * So when the invoice being removed holds the most recently issued number in
   * its period, the company counter is rolled back in the same transaction and
   * the next invoice reuses it. Deleting an older one cannot be repaired that
   * way and does leave a gap — the confirm dialog says so.
   */
  async remove(
    invoice: Pick<Invoice, 'companyId' | 'id' | 'seq' | 'periodKey' | 'issuedAt'>,
  ): Promise<void> {
    const invoiceRef = doc(this.firestore, this.path(invoice.companyId), invoice.id);
    const companyRef = doc(this.firestore, 'companies', invoice.companyId);

    await this.inContext(() =>
      runTransaction(this.firestore, async (tx) => {
        const companySnap = await tx.get(companyRef);
        tx.delete(invoiceRef);

        if (!companySnap.exists()) return;
        const company = companySnap.data() as Company;

        // Deleting an issued invoice takes it back out of the usage figure.
        if (invoice.issuedAt !== null) {
          const stats = company.stats ?? { issuedCount: 0, lastIssuedAt: null };
          tx.update(companyRef, {
            stats: { ...stats, issuedCount: Math.max(0, stats.issuedCount - 1) },
          });
        }

        if (!invoice.seq) return;

        const numbering = company.numbering;
        const wasLastIssued =
          numbering.periodKey === invoice.periodKey && numbering.nextSeq === invoice.seq + 1;

        if (wasLastIssued) {
          tx.update(companyRef, {
            numbering: { ...numbering, nextSeq: invoice.seq },
          });
        }
      }),
    );
  }

  async setPayment(
    invoice: Invoice,
    paidAmount: number,
    paidAt: number | null,
  ): Promise<void> {
    const amount = round2(paidAmount);
    const status: PaymentStatus =
      amount <= 0 ? 'unpaid' : amount + 0.005 >= invoice.totals.finalAmount ? 'paid' : 'partial';

    await this.inContext(() =>
      updateDoc(doc(this.firestore, this.path(invoice.companyId), invoice.id), {
        paidAmount: amount,
        paidAt: status === 'unpaid' ? null : (paidAt ?? Date.now()),
        paymentStatus: status,
        updatedAt: Date.now(),
      }),
    );
  }
}

/** A blank line, pre-filled with the company's default unit and tax treatment. */
export function createItem(company: Company): InvoiceItem {
  return {
    id: newId(),
    description: '',
    sku: '',
    unit: company.defaults.unit,
    qty: 1,
    priceMode: 'net',
    unitPrice: 0,
    discountPercent: 0,
    vatRate: company.isVatRegistered ? 18 : 0,
    taxIndicator: company.isVatRegistered ? company.defaults.taxIndicator : 'DDV-G',
    vatGroup: company.isVatRegistered ? 'DDV-A' : 'DDV-G',
    isDomesticProduct: false,
  };
}

export function emptyClientSnapshot(): ClientSnapshot {
  return {
    id: null,
    name: '',
    taxNumber: '',
    vatNumber: '',
    foreignTaxNumber: '',
    address: emptyAddress(),
    email: '',
    phone: '',
    contactPerson: '',
  };
}

/** Default list window: the current calendar year. */
export function defaultDateWindow(): { from: IsoDate; to: IsoDate } {
  const year = yearOf(todayIso());
  return { from: `${year}-01-01`, to: `${year}-12-31` };
}
