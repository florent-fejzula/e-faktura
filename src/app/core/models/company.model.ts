import type { CompanyModules } from '../modules/modules';
import type { Address, AuditFields, BankAccount } from './common.model';
import { addDays, daysBetween, fromIsoDate, todayIso } from '../util/dates';

export type NumberingReset = 'yearly' | 'monthly' | 'never';

/**
 * Invoice numbering is pattern-driven so a company can keep whatever scheme
 * its accountant already uses. Tokens are substituted at issue time:
 *
 *   {SEQ}    sequence, zero-padded to `padding`
 *   {YYYY}   four digit year      {YY}  two digit year
 *   {MM}     two digit month
 *   {PREFIX} the `prefix` value
 *
 * Example: `{PREFIX}-{YYYY}-{SEQ}` with prefix `ФА` and padding 4 -> `ФА-2026-0007`.
 */
export interface NumberingConfig {
  pattern: string;
  prefix: string;
  padding: number;
  reset: NumberingReset;
  /** Sequence the *next* issued invoice will take, per current period. */
  nextSeq: number;
  /** Period the `nextSeq` belongs to: `2026`, `2026-08`, or `all`. */
  periodKey: string;
}

export function defaultNumbering(): NumberingConfig {
  return {
    pattern: '{SEQ}/{YYYY}',
    prefix: '',
    padding: 4,
    reset: 'yearly',
    nextSeq: 1,
    periodKey: String(new Date().getFullYear()),
  };
}

/**
 * Credentials the UJP e-Faktura API requires on every call. They are per
 * company, not per user: `X-EDB` identifies the trading entity and `X-EUJP-ID`
 * the authorised signer registered for it in the e-УЈП portal.
 */
export interface UjpCredentials {
  /** `X-EUJP-ID` — assigned when access is granted in e-УЈП. */
  eujpId: string;
  /** `X-SERIAL-NUMBER` — serial of the qualified signing certificate. */
  certificateSerialNumber: string;
  /** Set once a successful call has been made with these credentials. */
  verifiedAt: number | null;
}

export interface CompanyDefaults {
  /** Tax indicator code preselected on new invoice lines, e.g. `DDV-A`. */
  taxIndicator: string;
  /** Payment type code, e.g. `P12` (bank transfer). */
  paymentTypeCode: string;
  currency: string;
  /** Days added to the issue date to propose a due date. */
  dueDays: number;
  /** Unit of measure preselected on a new line. */
  unit: string;
  /** Optional boilerplate placed under the totals on every invoice. */
  invoiceFooter: string;
}

export function defaultCompanyDefaults(): CompanyDefaults {
  return {
    taxIndicator: 'DDV-A',
    paymentTypeCode: 'P12',
    currency: 'MKD',
    dueDays: 15,
    unit: 'ком',
    invoiceFooter: '',
  };
}

export interface Company extends AuditFields {
  id: string;

  /** Legal name — UJP `sellerName`, max 80 chars. */
  name: string;
  /** ЕДБ / tax number — UJP `sellerTin`. 13 digits for МК entities. */
  taxNumber: string;
  /** ДДВ број — UJP `sellerVatNumber`. Empty when not VAT registered. */
  vatNumber: string;
  isVatRegistered: boolean;
  /** ЕМБС, printed on invoices but not sent to UJP. */
  registrationNumber: string;

  address: Address;
  email: string;
  phone: string;
  contactPerson: string;

  bankAccounts: BankAccount[];
  logoDataUrl: string | null;

  numbering: NumberingConfig;
  defaults: CompanyDefaults;
  ujp: UjpCredentials;

  /**
   * Optional because companies created before subscriptions existed have
   * neither field. `CompanyService` fills them in on first load rather than
   * pretending they are always there — an absent subscription must not read as
   * a lapsed one, or an early customer gets locked out by an upgrade.
   */
  subscription?: Subscription;
  stats?: CompanyStats;

  /**
   * Optional features the operator has switched on for this company. Written
   * only from the admin screen — the rules reject it from anyone else, the
   * same way they protect `subscription`. See `core/modules/modules.ts`.
   */
  modules?: CompanyModules;

  ownerUid: string;
  /** Denormalised for Firestore `array-contains` security rules and queries. */
  memberUids: string[];
  isActive: boolean;
}

