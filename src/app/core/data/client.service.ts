import { Injectable, inject } from '@angular/core';
import {
  Firestore,
  collection,
  collectionData,
  deleteDoc,
  doc,
  increment,
  orderBy,
  query,
  setDoc,
  updateDoc,
} from '@angular/fire/firestore';
import { Observable, of } from 'rxjs';
import { AuthService } from '../auth/auth.service';
import type { Client } from '../models/client.model';
import { emptyAddress } from '../models/common.model';
import { newId } from '../util/id';
import { injectFirebaseContext } from '../firebase/injection';

/** Clients are per company, in `companies/{companyId}/clients`. */
@Injectable({ providedIn: 'root' })
export class ClientService {
  private readonly firestore = inject(Firestore);
  private readonly auth = inject(AuthService);
  private readonly inContext = injectFirebaseContext();

  private path(companyId: string): string {
    return `companies/${companyId}/clients`;
  }

  list(companyId: string | null): Observable<Client[]> {
    if (!companyId) return of([]);
    return this.inContext(() => {
      const q = query(collection(this.firestore, this.path(companyId)), orderBy('name'));
      return collectionData(q, { idField: 'id' }) as Observable<Client[]>;
    });
  }

  blank(companyId: string): Client {
    const uid = this.auth.user()?.uid ?? '';
    const now = Date.now();
    return {
      id: newId(),
      companyId,
      name: '',
      taxNumber: '',
      vatNumber: '',
      foreignTaxNumber: '',
      registrationNumber: '',
      address: emptyAddress(),
      email: '',
      phone: '',
      contactPerson: '',
      notes: '',
      defaultDueDays: null,
      defaultPaymentTypeCode: null,
      defaultCurrency: null,
      isActive: true,
      invoiceCount: 0,
      lastInvoiceAt: null,
      totalBilled: 0,
      createdAt: now,
      updatedAt: now,
      createdByUid: uid,
      updatedByUid: uid,
    };
  }

  async save(client: Client): Promise<Client> {
    const uid = this.auth.user()?.uid ?? '';
    const record: Client = {
      ...client,
      name: client.name.trim(),
      taxNumber: client.taxNumber.trim(),
      updatedAt: Date.now(),
      updatedByUid: uid,
    };
    const { id, ...data } = record;
    await this.inContext(() =>
      setDoc(doc(this.firestore, this.path(client.companyId), id), data, { merge: true }),
    );
    return record;
  }

  async remove(companyId: string, clientId: string): Promise<void> {
    await this.inContext(() =>
      deleteDoc(doc(this.firestore, this.path(companyId), clientId)),
    );
  }

  /**
   * Bumps the activity counters after an invoice is issued, so the client list
   * can be sorted by "most recently billed" without scanning invoices.
   */
  async recordInvoice(companyId: string, clientId: string, amount: number): Promise<void> {
    await this.inContext(() =>
      updateDoc(doc(this.firestore, this.path(companyId), clientId), {
        invoiceCount: increment(1),
        totalBilled: increment(amount),
        lastInvoiceAt: Date.now(),
      }),
    );
  }
}
