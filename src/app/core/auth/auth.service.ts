import { Injectable, computed, inject, signal } from '@angular/core';
import {
  Auth,
  EmailAuthProvider,
  GoogleAuthProvider,
  User,
  createUserWithEmailAndPassword,
  reauthenticateWithCredential,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updatePassword,
  updateProfile,
  user,
} from '@angular/fire/auth';
import { Firestore, doc, getDoc, serverTimestamp, setDoc, updateDoc } from '@angular/fire/firestore';
import { toSignal } from '@angular/core/rxjs-interop';
import { filter, firstValueFrom, of, take, timeout } from 'rxjs';
import type { UserProfile } from '../models/user.model';
import { injectFirebaseContext } from '../firebase/injection';

/**
 * Authentication and the `users/{uid}` profile that hangs off it.
 *
 * The profile is what tells the app which companies a user may act for, so it
 * is created on first sign-in — before that, a freshly authenticated user has
 * no document at all and every company query would come back empty.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly auth = inject(Auth);
  private readonly firestore = inject(Firestore);
  private readonly inContext = injectFirebaseContext();

  /**
   * `undefined` while Firebase is still restoring the session, `null` when
   * signed out, a `User` when signed in. The three-state distinction matters:
   * routing on `null` too early bounces a signed-in user to the login screen.
   */
  private readonly user$ = user(this.auth);
  readonly user = toSignal(this.user$, { initialValue: undefined });

  readonly isAuthenticated = () => this.user() != null;
  readonly isResolving = () => this.user() === undefined;

  /** Last auth error, in Macedonian, for the login form to display. */
  readonly error = signal<string | null>(null);
  readonly busy = signal(false);

  async signInWithGoogle(): Promise<boolean> {
    return this.run(async () => {
      const provider = new GoogleAuthProvider();
      // Always show the chooser: people commonly have a personal and a work
      // Google account and land in the wrong one otherwise.
      provider.setCustomParameters({ prompt: 'select_account' });
      const credential = await signInWithPopup(this.auth, provider);
      await this.ensureProfile(credential.user);
    });
  }

  async signInWithEmail(email: string, password: string): Promise<boolean> {
    return this.run(async () => {
      const credential = await signInWithEmailAndPassword(this.auth, email.trim(), password);
      await this.ensureProfile(credential.user);
    });
  }

  async register(email: string, password: string, displayName: string): Promise<boolean> {
    return this.run(async () => {
      const credential = await createUserWithEmailAndPassword(
        this.auth,
        email.trim(),
        password,
      );
      const name = displayName.trim();
      if (name) await updateProfile(credential.user, { displayName: name });
      await this.ensureProfile(credential.user, name);
    });
  }

  async resetPassword(email: string): Promise<boolean> {
    return this.run(() => sendPasswordResetEmail(this.auth, email.trim()));
  }

  /**
   * Whether this account signs in with a password at all. Someone who signs in
   * with Google has none to change — their password is Google's.
   */
  readonly hasPassword = computed(
    () => this.user()?.providerData.some((p) => p.providerId === 'password') ?? false,
  );

  /**
   * Changes the signed-in user's password.
   *
   * Firebase refuses a password change from a session that is not recent, and
   * a customer handed a password by the operator may well have been signed in
   * for days. So the current password is asked for every time and used to
   * re-authenticate first — which also means a phone left unlocked on a desk
   * cannot be used to lock the owner out of their own account.
   *
   * Resolves to `null` on success, or the message to show.
   */
  async changePassword(currentPassword: string, newPassword: string): Promise<string | null> {
    const account = this.auth.currentUser;
    if (!account?.email) return 'Не сте најавени.';
    try {
      await reauthenticateWithCredential(
        account,
        EmailAuthProvider.credential(account.email, currentPassword),
      );
      await updatePassword(account, newPassword);
      return null;
    } catch (error) {
      return describePasswordChangeError(error);
    }
  }

  /**
   * Signs out, and waits for the app to actually believe it.
   *
   * Firebase resolves `signOut` before the auth-state observable emits, so for
   * one tick `user()` still holds the old account. Navigating to /najava inside
   * that window met `guestGuard`, which saw a signed-in user and bounced
   * straight back — leaving the first click on Одјава apparently doing nothing
   * and only the second one working. Waiting for the null makes one click
   * enough. The timeout is a safety net: a sign-out that somehow never emits
   * must not hang the button forever.
   */
  async signOut(): Promise<void> {
    await signOut(this.auth);
    await firstValueFrom(
      this.user$.pipe(
        filter((account) => account === null),
        take(1),
        timeout({ first: 3000, with: () => of(null) }),
      ),
    );
  }

  /** Creates `users/{uid}` on first sign-in, refreshes `lastLoginAt` after. */
  private async ensureProfile(account: User, displayNameOverride?: string): Promise<void> {
    const ref = doc(this.firestore, 'users', account.uid);
    const snapshot = await this.inContext(() => getDoc(ref));

    if (!snapshot.exists()) {
      const profile: UserProfile = {
        uid: account.uid,
        email: account.email ?? '',
        displayName: displayNameOverride || account.displayName || account.email || '',
        photoUrl: account.photoURL ?? null,
        defaultCompanyId: null,
        companyIds: [],
        locale: 'mk',
        createdAt: Date.now(),
        lastLoginAt: Date.now(),
      };
      await this.inContext(() => setDoc(ref, profile));
      return;
    }

    await this.inContext(() =>
      updateDoc(ref, {
        lastLoginAt: Date.now(),
        email: account.email ?? '',
        photoUrl: account.photoURL ?? null,
        // `serverTimestamp` is only used for audit ordering, not for business
        // dates, which stay plain calendar strings.
        touchedAt: serverTimestamp(),
      }),
    );
  }

  /** Wraps an auth call with busy/error state and Macedonian messages. */
  private async run(action: () => Promise<unknown>): Promise<boolean> {
    this.busy.set(true);
    this.error.set(null);
    try {
      await action();
      return true;
    } catch (error) {
      this.error.set(describeAuthError(error));
      return false;
    } finally {
      this.busy.set(false);
    }
  }
}

