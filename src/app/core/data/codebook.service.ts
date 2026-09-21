import { Injectable, computed, inject, signal } from '@angular/core';
import { Firestore, doc, docData, setDoc } from '@angular/fire/firestore';
import { toSignal } from '@angular/core/rxjs-interop';
import { toObservable } from '@angular/core/rxjs-interop';
import { Observable, of, switchMap } from 'rxjs';
import type { CodebookSet, TaxIndicator } from '../ujp/codebooks';
import { seedCodebooks } from '../ujp/codebooks';
import { UjpTransport, UjpUnavailableError } from '../ujp/ujp-signer';
import { CompanyService } from './company.service';
import { injectFirebaseContext } from '../firebase/injection';

/**
 * Serves the УЈП code lists to the rest of the app.
 *
 * The lists are per company because they are fetched with that company's
 * credentials, and they are cached in Firestore
 * (`companies/{id}/settings/codebooks`) rather than re-fetched per session —
 * UJP rate-limits to one request per second per user, and the lists change
 * a few times a year at most.
 *
 * Until a company has e-УЈП access the seeded lists are used, so nothing in
 * the app has to special-case "not registered yet".
 */
@Injectable({ providedIn: 'root' })
export class CodebookService {
  private readonly firestore = inject(Firestore);
  private readonly companies = inject(CompanyService);
  private readonly transport = inject(UjpTransport);
  private readonly inContext = injectFirebaseContext();

  private readonly seeds = seedCodebooks();

  private readonly cached = toSignal(
    toObservable(this.companies.activeCompanyId).pipe(
      switchMap((companyId) => {
        if (!companyId) return of(null);
        return this.inContext(
          () =>
            docData(
              doc(this.firestore, `companies/${companyId}/settings/codebooks`),
            ) as Observable<Partial<CodebookSet> | undefined>,
        );
      }),
    ),
    { initialValue: undefined },
  );

  /** Synced lists where available, seeded ones everywhere else. */
  readonly codebooks = computed<CodebookSet>(() => {
    const synced = this.cached();
    if (!synced) return this.seeds;
    return {
      ...this.seeds,
      ...Object.fromEntries(
        Object.entries(synced).filter(([, value]) => Array.isArray(value) && value.length),
      ),
      syncedAt: synced.syncedAt ?? null,
    } as CodebookSet;
  });

  readonly isSeeded = computed(() => this.codebooks().syncedAt === null);

  /** Tax indicators a seller usually needs, for the compact picker. */
  readonly commonIndicators = computed<TaxIndicator[]>(() =>
    this.codebooks().taxIndicators.filter((i) => i.common !== false && i.common !== undefined),
  );

  readonly allIndicators = computed<TaxIndicator[]>(() => [
    ...this.codebooks().taxIndicators,
  ]);

  readonly syncing = signal(false);
  readonly syncError = signal<string | null>(null);

  /**
   * Pulls the live code lists and caches them.
   *
   * Every endpoint here needs `X-EDB` and `X-EUJP-ID`, so this only does
   * anything once the company has completed e-УЈП registration. Calls are
   * issued one at a time to respect the documented 1 request/second limit.
   */
  async sync(): Promise<boolean> {
    const company = this.companies.activeCompany();
    if (!company) return false;

    if (!company.ujp.eujpId || !company.taxNumber) {
      this.syncError.set(
        'Внесете EUJP-ID и даночен број во Поставки → УЈП пред да ги повлечете шифрарниците.',
      );
      return false;
    }

    this.syncing.set(true);
    this.syncError.set(null);

    const headers = {
      'X-EDB': company.taxNumber,
      'X-EUJP-ID': company.ujp.eujpId,
      'X-SERIAL-NUMBER': company.ujp.certificateSerialNumber,
    };

    try {
      const next: Partial<CodebookSet> = { syncedAt: Date.now() };

      // Each entry maps an endpoint to the response property it returns and
      // the field it populates in our set.
      const endpoints = [
        ['tax-groups', 'taxGroupList', 'taxGroups'],
        ['tax-indicators', 'taxIndicators', 'taxIndicators'],
        ['payment-types', 'paymentTypeList', 'paymentTypes'],
        ['document-types', 'documentTypesList', 'documentTypes'],
        ['ref-document-types', 'refDocumentTypes', 'refDocumentTypes'],
        ['void-reasons', 'voidReasonList', 'voidReasons'],
        ['reject-reason', 'rejectReasonList', 'rejectReasons'],
        ['correction-reason', 'correctionReasonList', 'correctionReasons'],
        ['currency', 'currencyList', 'currencies'],
      ] as const;

      for (const [path, responseKey, field] of endpoints) {
        const response = await this.transport.call<Record<string, unknown>>(path, headers);
        const list = response?.[responseKey];
        if (Array.isArray(list) && list.length) {
          (next as Record<string, unknown>)[field] = list;
        }
      }

      await this.inContext(() =>
        setDoc(
          doc(this.firestore, `companies/${company.id}/settings/codebooks`),
          next,
          { merge: true },
        ),
      );
      return true;
    } catch (error) {
      this.syncError.set(
        error instanceof UjpUnavailableError
          ? error.message
          : `Неуспешно превземање на шифрарниците: ${(error as Error)?.message ?? error}`,
      );
      return false;
    } finally {
      this.syncing.set(false);
    }
  }
}
