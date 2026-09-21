export interface FirebaseWebConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
  measurementId?: string;
}

export interface EmulatorHostPort {
  host: string;
  port: number;
}

export interface EmulatorConfig {
  authUrl: string;
  firestore: EmulatorHostPort;
  functions: EmulatorHostPort;
  storage: EmulatorHostPort;
}

export interface UjpConfig {
  environment: 'test' | 'production';
  /** Code-list / lookup services, e.g. `${apiBaseUrl}/tax-groups`. */
  apiBaseUrl: string;
  /** Document submission endpoint (separate host path from the lookups). */
  sendUrl: string;
  /** Public EUID viewer that the invoice QR code points at. */
  euidViewerUrl: string;
}

/**
 * How the operator gets paid.
 *
 * Lives in configuration rather than the database because it is the same for
 * everyone and changing it is a deliberate act. A customer whose subscription
 * lapsed must be able to see the price, the account to pay into and a way to
 * reach a human — without any of that, "Претплатата истече" is a dead end.
 */
export interface BillingConfig {
  /** Seller of the subscription — your own company. */
  operatorName: string;
  operatorTaxNumber: string;
  bankName: string;
  bankAccount: string;
  contactEmail: string;
  contactPhone: string;
  /** Headline price, already formatted, e.g. `6.000 ден.` */
  annualPrice: string;
  monthlyPrice: string;
  /** Shown under the price, e.g. "без ДДВ" or "со вклучен ДДВ". */
  priceNote: string;
}

export interface AppEnvironment {
  production: boolean;
  useEmulators: boolean;
  firebase: FirebaseWebConfig;
  emulators: EmulatorConfig | null;
  ujp: UjpConfig;
  billing: BillingConfig;
}