/**
 * The same, for changing a password while signed in. A wrong password here is
 * the *current* one — „погрешна е-пошта или лозинка“ would send the person off
 * to check an e-mail address they never typed.
 */
export function describePasswordChangeError(error: unknown): string {
  const code = (error as { code?: string })?.code ?? '';
  switch (code) {
    case 'auth/wrong-password':
    case 'auth/invalid-credential':
      return 'Тековната лозинка не е точна.';
    case 'auth/weak-password':
      return `Новата лозинка е прекратка — потребни се најмалку ${MIN_PASSWORD_LENGTH} знаци.`;
    case 'auth/too-many-requests':
      return 'Премногу погрешни обиди. Почекајте неколку минути и пробајте повторно.';
    case 'auth/requires-recent-login':
      return 'Одјавете се, најавете се повторно и пробајте пак.';
    case 'auth/network-request-failed':
      return 'Нема врска со серверот. Проверете го интернетот.';
    default:
      return describeAuthError(error);
  }
}

/** What Firebase Auth accepts; a shorter password is refused by the server. */
export const MIN_PASSWORD_LENGTH = 6;

/** Turns a Firebase auth error code into something a user can act on. */
export function describeAuthError(error: unknown): string {
  const code = (error as { code?: string })?.code ?? '';
  switch (code) {
    case 'auth/invalid-email':
      return 'Неважечка е-пошта.';
    case 'auth/user-disabled':
      return 'Сметката е оневозможена.';
    case 'auth/user-not-found':
    case 'auth/wrong-password':
    case 'auth/invalid-credential':
      return 'Погрешна е-пошта или лозинка.';
    case 'auth/email-already-in-use':
      return 'Веќе постои сметка со оваа е-пошта.';
    case 'auth/weak-password':
      return 'Лозинката е прекратка — потребни се најмалку 6 знаци.';
    case 'auth/popup-closed-by-user':
    case 'auth/cancelled-popup-request':
      return 'Најавата беше прекината.';
    case 'auth/popup-blocked':
      return 'Прозорецот за најава е блокиран од прелистувачот.';
    case 'auth/network-request-failed':
      return 'Нема врска со серверот. Проверете го интернетот.';
    case 'auth/too-many-requests':
      return 'Премногу обиди. Обидете се повторно подоцна.';
    default:
      return (error as { message?: string })?.message ?? 'Настана неочекувана грешка.';
  }
}
