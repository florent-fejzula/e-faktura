import { Routes } from '@angular/router';
import {
  adminGuard,
  authGuard,
  companyGuard,
  guestGuard,
  moduleGuard,
  onboardingGuard,
  subscriptionGuard,
} from './core/auth/auth.guards';

/**
 * Routes use Macedonian paths so shared links read naturally to the people
 * using the app. Every feature is lazily loaded — the login screen should not
 * pull in the invoice editor.
 */
export const routes: Routes = [
  {
    path: 'najava',
    canActivate: [guestGuard],
    title: 'Најава — е-Фактура',
    loadComponent: () => import('./features/auth/login.page').then((m) => m.LoginPage),
  },
  {
    path: 'registracija',
    canActivate: [authGuard, onboardingGuard],
    title: 'Внесете ја вашата фирма — е-Фактура',
    loadComponent: () =>
      import('./features/onboarding/onboarding.page').then((m) => m.OnboardingPage),
  },
  {
    path: '',
    canActivate: [authGuard, companyGuard],
    loadComponent: () => import('./layout/shell.component').then((m) => m.ShellComponent),
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'fakturi' },
      {
        path: 'fakturi',
        title: 'Фактури — е-Фактура',
        loadComponent: () =>
          import('./features/invoices/invoice-list.page').then((m) => m.InvoiceListPage),
      },
      {
        path: 'fakturi/nova',
        canActivate: [subscriptionGuard],
        title: 'Нова фактура — е-Фактура',
        loadComponent: () =>
          import('./features/invoices/invoice-editor.page').then((m) => m.InvoiceEditorPage),
      },
      {
        path: 'fakturi/:id',
        title: 'Фактура — е-Фактура',
        loadComponent: () =>
          import('./features/invoices/invoice-editor.page').then((m) => m.InvoiceEditorPage),
      },
      {
        path: 'klienti',
        title: 'Клиенти — е-Фактура',
        loadComponent: () =>
          import('./features/clients/client-list.page').then((m) => m.ClientListPage),
      },
      {
        // Ценовник module — only for companies the operator switched it on for.
        path: 'cenovnik',
        canActivate: [moduleGuard('catalog')],
        title: 'Ценовник — е-Фактура',
        loadComponent: () => import('./features/catalog/catalog.page').then((m) => m.CatalogPage),
      },
      {
        path: 'admin',
        canActivate: [adminGuard],
        title: 'Претплати — е-Фактура',
        loadComponent: () => import('./features/admin/admin.page').then((m) => m.AdminPage),
      },
      {
        path: 'postavki',
        title: 'Поставки — е-Фактура',
        loadComponent: () =>
          import('./features/settings/settings.page').then((m) => m.SettingsPage),
      },
    ],
  },
  { path: '**', redirectTo: '' },
];
