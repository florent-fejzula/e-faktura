import { Injectable, computed, inject } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import {
  Firestore,
  collection,
  collectionData,
  doc,
  docData,
  updateDoc,
} from '@angular/fire/firestore';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { Observable, of, switchMap } from 'rxjs';
import { AuthService } from '../auth/auth.service';
import { injectFirebaseContext } from '../firebase/injection';
import type { Company, Subscription, SubscriptionPlan } from '../models/company.model';
import type { CreateCustomerInput, CreateCustomerResult } from '../models/provisioning.model';
import type { CompanyModules } from '../modules/modules';
import { addDays, todayIso } from '../util/dates';

/**
 * The operator's view: every company on the instance, and the one date that
 * decides whether it can still issue invoices.
 *
 * Admin is a document under `/admins/{uid}` that only the Firebase console can
 * create — deliberately not a flag on the user profile, which users can write.
 * The security rules check the same collection, so this service can see
 * everything only because the rules already agreed it may.
 */
@Injectable({ providedIn: 'root' })
export class AdminService {
  private readonly firestore = inject(Firestore);
  private readonly functions = inject(Functions);
  private readonly auth = inject(AuthService);
  private readonly inContext = injectFirebaseContext();

  /**
   * Whether the signed-in user is the operator.
   *
   * `undefined` while unknown, so the shell can withhold the nav entry instead
   * of flashing it. A read denied by the rules resolves to false.
   */
  private readonly adminDoc = toSignal(
    toObservable(this.auth.user).pipe(
      switchMap((user) => {
        if (!user) return of(null);
        return this.inContext(
          () =>
            docData(doc(this.firestore, 'admins', user.uid)) as Observable<
              Record<string, unknown> | undefined
            >,
        );
      }),
    ),
    { initialValue: undefined },
  );

  readonly isAdmin = computed(() => {
    const value = this.adminDoc();
    return value === undefined ? undefined : !!value;
  });

  /** Every company, newest first. Only resolves for an admin. */
  private readonly allCompanies = toSignal(
    toObservable(this.isAdmin).pipe(
      switchMap((isAdmin) => {
        if (!isAdmin) return of(isAdmin === undefined ? undefined : []);
        return this.inContext(
          () =>
            collectionData(collection(this.firestore, 'companies'), {
              idField: 'id',
            }) as Observable<Company[]>,
        );
      }),
    ),
    { initialValue: undefined },
  );

  readonly companies = computed<Company[] | undefined>(() => {
    const list = this.allCompanies();
    if (!list) return list ?? undefined;
    return [...list].sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
  });

  /**
   * Moves the paid-through date.
   *
   * Extending from *today* rather than from the current expiry is deliberate
   * for a lapsed account: someone who renews three months late is buying a year
   * from now, not a year that already partly elapsed. An account still running
   * extends from its own end date so nothing is lost by paying early.
   */
  async extend(company: Company, days: number, note?: string): Promise<string> {
    const current = company.subscription?.paidUntil;
    const today = todayIso();
    const from = current && current > today ? current : today;
    const paidUntil = addDays(from, days);

    await this.setSubscription(company.id, {
      paidUntil,
      plan: 'paid',
      note: note ?? company.subscription?.note ?? '',
    });

    return paidUntil;
  }

  /** Sets the subscription wholesale — used by the date picker and the note. */
  async setSubscription(companyId: string, subscription: Subscription): Promise<void> {
    await this.inContext(() =>
      updateDoc(doc(this.firestore, 'companies', companyId), {
        subscription,
        updatedAt: Date.now(),
        updatedByUid: this.auth.user()?.uid ?? '',
      }),
    );
  }

  /**
   * Switches optional features on or off for one company. The security rules
   * accept this write only from the operator, so a customer cannot enable a
   * module from the browser console.
   */
  async setModules(companyId: string, modules: CompanyModules): Promise<void> {
    await this.inContext(() =>
      updateDoc(doc(this.firestore, 'companies', companyId), {
        modules,
        updatedAt: Date.now(),
        updatedByUid: this.auth.user()?.uid ?? '',
      }),
    );
  }

  async setPlan(company: Company, plan: SubscriptionPlan): Promise<void> {
    await this.setSubscription(company.id, {
      ...(company.subscription ?? { paidUntil: null, note: '' }),
      plan,
    } as Subscription);
  }

  /**
   * Provisions a customer: auth account, profile and company in one call.
   *
   * This cannot be done from the browser. `createUserWithEmailAndPassword`
   * swaps the *current* session for the new account, so doing it here would
   * sign the operator out of their own admin screen and into the customer they
   * just created. The `createCustomer` function does it with the Admin SDK
   * instead, which also lets it set `ownerUid` to someone else and write a real
   * paid-through date — both of which the security rules refuse from a client.
   */
  async createCustomer(input: CreateCustomerInput): Promise<CreateCustomerResult> {
    const call = this.inContext(() =>
      httpsCallable<CreateCustomerInput, CreateCustomerResult>(this.functions, 'createCustomer'),
    );

    try {
      const response = await call(input);
      return response.data;
    } catch (error) {
      throw new Error(describeCallableError(error));
    }
  }
}

/**
 * Turns a callable rejection into something the operator can act on.
 *
 * The function raises `HttpsError` with a Macedonian message already in it, so
 * for a deliberate rejection the message passes straight through. Everything
 * else is a transport or deployment problem, which needs its own wording —
 * "internal" on an undeployed function would otherwise read as a data error and
 * send the operator hunting through the form.
 */
export function describeCallableError(error: unknown): string {
  const { code, message } = (error ?? {}) as { code?: string; message?: string };

  switch (code) {
    case 'functions/unauthenticated':
      return 'Сесијата истече. Најавете се повторно.';
    case 'functions/permission-denied':
      return 'Немате администраторски права.';
    case 'functions/not-found':
      return 'Функцијата не е објавена. Извршете: firebase deploy --only functions';
    case 'functions/unavailable':
    case 'functions/deadline-exceeded':
      return 'Нема врска со серверот. Обидете се повторно.';
    case 'functions/already-exists':
    case 'functions/invalid-argument':
    case 'functions/internal':
      return message ?? 'Создавањето не успеа.';
    default:
      return message ?? 'Настана неочекувана грешка.';
  }
}
