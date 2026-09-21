export interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  photoUrl: string | null;
  /** Company opened on sign-in; also the target for "new invoice". */
  defaultCompanyId: string | null;
  /** Companies the user can act for. Mirrors `Company.memberUids`. */
  companyIds: string[];
  locale: 'mk' | 'en';
  createdAt: number;
  lastLoginAt: number;
}
