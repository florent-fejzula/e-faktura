import type { AppEnvironment } from './environment.model';

/**
 * Production environment. Replace `firebase` with the config from your real
 * Firebase project (Project settings -> Your apps -> SDK setup and config),
 * and confirm the UJP production hosts before going live — at the time of
 * writing UJP had only published the *test* hosts.
 */
export const environment: AppEnvironment = {
  production: true,
  useEmulators: false,

  firebase: {
    apiKey: 'AIzaSyCRHcX6wts_QRlczywyD_jWgRMj0GEthVM',
    authDomain: 'e-faktura-1e6d0.firebaseapp.com',
    projectId: 'e-faktura-1e6d0',
    storageBucket: 'e-faktura-1e6d0.firebasestorage.app',
    messagingSenderId: '215825139121',
    appId: '1:215825139121:web:279aa498150e32a9972990',
  },

  emulators: null,

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
    environment: 'production',
    apiBaseUrl: 'https://efaktura.ujp.gov.mk/einvoice_api/api/v1',
    sendUrl: 'https://efaktura.ujp.gov.mk/JSONReceiver/api/v1/sales-invoices/send',
    euidViewerUrl: 'https://efaktura.ujp.gov.mk/euid',
  },
};