/**
 * What the account is paid up to.
 *
 * Deliberately one date. Billing is an invoice sent by bank transfer and
 * reconciled by hand, so there is no plan matrix, no seat count and no usage
 * meter to keep in step — extending access is moving a date forward.
 *
 * It hangs off the *company* rather than the user because a company is what
 * gets invoiced, and several people (owner, accountant, employee) can work in
 * one. Paying should not depend on which of them signs in.
 *
 * The client can never write this: the security rules reject any update from a
 * browser that touches it, so it moves only from the admin screen.
 */
export interface Subscription {
  /**
   * Access runs to the end of this day, as `YYYY-MM-DD`. Null means access was
   * never granted, which should not happen — `defaultSubscription` opens a
   * trial when the company is created.
   */
  paidUntil: string | null;
  /** Label only. Distinguishes a trial from a renewal in the admin list. */
  plan: SubscriptionPlan;
  /** Free-text, admin-only: payment reference, agreed terms, who to call. */
  note: string;
}

export type SubscriptionPlan = 'trial' | 'paid';

/**
 * Denormalised usage, kept so the admin screen can tell a company that is
 * really using the app from one that signed up and stopped — without the
 * operator being able to read anyone's invoices to find out.
 *
 * Maintained inside the transactions that issue and delete invoices, which
 * already write this document. Informational only: nothing is gated on it, so
 * it does not matter that a determined client could write a wrong number.
 */
export interface CompanyStats {
  issuedCount: number;
  lastIssuedAt: number | null;
}

export function defaultStats(): CompanyStats {
  return { issuedCount: 0, lastIssuedAt: null };
}

/** How long a new company gets before it has to pay. */
export const TRIAL_DAYS = 30;

/**
 * `none` is not `expired`: it means the company predates subscriptions and has
 * not been backfilled yet, which the rules grandfather rather than block. The
 * two must stay distinguishable or the admin list accuses working accounts of
 * having lapsed.
 */
export type SubscriptionState = 'none' | 'trial' | 'active' | 'expiring' | 'expired';

export function defaultSubscription(from = todayIso()): Subscription {
  return {
    paidUntil: addDays(from, TRIAL_DAYS),
    plan: 'trial',
    note: '',
  };
}

/**
 * Days remaining, counting today as one. Negative once it has lapsed.
 *
 * Compared as calendar dates rather than instants: a subscription paid until
 * the 29th is good for all of the 29th, whatever the clock says.
 */
export function daysRemaining(
  sub: Subscription | null | undefined,
  today = todayIso(),
): number {
  // A missing or unparseable date fails closed rather than reading as "today".
  if (!sub?.paidUntil || !fromIsoDate(sub.paidUntil)) return -1;
  return daysBetween(today, sub.paidUntil);
}

/** Bucket used for the badge in the admin list and the banner in the shell. */
export function subscriptionState(
  sub: Subscription | null | undefined,
  today = todayIso(),
): SubscriptionState {
  if (!sub || !sub.paidUntil) return 'none';
  const left = daysRemaining(sub, today);
  if (left < 0) return 'expired';
  if (left <= 7) return 'expiring';
  return sub?.plan === 'trial' ? 'trial' : 'active';
}

/** The one question the rest of the app asks. */
export function isSubscriptionActive(
  sub: Subscription | null | undefined,
  today = todayIso(),
): boolean {
  return daysRemaining(sub, today) >= 0;
}

export const SUBSCRIPTION_LABELS: Record<SubscriptionState, string> = {
  none: 'Нема',
  trial: 'Пробна',
  active: 'Активна',
  expiring: 'Истекува',
  expired: 'Истечена',
};

/** Snapshot embedded in an invoice so historical documents never change. */
export interface CompanySnapshot {
  id: string;
  name: string;
  taxNumber: string;
  vatNumber: string;
  isVatRegistered: boolean;
  registrationNumber: string;
  address: Address;
  email: string;
  phone: string;
  bankAccount: BankAccount | null;
  logoDataUrl: string | null;
}

export function snapshotCompany(c: Company): CompanySnapshot {
  return {
    id: c.id,
    name: c.name,
    taxNumber: c.taxNumber,
    vatNumber: c.vatNumber,
    isVatRegistered: c.isVatRegistered,
    registrationNumber: c.registrationNumber,
    address: c.address,
    email: c.email,
    phone: c.phone,
    bankAccount: c.bankAccounts.find((b) => b.isPrimary) ?? c.bankAccounts[0] ?? null,
    logoDataUrl: c.logoDataUrl,
  };
}
