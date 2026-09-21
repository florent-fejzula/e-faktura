import { BreakpointObserver, Breakpoints } from '@angular/cdk/layout';
import { ChangeDetectionStrategy, Component, computed, effect, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatDividerModule } from '@angular/material/divider';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { map } from 'rxjs';
import { AuthService } from '../core/auth/auth.service';
import { AdminService } from '../core/data/admin.service';
import { CompanyService } from '../core/data/company.service';
import { daysRemaining, subscriptionState } from '../core/models/company.model';
import { RenewDialog, type RenewDialogData } from '../features/billing/renew.dialog';

interface NavItem {
  path: string;
  label: string;
  icon: string;
}

const NAV: readonly NavItem[] = [
  { path: '/fakturi', label: 'Фактури', icon: 'receipt_long' },
  { path: '/klienti', label: 'Клиенти', icon: 'groups' },
  { path: '/postavki', label: 'Поставки', icon: 'settings' },
];

/**
 * Application frame.
 *
 * Desktop gets a persistent left rail; phones get a bottom navigation bar,
 * because a hamburger menu costs a tap on every single navigation and this app
 * is used one-handed on site as often as at a desk.
 */
@Component({
  selector: 'app-shell',
  imports: [
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
    MatToolbarModule,
    MatIconModule,
    MatButtonModule,
    MatDialogModule,
    MatMenuModule,
    MatDividerModule,
    MatTooltipModule,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './shell.component.html',
  styleUrl: './shell.component.scss',
})
export class ShellComponent {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  protected readonly companies = inject(CompanyService);

  protected readonly nav = NAV;
  private readonly admin = inject(AdminService);

  /** Only the operator sees the subscriptions screen. */
  protected readonly isAdmin = computed(() => this.admin.isAdmin() === true);

  /**
   * Subscription banner. Shown from a week out so a renewal invoice has time
   * to be sent and paid by bank transfer, which is not instant.
   */
  protected readonly subscriptionState = computed(() =>
    subscriptionState(this.companies.activeCompany()?.subscription),
  );

  protected readonly subscriptionDaysLeft = computed(() =>
    daysRemaining(this.companies.activeCompany()?.subscription),
  );

  protected readonly showSubscriptionBanner = computed(() => {
    // 'none' is a company awaiting backfill, which still works — warning about
    // it would be a lie.
    const state = this.subscriptionState();
    return state === 'expiring' || state === 'expired';
  });

  private readonly dialog = inject(MatDialog);

  /** Opens the "how to pay" dialog — the other half of the expiry warning. */
  protected openRenew(): void {
    const company = this.companies.activeCompany();
    if (!company) return;
    const data: RenewDialogData = { company };
    this.dialog.open(RenewDialog, { data, maxWidth: '94vw', width: '480px' });
  }

  protected readonly subscriptionMessage = computed(() => {
    const left = this.subscriptionDaysLeft();
    if (left < 0) {
      return 'Претплатата истече — не можете да создавате нови фактури. Постојните остануваат достапни.';
    }
    if (left === 0) return 'Претплатата истекува денес.';
    return `Претплатата истекува за ${left} ${left === 1 ? 'ден' : 'дена'}.`;
  });

  protected readonly isHandset = toSignal(
    inject(BreakpointObserver)
      .observe([Breakpoints.Handset, Breakpoints.TabletPortrait])
      .pipe(map((result) => result.matches)),
    { initialValue: false },
  );

  protected readonly user = this.auth.user;

  protected readonly initials = computed(() => {
    const account = this.user();
    const source = account?.displayName || account?.email || '';
    const parts = source.split(/[\s@.]+/).filter(Boolean);
    return parts
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase() ?? '')
      .join('');
  });

  protected readonly otherCompanies = computed(() => {
    const activeId = this.companies.activeCompanyId();
    return this.companies.companies().filter((c) => c.id !== activeId);
  });

  protected switchCompany(companyId: string): void {
    this.companies.select(companyId);
  }

  /**
   * Leaves the app the moment the session ends, whoever ended it — this tab,
   * another tab, or a revoked token. Without it a signed-out user is left
   * sitting on an empty shell that looks broken rather than logged out.
   * `undefined` is "still restoring" and must not trigger it.
   */
  private readonly leaveWhenSignedOut = effect(() => {
    if (this.auth.user() === null) void this.router.navigate(['/najava']);
  });

  protected async signOut(): Promise<void> {
    await this.auth.signOut();
    await this.router.navigate(['/najava']);
  }
}
