import { Injectable, inject } from '@angular/core';
import { Firestore, collection, doc, getDoc, writeBatch } from '@angular/fire/firestore';
import { AuthService } from '../auth/auth.service';
import { injectFirebaseContext } from '../firebase/injection';
import type { PrintSettings } from '../models/company.model';
import type { PreparedLogo } from '../util/logo-image';

/** What saving the Печатење panel does to the logo. */
export type LogoChange =
  | { kind: 'keep' }
  | { kind: 'remove' }
  | { kind: 'replace'; logo: PreparedLogo };

/**
 * A company's print settings and the logo they show.
 *
 * Logos are documents of their own, `companies/{id}/logos/{logoId}`, written
 * once and never changed. An issued invoice keeps the id of the logo it was
 * printed with, so uploading a new logo adds a document and an old invoice
 * still reprints as it was. Keeping the image out of the invoices also keeps
 * it out of the invoice list, which downloads a year of invoices at a time.
 */
@Injectable({ providedIn: 'root' })
export class PrintSettingsService {
  private readonly firestore = inject(Firestore);
  private readonly auth = inject(AuthService);
  private readonly inContext = injectFirebaseContext();

  /** Logos never change once written, so each is fetched at most once per session. */
  private readonly logos = new Map<string, Promise<string | null>>();

  logoUrl(companyId: string, logoId: string): Promise<string | null> {
    const key = `${companyId}/${logoId}`;
    let url = this.logos.get(key);
    if (!url) {
      url = this.inContext(() =>
        getDoc(doc(this.firestore, 'companies', companyId, 'logos', logoId)),
      )
        .then((snap) => (snap.get('dataUrl') as string | undefined) ?? null)
        .catch(() => {
          // Offline before it was ever cached: try again next time instead of
          // remembering the failure for the rest of the session.
          this.logos.delete(key);
          return null;
        });
      this.logos.set(key, url);
    }
    return url;
  }

  /**
   * Saves the settings and any new logo in one batch, so the company can never
   * point at a logo that failed to save.
   */
  async save(companyId: string, settings: PrintSettings, logo: LogoChange): Promise<void> {
    const uid = this.auth.user()?.uid ?? '';
    const now = Date.now();
    const changes: Record<string, unknown> = { print: settings, updatedAt: now, updatedByUid: uid };

    const newLogoId = await this.inContext(() => {
      const batch = writeBatch(this.firestore);
      let logoId: string | null = null;

      if (logo.kind === 'replace') {
        const ref = doc(collection(this.firestore, 'companies', companyId, 'logos'));
        batch.set(ref, {
          dataUrl: logo.logo.dataUrl,
          width: logo.logo.width,
          height: logo.logo.height,
          createdAt: now,
          createdByUid: uid,
        });
        logoId = ref.id;
        changes['logoId'] = ref.id;
      } else if (logo.kind === 'remove') {
        changes['logoId'] = null;
      }

      batch.update(doc(this.firestore, 'companies', companyId), changes);
      return batch.commit().then(() => logoId);
    });

    // Already in hand, so the preview and the next print need not read it back.
    if (newLogoId && logo.kind === 'replace') {
      this.logos.set(`${companyId}/${newLogoId}`, Promise.resolve(logo.logo.dataUrl));
    }
  }
}
