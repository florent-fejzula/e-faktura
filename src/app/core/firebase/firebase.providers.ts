import { EnvironmentProviders, isDevMode, makeEnvironmentProviders } from '@angular/core';
import { initializeApp, provideFirebaseApp } from '@angular/fire/app';
import { connectAuthEmulator, getAuth, provideAuth } from '@angular/fire/auth';
import {
  connectFirestoreEmulator,
  enableIndexedDbPersistence,
  getFirestore,
  provideFirestore,
} from '@angular/fire/firestore';
import { connectFunctionsEmulator, getFunctions, provideFunctions } from '@angular/fire/functions';
import { connectStorageEmulator, getStorage, provideStorage } from '@angular/fire/storage';
import { environment } from '../../../environments/environment';

/**
 * Must match `setGlobalOptions({ region })` in functions/src/index.ts. A
 * mismatch is not a compile error — it is a 404 at runtime on the first call.
 */
export const FUNCTIONS_REGION = 'europe-west1';

/**
 * Emulator connections are process-wide and throw if made twice, which the dev
 * server's hot reload would otherwise trigger on every save.
 */
const connected = new Set<string>();

function once(key: string, connect: () => void): void {
  if (connected.has(key)) return;
  connected.add(key);
  connect();
}

export function provideAppFirebase(): EnvironmentProviders {
  const { firebase, emulators, useEmulators } = environment;

  return makeEnvironmentProviders([
    provideFirebaseApp(() => initializeApp(firebase)),

    provideAuth(() => {
      const auth = getAuth();
      if (useEmulators && emulators) {
        once('auth', () =>
          connectAuthEmulator(auth, emulators.authUrl, { disableWarnings: true }),
        );
      }
      return auth;
    }),

    provideFirestore(() => {
      const firestore = getFirestore();
      if (useEmulators && emulators) {
        once('firestore', () =>
          connectFirestoreEmulator(firestore, emulators.firestore.host, emulators.firestore.port),
        );
      } else {
        // Offline cache: invoices stay readable and drafts keep saving when the
        // connection drops. It fails when a second tab already holds the lock,
        // which is not worth surfacing to the user.
        once('persistence', () => {
          enableIndexedDbPersistence(firestore).catch((error: { code?: string }) => {
            if (error?.code !== 'failed-precondition' && error?.code !== 'unimplemented') {
              if (isDevMode()) console.warn('Firestore persistence unavailable', error);
            }
          });
        });
      }
      return firestore;
    }),

    provideFunctions(() => {
      const functions = getFunctions(undefined, FUNCTIONS_REGION);
      if (useEmulators && emulators) {
        once('functions', () =>
          connectFunctionsEmulator(functions, emulators.functions.host, emulators.functions.port),
        );
      }
      return functions;
    }),

    provideStorage(() => {
      const storage = getStorage();
      if (useEmulators && emulators) {
        once('storage', () =>
          connectStorageEmulator(storage, emulators.storage.host, emulators.storage.port),
        );
      }
      return storage;
    }),
  ]);
}
