import { Injectable, inject } from '@angular/core';
import {
  Firestore,
  collection,
  collectionData,
  deleteDoc,
  doc,
  orderBy,
  query,
  setDoc,
} from '@angular/fire/firestore';
import { Observable, of } from 'rxjs';
import { AuthService } from '../auth/auth.service';
import { injectFirebaseContext } from '../firebase/injection';
import type { CatalogItem } from '../models/catalog.model';
import type { Company } from '../models/company.model';
import { newId } from '../util/id';
import { createItem } from './invoice.service';

/**
 * The Ценовник module's price list, in `companies/{companyId}/catalog`.
 *
 * Writes succeed only while the module is switched on for the company — the
 * security rules check it — so callers should already be gated on
 * `CompanyService.hasModule('catalog')`.
 */
@Injectable({ providedIn: 'root' })
export class CatalogService {
  private readonly firestore = inject(Firestore);
  private readonly auth = inject(AuthService);
  private readonly inContext = injectFirebaseContext();

  private path(companyId: string): string {
    return `companies/${companyId}/catalog`;
  }

  list(companyId: string | null): Observable<CatalogItem[]> {
    if (!companyId) return of([]);
    return this.inContext(() => {
      const q = query(collection(this.firestore, this.path(companyId)), orderBy('name'));
      return collectionData(q, { idField: 'id' }) as Observable<CatalogItem[]>;
    });
  }

  /** A new entry with the company's usual unit and tax treatment. */
  blank(company: Company): CatalogItem {
    const line = createItem(company);
    const uid = this.auth.user()?.uid ?? '';
    const now = Date.now();
    return {
      id: newId(),
      companyId: company.id,
      name: '',
      sku: '',
      unit: line.unit,
      priceMode: line.priceMode,
      unitPrice: 0,
      taxIndicator: line.taxIndicator,
      vatGroup: line.vatGroup,
      vatRate: line.vatRate,
      createdAt: now,
      updatedAt: now,
      createdByUid: uid,
      updatedByUid: uid,
    };
  }

  async save(entry: CatalogItem): Promise<CatalogItem> {
    const record: CatalogItem = {
      ...entry,
      name: entry.name.trim(),
      sku: entry.sku.trim(),
      unit: entry.unit.trim(),
      updatedAt: Date.now(),
      updatedByUid: this.auth.user()?.uid ?? '',
    };
    const { id, ...data } = record;
    await this.inContext(() =>
      setDoc(doc(this.firestore, this.path(entry.companyId), id), data, { merge: true }),
    );
    return record;
  }

  async remove(companyId: string, id: string): Promise<void> {
    await this.inContext(() => deleteDoc(doc(this.firestore, this.path(companyId), id)));
  }
}
