import { inject } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { Router, type CanActivateFn } from '@angular/router';
import { filter, map, of, take } from 'rxjs';
import { AdminService } from '../data/admin.service';
import { CompanyService } from '../data/company.service';
import type { ModuleId } from '../modules/modules';
import { AuthService } from './auth.service';

/**
 * Blocks a route until Firebase has restored the session.
 *
 * `auth.user()` is `undefined` for the first few hundred milliseconds after a
 * reload; treating that as "signed out" would bounce every returning user to
 * the login screen and lose their deep link.
 */
export const authGuard: CanActivateFn = (_route, state) => {
  const auth = inject(AuthService);
  const router = inject(Router);

  return toObservable(auth.user).pipe(
    filter((user) => user !== undefined),
    take(1),
    map((user) =>
      user
        ? true
        : router.createUrlTree(['/najava'], { queryParams: { redirectTo: state.url } }),
    ),
  );
};

/** Sends a user with no company through onboarding before anything else. */
export const companyGuard: CanActivateFn = () => {
  const companies = inject(CompanyService);
  const router = inject(Router);

  return toObservable(companies.isLoading).pipe(
    filter((loading) => !loading),
    take(1),
    map(() => (companies.needsOnboarding() ? router.createUrlTree(['/registracija']) : true)),
  );
};

/** Keeps an already-signed-in user off the login screen. */
export const guestGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);

  return toObservable(auth.user).pipe(
    filter((user) => user !== undefined),
    take(1),
    map((user) => (user ? router.createUrlTree(['/fakturi']) : true)),
  );
};

/**
 * Stops a user who already has a company from *accidentally* re-running
 * onboarding — a stale bookmark, a back button after setup.
 *
 * `?nova=1` is the deliberate path: an accountant or an owner of two entities
 * adding another company from the switcher. The data model always supported
 * several companies per user; this is the door.
 */
export const onboardingGuard: CanActivateFn = (route) => {
  const companies = inject(CompanyService);
  const router = inject(Router);

  if (route.queryParamMap.get('nova') === '1') return of(true);

  return toObservable(companies.isLoading).pipe(
    filter((loading) => !loading),
    take(1),
    map(() => (companies.needsOnboarding() ? true : router.createUrlTree(['/fakturi']))),
  );
};

/**
 * Restricts the operator screen. `isAdmin` is `undefined` until the /admins
 * lookup resolves, so this waits rather than bouncing a legitimate admin on a
 * cold reload.
 */
export const adminGuard: CanActivateFn = () => {
  const admin = inject(AdminService);
  const router = inject(Router);

  return toObservable(admin.isAdmin).pipe(
    filter((value) => value !== undefined),
    take(1),
    map((value) => (value ? true : router.createUrlTree(['/fakturi']))),
  );
};

/**
 * Blocks the *new invoice* screen when the subscription has lapsed.
 *
 * Only creation is gated. Opening, editing, printing and exporting existing
 * invoices stay available on purpose — the records belong to the customer, and
 * locking them out of their own accounting to collect a debt is not acceptable.
 */
export const subscriptionGuard: CanActivateFn = () => {
  const companies = inject(CompanyService);
  const router = inject(Router);

  return toObservable(companies.isLoading).pipe(
    filter((loading) => !loading),
    take(1),
    map(() =>
      companies.canIssue()
        ? true
        : router.createUrlTree(['/fakturi'], { queryParams: { pretplata: 'istece' } }),
    ),
  );
};

/**
 * Keeps a module's screens behind its switch. A bookmark to the price list
 * after the operator turned it off lands on the invoice list instead of on an
 * empty page whose saves the rules would refuse.
 */
export function moduleGuard(id: ModuleId): CanActivateFn {
  return () => {
    const companies = inject(CompanyService);
    const router = inject(Router);

    return toObservable(companies.isLoading).pipe(
      filter((loading) => !loading),
      take(1),
      map(() => (companies.hasModule(id) ? true : router.createUrlTree(['/fakturi']))),
    );
  };
}
