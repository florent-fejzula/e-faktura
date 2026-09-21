import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatMenuModule } from '@angular/material/menu';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { AdminService } from '../../core/data/admin.service';
import {
  SUBSCRIPTION_LABELS,
  daysRemaining,
  subscriptionState,
  type Company,
  type SubscriptionState,
} from '../../core/models/company.model';
import { formatDate, todayIso } from '../../core/util/dates';
import { matchesSearch } from '../../core/util/id';
import { FORMAT_PIPES } from '../../shared/format.pipes';
import { ConfirmDialog, type ConfirmData } from '../../shared/confirm.dialog';
import { NewCustomerDialog } from './new-customer.dialog';

type SortKey = 'expiry' | 'name' | 'invoices' | 'joined';

/**
 * The operator's screen: who is on the app, who is paying, who is about to
 * lapse.
 *
 * Sorted by expiry ascending by default, because the recurring job this screen
 * exists to support is "who do I invoice this week" — not "who signed up".
 */
@Component({
  selector: 'app-admin-page',
  imports: [
    FormsModule,
    MatButtonModule,
    MatDialogModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatMenuModule,
    MatTooltipModule,
    ...FORMAT_PIPES,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './admin.page.html',
  styleUrl: './admin.page.scss',
})
export class AdminPage {
  private readonly admin = inject(AdminService);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);

  protected readonly labels = SUBSCRIPTION_LABELS;
  protected readonly search = signal('');
  protected readonly sortKey = signal<SortKey>('expiry');
  protected readonly busyId = signal<string | null>(null);

  protected readonly loading = computed(() => this.admin.companies() === undefined);

  private readonly all = computed(() => this.admin.companies() ?? []);

  protected readonly rows = computed(() => {
    const term = this.search().trim();
    const filtered = term
      ? this.all().filter((c) =>
          matchesSearch(`${c.name} ${c.taxNumber} ${c.email}`, term),
        )
      : this.all();

    const key = this.sortKey();
    return [...filtered].sort((a, b) => {
      switch (key) {
        case 'name':
          return a.name.localeCompare(b.name, 'mk');
        case 'invoices':
          return (b.stats?.issuedCount ?? 0) - (a.stats?.issuedCount ?? 0);
        case 'joined':
          return (b.createdAt ?? 0) - (a.createdAt ?? 0);
        case 'expiry':
        default:
          // Companies with no subscription record are legacy, not urgent, so
          // they sort after everything with a real date rather than crowding
          // the top of the list this screen exists to work through.
          return this.expiryRank(a) - this.expiryRank(b);
      }
    });
  });

  /** Headline numbers, computed over everything rather than the filtered view. */
  protected readonly summary = computed(() => {
    const list = this.all();
    const by = (state: SubscriptionState) =>
      list.filter((c) => subscriptionState(c.subscription) === state).length;

    return {
      total: list.length,
      paying: list.filter((c) => c.subscription?.plan === 'paid' && this.remaining(c) >= 0).length,
      trial: by('trial'),
      expiring: by('expiring'),
      expired: by('expired'),
    };
  });

  /** Legacy rows (no date at all) sort last, not first. */
  private expiryRank(company: Company): number {
    return company.subscription?.paidUntil
      ? this.remaining(company)
      : Number.MAX_SAFE_INTEGER;
  }

  protected remaining(company: Company): number {
    return daysRemaining(company.subscription);
  }

  protected state(company: Company): SubscriptionState {
    return subscriptionState(company.subscription);
  }

  /** "за 12 дена" / "пред 3 дена" — the number people actually read. */
  protected relativeExpiry(company: Company): string {
    const left = this.remaining(company);
    if (!company.subscription?.paidUntil) return 'нема';
    if (left < 0) return `пред ${Math.abs(left)} ${plural(Math.abs(left))}`;
    if (left === 0) return 'денес';
    return `за ${left} ${plural(left)}`;
  }

  protected setSort(key: SortKey): void {
    this.sortKey.set(key);
  }

  /**
   * Creates a customer: account, company and subscription in one call.
   *
   * Nothing is refreshed afterwards — the company list is a live Firestore
   * snapshot, so the new row appears on its own. The dialog holds the password
   * until the operator dismisses it, which is why this only reports the name.
   */
  protected async addCustomer(): Promise<void> {
    const created = await this.dialog
      .open(NewCustomerDialog, {
        // Sized here rather than from the form inside: this dialog is long
        // enough to scroll, and a scrolling panel that sizes itself to its
        // content clips the right-hand column by the width of the scrollbar.
        width: 'min(660px, 94vw)',
        // Material caps the dialog surface at 560px; without lifting the cap
        // the width above is ignored and the two columns get 512px between them.
        maxWidth: 'min(660px, 94vw)',
        maxHeight: '90vh',
        autoFocus: 'first-tabbable',
        restoreFocus: true,
      })
      .afterClosed()
      .toPromise();

    if (!created) return;
    this.snackBar.open(`${created.companyName} — сметката е создадена.`, 'Во ред', {
      duration: 6000,
    });
  }

  protected async extend(company: Company, days: number): Promise<void> {
    const label = days === 365 ? 'една година' : `${days} дена`;
    const data: ConfirmData = {
      title: 'Продолжување претплата',
      message:
        `Претплатата на „${company.name}“ ќе се продолжи за ${label}. ` +
        (this.remaining(company) < 0
          ? 'Претплатата е истечена, па новиот период почнува од денес.'
          : 'Новиот период се додава на постојниот, така што ништо не се губи.'),
      confirmLabel: 'Продолжи',
    };
    const confirmed = await this.dialog.open(ConfirmDialog, { data }).afterClosed().toPromise();
    if (!confirmed) return;

    this.busyId.set(company.id);
    try {
      const until = await this.admin.extend(company, days);
      this.snackBar.open(`${company.name} — платено до ${formatDate(until)}.`, 'Во ред', {
        duration: 5000,
      });
    } catch (error) {
      this.snackBar.open(`Не успеа: ${(error as Error)?.message ?? error}`, 'Затвори');
    } finally {
      this.busyId.set(null);
    }
  }

  /** Ends access at the end of today — used when someone cancels. */
  protected async stop(company: Company): Promise<void> {
    const data: ConfirmData = {
      title: 'Прекин на претплата',
      message:
        `„${company.name}“ нема да може да создава нови фактури по денес. ` +
        'Постојните фактури остануваат видливи, за печатење и извоз.',
      confirmLabel: 'Прекини',
      destructive: true,
    };
    const confirmed = await this.dialog.open(ConfirmDialog, { data }).afterClosed().toPromise();
    if (!confirmed) return;

    this.busyId.set(company.id);
    try {
      await this.admin.setSubscription(company.id, {
        paidUntil: todayIso(),
        plan: company.subscription?.plan ?? 'paid',
        note: company.subscription?.note ?? '',
      });
      this.snackBar.open(`Претплатата на ${company.name} е прекината.`, 'Во ред');
    } finally {
      this.busyId.set(null);
    }
  }

  protected async setNote(company: Company, note: string): Promise<void> {
    if (note === (company.subscription?.note ?? '')) return;
    await this.admin.setSubscription(company.id, {
      paidUntil: company.subscription?.paidUntil ?? null,
      plan: company.subscription?.plan ?? 'trial',
      note,
    });
  }
}

function plural(days: number): string {
  return days === 1 ? 'ден' : 'дена';
}
