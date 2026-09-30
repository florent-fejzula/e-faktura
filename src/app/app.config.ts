import { registerLocaleData } from '@angular/common';
import localeMk from '@angular/common/locales/mk';
import { provideHttpClient, withFetch } from '@angular/common/http';
import {
  ApplicationConfig,
  LOCALE_ID,
  isDevMode,
  provideBrowserGlobalErrorListeners,
  provideZoneChangeDetection,
} from '@angular/core';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { MAT_FORM_FIELD_DEFAULT_OPTIONS } from '@angular/material/form-field';
import { DateAdapter, MAT_DATE_LOCALE, provideNativeDateAdapter } from '@angular/material/core';
import { MAT_ICON_DEFAULT_OPTIONS } from '@angular/material/icon';
import { MAT_SNACK_BAR_DEFAULT_OPTIONS } from '@angular/material/snack-bar';
import { provideRouter, withComponentInputBinding, withInMemoryScrolling } from '@angular/router';
import { provideServiceWorker } from '@angular/service-worker';

import { routes } from './app.routes';
import { provideAppFirebase } from './core/firebase/firebase.providers';
import {
  UjpSigner,
  UjpTransport,
  UnavailableUjpSigner,
  UnavailableUjpTransport,
} from './core/ujp/ujp-signer';
import { MkDateAdapter } from './core/util/mk-date-adapter';
import { MK_DATE_FORMATS } from './core/util/mk-date-formats';
import { MAT_DATE_FORMATS } from '@angular/material/core';

registerLocaleData(localeMk);

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(
      routes,
      withComponentInputBinding(),
      withInMemoryScrolling({ scrollPositionRestoration: 'enabled' }),
    ),
    provideAnimationsAsync(),
    provideHttpClient(withFetch()),
    provideAppFirebase(),

    // Makes the app installable and lets it open without a connection. Off in
    // development, where a cached shell would hide every edit behind a reload.
    // Registration waits for the app to settle so the SW's prefetch of every
    // chunk does not compete with first paint — but only for 10s, because
    // Firestore's open listeners can keep the app from ever reporting stable.
    provideServiceWorker('ngsw-worker.js', {
      enabled: !isDevMode(),
      registrationStrategy: 'registerWhenStable:10000',
    }),

    { provide: LOCALE_ID, useValue: 'mk' },
    { provide: MAT_DATE_LOCALE, useValue: 'mk-MK' },
    { provide: MAT_DATE_FORMATS, useValue: MK_DATE_FORMATS },
    // Registers the platform date adapter, then overrides it with one that
    // spells the Macedonian month and weekday names out — browsers without the
    // `mk` ICU data otherwise render the calendar in English.
    provideNativeDateAdapter(),
    { provide: DateAdapter, useClass: MkDateAdapter },

    // Outlined fields read better in dense forms, and dynamic subscript sizing
    // stops every field reserving a line of hint space it never uses.
    {
      provide: MAT_FORM_FIELD_DEFAULT_OPTIONS,
      useValue: { appearance: 'outline', subscriptSizing: 'dynamic' },
    },
    // index.html loads "Material Symbols Outlined"; without naming that font
    // set every <mat-icon> renders its ligature as literal text ("receipt_long").
    {
      provide: MAT_ICON_DEFAULT_OPTIONS,
      useValue: { fontSet: 'material-symbols-outlined' },
    },
    {
      provide: MAT_SNACK_BAR_DEFAULT_OPTIONS,
      useValue: { duration: 4000, horizontalPosition: 'center', verticalPosition: 'bottom' },
    },

    // Signing and transport are provided as "not configured" until a
    // certificate bridge is installed. See core/ujp/ujp-signer.ts.
    { provide: UjpSigner, useClass: UnavailableUjpSigner },
    { provide: UjpTransport, useClass: UnavailableUjpTransport },
  ],
};
