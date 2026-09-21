import { Injector, inject, runInInjectionContext } from '@angular/core';

/**
 * Runs Firebase calls inside Angular's injection context.
 *
 * AngularFire wraps the Firebase SDK so its callbacks re-enter the Angular
 * zone. That wrapping only happens when the call is made from an injection
 * context — a field initializer is fine, but the body of an `async` method is
 * not, because the `await` has already unwound the stack. Calling from outside
 * produces the "Firebase API called outside injection context" warning and,
 * more importantly, snapshot callbacks that never trigger change detection.
 *
 * Usage:
 *
 * ```ts
 * private readonly inContext = injectFirebaseContext();
 *
 * async load(id: string) {
 *   const snap = await this.inContext(() => getDoc(doc(this.firestore, 'x', id)));
 * }
 * ```
 *
 * Must itself be called from an injection context (a field initializer).
 */
export function injectFirebaseContext(): <T>(fn: () => T) => T {
  const injector = inject(Injector);
  return <T>(fn: () => T): T => runInInjectionContext(injector, fn);
}
