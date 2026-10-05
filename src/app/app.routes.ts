import { ActivatedRouteSnapshot, RouterStateSnapshot, Routes } from '@angular/router';
import { NEW_INVOICE_SEGMENT } from './core/models/invoice.model';
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
        // New and existing invoices share one route on purpose. A new invoice
        // trades `/fakturi/nova` for its own id the moment it is first edited,
        // so Back can return to it after a look at another screen. On a
        // separate route that change of address would tear the editor down and
        // rebuild it under the user's cursor; on one route it is kept.
        path: 'fakturi/:id',
        canActivate: [
          (route: ActivatedRouteSnapshot, state: RouterStateSnapshot) =>
            isNewInvoice(route) ? subscriptionGuard(route, state) : true,
        ],
        title: (route: ActivatedRouteSnapshot) =>
          isNewInvoice(route) ? 'Нова фактура — е-Фактура' : 'Фактура — е-Фактура',
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

/** Only starting an invoice is behind the paywall; finishing a draft never is. */
function isNewInvoice(route: ActivatedRouteSnapshot): boolean {
  return route.paramMap.get('id') === NEW_INVOICE_SEGMENT;
}
