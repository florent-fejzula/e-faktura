/**
 * Address split exactly the way UJP requires it (codebook UJP03-07-01..04).
 * A single free-text address line is *not* accepted by the e-Faktura API, so
 * the app captures the parts separately from the very first onboarding screen.
 */
export interface Address {
  streetAddress: string;
  streetNumber: string;
  postalCode: string;
  city: string;
  countryCode: string;
  countryName: string;
}

export function emptyAddress(): Address {
  return {
    streetAddress: '',
    streetNumber: '',
    postalCode: '',
    city: '',
    countryCode: 'MK',
    countryName: 'Северна Македонија',
  };
}

/** One-line rendering for lists, PDFs and table cells. */
export function formatAddress(a: Address | null | undefined): string {
  if (!a) return '';
  const street = [a.streetAddress, a.streetNumber].filter(Boolean).join(' ').trim();
  const town = [a.postalCode, a.city].filter(Boolean).join(' ').trim();
  return [street, town].filter(Boolean).join(', ');
}

export interface BankAccount {
  id: string;
  bankName: string;
  accountNumber: string;
  /** Shown first on the invoice and preselected on new documents. */
  isPrimary: boolean;
}

export interface AuditFields {
  createdAt: number;
  updatedAt: number;
  createdByUid: string;
  updatedByUid: string;
}
