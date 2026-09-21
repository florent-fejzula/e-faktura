import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { logger, setGlobalOptions } from 'firebase-functions/v2';
import { HttpsError, onCall, type CallableRequest } from 'firebase-functions/v2/https';

initializeApp();

/**
 * Europe rather than the us-central1 default: every user of this app is in
 * Macedonia, and this round trip is the only thing the operator waits on.
 * `maxInstances` is a cost guard, not a capacity plan — this endpoint is called
 * by one person, a few times a month.
 */
setGlobalOptions({ region: 'europe-west1', maxInstances: 10 });

/* -------------------------------------------------------------------------- */
/* Wire types — mirrored in src/app/core/models/provisioning.model.ts          */
/* -------------------------------------------------------------------------- */

interface AddressInput {
  streetAddress: string;
  streetNumber: string;
  postalCode: string;
  city: string;
  countryCode: string;
  countryName: string;
}

interface BankAccountInput {
  id: string;
  bankName: string;
  accountNumber: string;
  isPrimary: boolean;
}

interface SubscriptionInput {
  paidUntil: string;
  plan: 'trial' | 'paid';
  note: string;
}

interface CreateCustomerInput {
  /** Sign-in credentials handed to the customer. */
  account: { email: string; password: string; displayName: string };
  company: {
    name: string;
    taxNumber: string;
    vatNumber: string;
    isVatRegistered: boolean;
    registrationNumber: string;
    address: AddressInput;
    email: string;
    phone: string;
    contactPerson: string;
    bankAccounts: BankAccountInput[];
  };
  /**
   * Sent by the client rather than computed here on purpose: this runs in UTC
   * and Macedonia is an hour or two ahead, so a date derived server-side is a
   * day short for anything created late in the evening. The operator's browser
   * already knows the right calendar date.
   */
  subscription: SubscriptionInput;
}

interface CreateCustomerResult {
  uid: string;
  companyId: string;
  email: string;
}

/* -------------------------------------------------------------------------- */
/* Validation                                                                  */
/* -------------------------------------------------------------------------- */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const TAX_NUMBER = /^\d{13}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function str(value: unknown, field: string, opts: { max?: number; required?: boolean } = {}): string {
  const { max = 200, required = false } = opts;
  const out = typeof value === 'string' ? value.trim() : '';
  if (required && !out) throw new HttpsError('invalid-argument', `${field} е задолжително.`);
  if (out.length > max) {
    throw new HttpsError('invalid-argument', `${field} е подолго од ${max} знаци.`);
  }
  return out;
}

