import type { AppEnvironment } from './environment.model';

/**
 * Development environment: everything Firebase runs against the local Emulator
 * Suite, so no real project or billing is needed to run and test the app.
 * `firebase` below is a demo config — the emulators accept any project id
 * prefixed with `demo-` without contacting Google.
 */
export const environment: AppEnvironment = {
  production: false,
  useEmulators: true,

  firebase: {
    apiKey: 'demo-api-key',
    authDomain: 'demo-e-faktura.firebaseapp.com',
    projectId: 'demo-e-faktura',
    storageBucket: 'demo-e-faktura.appspot.com',
    messagingSenderId: '000000000000',
    appId: '1:000000000000:web:0000000000000000000000',
  },

  emulators: {
    authUrl: 'http://127.0.0.1:9099',
    firestore: { host: '127.0.0.1', port: 8080 },
    functions: { host: '127.0.0.1', port: 5001 },
    storage: { host: '127.0.0.1', port: 9199 },
  },

  billing: {
    operatorName: 'ДОДИ ТЕК ДООЕЛ',
    operatorTaxNumber: '4038022519770',
    bankName: 'СТОПАНСКА БАНКА АД СКОПЈЕ',
    bankAccount: '200004007076491',
    contactEmail: 'fejzula.florent@gmail.com',
    contactPhone: '+389 70 302 376',
    annualPrice: '6.000 ден.',
    monthlyPrice: '600 ден.',
    priceNote: 'без ДДВ',
  },

  ujp: {
    environment: 'test',
    apiBaseUrl: 'https://efakturatest.ujp.gov.mk/einvoice_api/api/v1',
    sendUrl: 'https://efakturatest.ujp.gov.mk/JSONReceiver/api/v1/sales-invoices/send',
    euidViewerUrl: 'https://efakturatest.ujp.gov.mk/euid',
  },
};
