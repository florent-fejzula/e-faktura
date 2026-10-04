import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import {
  Firestore,
  addDoc,
  arrayUnion,
  collection,
  collectionData,
  doc,
  docData,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from '@angular/fire/firestore';
import { Observable, of, switchMap } from 'rxjs';
import { AuthService } from '../auth/auth.service';
import type { Company } from '../models/company.model';
import {
  defaultCompanyDefaults,
  defaultNumbering,
  defaultStats,
  defaultSubscription,
  isSubscriptionActive,
  subscriptionState,
} from '../models/company.model';
import { emptyAddress } from '../models/common.model';
import { hasModule, type ModuleId } from '../modules/modules';
import type { UserProfile } from '../models/user.model';
import { injectFirebaseContext } from '../firebase/injection';

const ACTIVE_COMPANY_KEY = 'efaktura.activeCompanyId';

/**
 * Companies the signed-in user can act for, plus which one is currently open.
 *
 * A user can legitimately invoice for several entities (an accountant, or an
 * owner with two companies), so "which company am I acting as" is app-wide
 * state rather than a route parameter — every list, filter and new invoice
 * reads it.
 */
@Injectable({ providedIn: 'root' })
export class CompanyService {
  private readonly firestore = inject(Firestore);
  private readonly auth = inject(AuthService);
  private readonly inContext = injectFirebaseContext();

  /** The signed-in user's profile document. */
  readonly profile = toSignal(
    toObservable(this.auth.user).pipe(
      switchMap((user) =>
        user
          ? this.inContext(
              () => docData(doc(this.firestore, 'users', user.uid)) as Observable<UserProfile>,
            )
          : of(null),
      ),
    ),
    { initialValue: undefined },
  );

  /**
   * Every company the user is a member of. `undefined` until the first
   * snapshot arrives — an empty array has to mean "genuinely has none", or
   * onboarding fires in the split second before the query resolves.
   */
  private readonly companiesRaw = toSignal(
    toObservable(this.auth.user).pipe(
      switchMap((user) => {
        if (user === undefined) return of(undefined);
        if (user === null) return of([] as Company[]);
        return this.inContext(() => {
          const q = query(
            collection(this.firestore, 'companies'),
            where('memberUids', 'array-contains', user.uid),
          );
          return collectionData(q, { idField: 'id' }) as Observable<Company[]>;
        });
      }),
    ),
    { initialValue: undefined },
  );

  /** Companies, name-sorted, empty while still loading. */
  readonly companies = computed<Company[]>(() =>
    [...(this.companiesRaw() ?? [])].sort((a, b) => a.name.localeCompare(b.name, 'mk')),
  );

  /**
   * Explicitly chosen company. Seeded from localStorage so a reload reopens
   * the same company before the profile document has finished loading.
   */
  private readonly selectedId = signal<string | null>(readStoredCompanyId());

  readonly activeCompany = computed<Company | null>(() => {
    const list = this.companies();
    if (!list.length) return null;
    const preferred = this.selectedId() ?? this.profile()?.defaultCompanyId ?? null;
    return list.find((c) => c.id === preferred) ?? list[0];
  });

  readonly activeCompanyId = computed(() => this.activeCompany()?.id ?? null);

  /**
   * Subscription of the company currently being acted for.
   *
   * The UI reads these to hide what would fail anyway; the security rules are
   * what actually enforce them, so a stale signal costs a clear error message
   * rather than free access.
   */
  readonly subscription = computed(() => this.activeCompany()?.subscription ?? null);

  /**
   * Backfills a trial for a company created before subscriptions existed.
   *
   * Runs once per company: the rules accept this write only while the field is
   * absent, and the snapshot updates immediately afterwards. Without it an
   * early customer would open the app one morning and find themselves locked
   * out by a feature they never asked for.
   */
  private readonly backfilled = new Set<string>();
  private readonly backfillSubscription = effect(() => {
    const company = this.activeCompany();
    const uid = this.auth.user()?.uid;
    if (!company || !uid || company.subscription || this.backfilled.has(company.id)) return;
    if (company.ownerUid !== uid) return;

    this.backfilled.add(company.id);
    void this.inContext(() =>
      updateDoc(doc(this.firestore, 'companies', company.id), {
        subscription: defaultSubscription(),
        stats: company.stats ?? defaultStats(),
      }),
    ).catch(() => {
      // A denied write means someone else already backfilled it; the next
      // snapshot carries their value.
    });
  });
  readonly subscriptionState = computed(() => subscriptionState(this.subscription()));
  /**
   * Matches the security rule: a company with no subscription yet is mid
   * backfill, not lapsed, so it keeps working.
   */
  readonly canIssue = computed(() => {
    const company = this.activeCompany();
    if (!company) return false;
    return !company.subscription || isSubscriptionActive(company.subscription);
  });

  /**
   * Whether an optional feature is switched on for the company being acted
   * for. Reactive, so the nav entry and the editor's autocomplete appear the
   * moment the operator flips the switch — no reload.
   */
  hasModule(id: ModuleId): boolean {
    return hasModule(this.activeCompany()?.modules, id);
  }

  /** True only once we know for certain the user has no company yet. */
  readonly needsOnboarding = computed(() => {
    const loaded = this.companiesRaw();
    return loaded !== undefined && loaded.length === 0;
  });

  /** True while auth or the company query is still resolving. */
  readonly isLoading = computed(() => this.companiesRaw() === undefined);

  select(companyId: string): void {
    this.selectedId.set(companyId);
    writeStoredCompanyId(companyId);
    const user = this.auth.user();
    if (user) {
      void this.inContext(() =>
        updateDoc(doc(this.firestore, 'users', user.uid), {
          defaultCompanyId: companyId,
        }),
      );
    }
  }

  /**
   * Creates a company and links it to the current user in one go — the two
   * writes have to agree, or the user ends up with a company they cannot see.
   */
  async create(input: NewCompanyInput): Promise<string> {
    const user = this.auth.user();
    if (!user) throw new Error('Не сте најавени.');

    const now = Date.now();
    const company: Omit<Company, 'id'> = {
      name: input.name.trim(),
      taxNumber: input.taxNumber.trim(),
      vatNumber: input.vatNumber?.trim() ?? '',
      isVatRegistered: input.isVatRegistered,
      registrationNumber: input.registrationNumber?.trim() ?? '',
      address: input.address ?? emptyAddress(),
      email: input.email?.trim() ?? '',
      phone: input.phone?.trim() ?? '',
      contactPerson: input.contactPerson?.trim() ?? '',
      bankAccounts: input.bankAccounts ?? [],
      logoDataUrl: input.logoDataUrl ?? null,
      numbering: input.numbering ?? defaultNumbering(),
      defaults: input.defaults ?? defaultCompanyDefaults(),
      ujp: { eujpId: '', certificateSerialNumber: '', verifiedAt: null },
      subscription: defaultSubscription(),
      stats: defaultStats(),
      ownerUid: user.uid,
      memberUids: [user.uid],
      isActive: true,
      createdAt: now,
      updatedAt: now,
      createdByUid: user.uid,
      updatedByUid: user.uid,
    };

    const ref = await this.inContext(() =>
      addDoc(collection(this.firestore, 'companies'), company),
    );

    await this.inContext(() =>
      setDoc(
        doc(this.firestore, 'users', user.uid),
        {
          defaultCompanyId: ref.id,
          companyIds: arrayUnion(ref.id),
          touchedAt: serverTimestamp(),
        },
        { merge: true },
      ),
    );

    this.select(ref.id);
    return ref.id;
  }

  async update(companyId: string, changes: Partial<Company>): Promise<void> {
    const user = this.auth.user();
    await this.inContext(() =>
      updateDoc(doc(this.firestore, 'companies', companyId), {
        ...changes,
        updatedAt: Date.now(),
        updatedByUid: user?.uid ?? '',
      }),
    );
  }
}

export interface NewCompanyInput {
  name: string;
  taxNumber: string;
  isVatRegistered: boolean;
  vatNumber?: string;
  registrationNumber?: string;
  address?: Company['address'];
  email?: string;
  phone?: string;
  contactPerson?: string;
  bankAccounts?: Company['bankAccounts'];
  logoDataUrl?: string | null;
  numbering?: Company['numbering'];
  defaults?: Company['defaults'];
}

function readStoredCompanyId(): string | null {
  try {
    return localStorage.getItem(ACTIVE_COMPANY_KEY);
  } catch {
    return null;
  }
}

function writeStoredCompanyId(id: string): void {
  try {
    localStorage.setItem(ACTIVE_COMPANY_KEY, id);
  } catch {
    // Private browsing or blocked storage — the profile document still holds
    // the preference, so losing the local copy only costs a slower first paint.
  }
}