function validate(raw: unknown): CreateCustomerInput {
  const input = (raw ?? {}) as Partial<CreateCustomerInput>;
  const account = input.account ?? ({} as CreateCustomerInput['account']);
  const company = input.company ?? ({} as CreateCustomerInput['company']);
  const sub = input.subscription ?? ({} as SubscriptionInput);
  const address = company.address ?? ({} as AddressInput);

  const email = str(account.email, 'Е-пошта за најава', { required: true }).toLowerCase();
  if (!EMAIL.test(email)) throw new HttpsError('invalid-argument', 'Неважечка е-пошта за најава.');

  // Firebase itself accepts six characters. Twelve is this app's floor because
  // the operator generates the password and the customer never has to invent or
  // remember it, so length costs them nothing.
  const password = typeof account.password === 'string' ? account.password : '';
  if (password.length < 12) {
    throw new HttpsError('invalid-argument', 'Лозинката мора да има најмалку 12 знаци.');
  }

  const taxNumber = str(company.taxNumber, 'ЕДБ', { required: true });
  if (!TAX_NUMBER.test(taxNumber)) {
    throw new HttpsError('invalid-argument', 'ЕДБ мора да има точно 13 цифри.');
  }

  if (!ISO_DATE.test(String(sub.paidUntil ?? ''))) {
    throw new HttpsError('invalid-argument', 'Неважечки датум на претплата.');
  }
  if (sub.plan !== 'trial' && sub.plan !== 'paid') {
    throw new HttpsError('invalid-argument', 'Неважечки тип на претплата.');
  }

  const accounts = Array.isArray(company.bankAccounts) ? company.bankAccounts : [];
  if (accounts.length > 10) {
    throw new HttpsError('invalid-argument', 'Премногу банкарски сметки.');
  }

  return {
    account: {
      email,
      password,
      displayName: str(account.displayName, 'Име', { max: 80 }),
    },
    company: {
      name: str(company.name, 'Назив на фирмата', { max: 80, required: true }),
      taxNumber,
      vatNumber: str(company.vatNumber, 'ДДВ број', { max: 20 }),
      isVatRegistered: company.isVatRegistered !== false,
      registrationNumber: str(company.registrationNumber, 'ЕМБС', { max: 20 }),
      address: {
        streetAddress: str(address.streetAddress, 'Улица', { max: 100 }),
        streetNumber: str(address.streetNumber, 'Број', { max: 20 }),
        postalCode: str(address.postalCode, 'Поштенски број', { max: 10 }),
        city: str(address.city, 'Град', { max: 60 }),
        countryCode: str(address.countryCode, 'Држава', { max: 2 }) || 'MK',
        countryName: str(address.countryName, 'Држава', { max: 60 }) || 'Северна Македонија',
      },
      email: str(company.email, 'Е-пошта', { max: 120 }),
      phone: str(company.phone, 'Телефон', { max: 40 }),
      contactPerson: str(company.contactPerson, 'Контакт лице', { max: 80 }),
      bankAccounts: accounts.map((bank, index) => ({
        id: str(bank?.id, 'Сметка', { max: 64 }) || `bank-${index + 1}`,
        bankName: str(bank?.bankName, 'Банка', { max: 80 }),
        accountNumber: str(bank?.accountNumber, 'Трансакциска сметка', { max: 40 }),
        isPrimary: bank?.isPrimary === true,
      })),
    },
    subscription: {
      paidUntil: sub.paidUntil,
      plan: sub.plan,
      note: str(sub.note, 'Забелешка', { max: 500 }),
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Defaults                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Deliberately not asked for on the provisioning form. Every customer starts on
 * the common Macedonian scheme (`0001/2026`, restarting each January) and can
 * change it under Поставки before issuing anything — a better place for it than
 * a form the operator fills in on their behalf.
 *
 * Kept in step with `defaultNumbering()` in company.model.ts by hand. It only
 * seeds a new record, so a drift between the two costs a wrong starting pattern
 * on one company, not a broken app.
 */
function defaultNumbering() {
  return {
    pattern: '{SEQ}/{YYYY}',
    prefix: '',
    padding: 4,
    reset: 'yearly' as const,
    nextSeq: 1,
    periodKey: String(new Date().getUTCFullYear()),
  };
}

/** Mirrors `defaultCompanyDefaults()` in company.model.ts. */
function defaultCompanyDefaults() {
  return {
    taxIndicator: 'DDV-A',
    paymentTypeCode: 'P12',
    currency: 'MKD',
    dueDays: 15,
    unit: 'ком',
    invoiceFooter: '',
  };
}

/* -------------------------------------------------------------------------- */
/* createCustomer                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Provisions a customer end to end: a Firebase Auth account, the `users/{uid}`
 * profile and the `companies/{id}` record, wired together so the person can
 * sign in with the credentials the operator hands them and land straight on an
 * empty invoice list — no onboarding, nothing left to fill in.
 *
 * This is a function rather than a form in the browser for one reason:
 * `createUserWithEmailAndPassword` on the client replaces the *caller's*
 * session with the new account, so an operator creating a customer would be
 * signed out of their own admin screen and into their customer's.
 *
 * Writes go through the Admin SDK, which bypasses the security rules — that is
 * what lets a record be created with someone else as its owner and with a real
 * paid-through date, neither of which any browser is allowed to do.
 */
export const createCustomer = onCall(
  // Origin is deliberately left unrestricted (the callable default). The app is
  // served from one domain and the function from another, so every real call is
  // cross-origin, and what guards this endpoint is the Firebase Auth token plus
  // the /admins check below — not where the request claims to come from. An
  // origin allow-list here buys nothing and fails as an opaque CORS error the
  // first time the hosting domain changes.
  async (request: CallableRequest<unknown>): Promise<CreateCustomerResult> => {
    const callerUid = request.auth?.uid;
    if (!callerUid) throw new HttpsError('unauthenticated', 'Не сте најавени.');

    // The same `/admins/{uid}` collection the security rules and the admin
    // screen use. It is writable only from the Firebase console, so operator
    // rights can never be granted from inside the app.
    const isAdmin = (await getFirestore().doc(`admins/${callerUid}`).get()).exists;
    if (!isAdmin) throw new HttpsError('permission-denied', 'Потребни се администраторски права.');

    const input = validate(request.data);

    let uid: string;
    try {
      const user = await getAuth().createUser({
        email: input.account.email,
        password: input.account.password,
        displayName: input.account.displayName || input.company.name,
        emailVerified: false,
      });
      uid = user.uid;
    } catch (error) {
      const code = (error as { code?: string })?.code ?? '';
      if (code === 'auth/email-already-exists') {
        throw new HttpsError('already-exists', 'Веќе постои сметка со оваа е-пошта.');
      }
      if (code === 'auth/invalid-password') {
        throw new HttpsError('invalid-argument', 'Лозинката не ги исполнува условите.');
      }
      logger.error('createUser failed', { error });
      throw new HttpsError('internal', 'Создавањето на сметката не успеа.');
    }

    const now = Date.now();
    const firestore = getFirestore();
    const companyRef = firestore.collection('companies').doc();

    try {
      const batch = firestore.batch();

      batch.set(companyRef, {
        ...input.company,
        logoDataUrl: null,
        numbering: defaultNumbering(),
        defaults: defaultCompanyDefaults(),
        ujp: { eujpId: '', certificateSerialNumber: '', verifiedAt: null },
        subscription: input.subscription,
        stats: { issuedCount: 0, lastIssuedAt: null },
        ownerUid: uid,
        memberUids: [uid],
        isActive: true,
        createdAt: now,
        updatedAt: now,
        createdByUid: callerUid,
        updatedByUid: callerUid,
      });

      // Written here rather than left to `AuthService.ensureProfile` on first
      // sign-in, because that path creates the profile with no default company
      // and the customer would be bounced through onboarding on the way in.
      batch.set(firestore.doc(`users/${uid}`), {
        uid,
        email: input.account.email,
        displayName: input.account.displayName || input.company.name,
        photoUrl: null,
        defaultCompanyId: companyRef.id,
        companyIds: [companyRef.id],
        locale: 'mk',
        createdAt: now,
        lastLoginAt: 0,
      });

      await batch.commit();
    } catch (error) {
      // An auth account with no company behind it is worse than no account at
      // all: the customer could sign in and be dropped into onboarding, and the
      // next attempt to provision them would fail on "email already in use"
      // with no obvious cause. Roll it back and report the real failure.
      logger.error('provisioning write failed, removing the auth account', { uid, error });
      await getAuth()
        .deleteUser(uid)
        .catch((cleanupError) => {
          logger.error('rollback failed — orphan auth account left behind', { uid, cleanupError });
        });
      throw new HttpsError(
        'internal',
        'Фирмата не се зачува. Сметката е избришана — обидете се повторно.',
      );
    }

    logger.info('customer provisioned', {
      uid,
      companyId: companyRef.id,
      taxNumber: input.company.taxNumber,
      byUid: callerUid,
    });

    return { uid, companyId: companyRef.id, email: input.account.email };
  },
);
