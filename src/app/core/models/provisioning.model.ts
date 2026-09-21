import type { Address, BankAccount } from './common.model';
import type { Subscription } from './company.model';

/**
 * The payload of the `createCustomer` callable — the operator provisioning a
 * customer, rather than a customer signing themselves up.
 *
 * Mirrored by hand in functions/src/index.ts, which re-validates every field.
 * Nothing here is trusted: the function is the boundary, this is just the shape
 * the admin form fills in.
 */
export interface CreateCustomerInput {
  /** Credentials handed to the customer. Never stored anywhere. */
  account: {
    email: string;
    password: string;
    displayName: string;
  };

  company: {
    name: string;
    taxNumber: string;
    vatNumber: string;
    isVatRegistered: boolean;
    registrationNumber: string;
    address: Address;
    /** Contact address for the company, which need not be the login email. */
    email: string;
    phone: string;
    contactPerson: string;
    bankAccounts: BankAccount[];
  };

  /**
   * Computed in the browser, not on the server: the function runs in UTC and
   * Macedonia is ahead of it, so a date derived server-side is a day short for
   * anything created in the evening.
   */
  subscription: Subscription & { paidUntil: string };
}

export interface CreateCustomerResult {
  uid: string;
  companyId: string;
  email: string;
}

/** What the operator copies out and sends on. Held in memory only. */
export interface IssuedCredentials {
  email: string;
  password: string;
  companyName: string;
}
