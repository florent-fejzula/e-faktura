import { MIN_PASSWORD_LENGTH, describeAuthError, describePasswordChangeError } from './auth.service';

const failure = (code: string) => ({ code });

describe('changing a password', () => {
  it('says the current password is wrong, not the e-mail or password', () => {
    for (const code of ['auth/wrong-password', 'auth/invalid-credential']) {
      expect(describePasswordChangeError(failure(code))).toBe('Тековната лозинка не е точна.');
    }
    // The sign-in wording would send them off checking an address they never typed.
    expect(describeAuthError(failure('auth/invalid-credential'))).toContain('е-пошта');
  });

  it('names the length Firebase will accept', () => {
    expect(describePasswordChangeError(failure('auth/weak-password'))).toContain(
      String(MIN_PASSWORD_LENGTH),
    );
  });

  it('tells someone locked out by repeated attempts to wait', () => {
    expect(describePasswordChangeError(failure('auth/too-many-requests'))).toContain('Почекајте');
  });

  it('falls back to the general wording for anything else', () => {
    expect(describePasswordChangeError(failure('auth/user-disabled'))).toBe(
      describeAuthError(failure('auth/user-disabled')),
    );
    expect(describePasswordChangeError(new Error('boom'))).toBe('boom');
  });
});
