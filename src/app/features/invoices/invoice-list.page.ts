import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatDialog } from '@angular/material/dialog';
import { MatDividerModule } from '@angular/material/divider';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatMenuModule } from '@angular/material/menu';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Router, RouterLink } from '@angular/router';
import { combineLatest, of, switchMap } from 'rxjs';
import { ClientService } from '../../core/data/client.service';
import { CompanyService } from '../../core/data/company.service';
import { InvoiceService } from '../../core/data/invoice.service';
import {
  UJP_STATUS_LABELS,
  isDeletable,
  isEditable,
  type Invoice,
  type PaymentStatus,
  type UjpStatusCode,
} from '../../core/models/invoice.model';
import {
  fromIsoDate,
  monthRange,
  quarterRange,
  toIsoDate,
  todayIso,
  yearOf,
  yearRange,
  type IsoDate,
} from '../../core/util/dates';
import { matchesSearch } from '../../core/util/id';
import { round2 } from '../../core/util/money';
import { ConfirmDialog, type ConfirmData } from '../../shared/confirm.dialog';
import { ShareDialog, type ShareDialogData } from './share.dialog';
import { FORMAT_PIPES } from '../../shared/format.pipes';
import { StatusChipComponent } from '../../shared/status-chip.component';

export type SortKey =
  | 'number'
  | 'issueDate'
  | 'dueDate'
  | 'client'
  | 'net'
  | 'vat'
  | 'total'
  | 'status'
  | 'payment';

type SortDirection = 'asc' | 'desc';

interface QuickRange {
  label: string;
  from: IsoDate;
  to: IsoDate;
}

/**
 * Invoice list.
 *
 * The date window is the only server-side filter; everything else runs in
 * memory over the loaded set. A company issues a few hundred to a few thousand
 * invoices a year, which is small enough to filter and sort locally — and doing
 * so means every filter responds on the same frame instead of after a
 * round-trip, which is the whole point of the screen.
 */
@Component({
  selector: 'app-invoice-list-page',
  imports: [
    FormsModule,
    RouterLink,
    MatButtonModule,
    MatIconModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatMenuModule,
    MatDatepickerModule,
    MatCheckboxModule,
    MatTooltipModule,
    MatDividerModule,
    MatProgressBarModule,
    StatusChipComponent,
    ...FORMAT_PIPES,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './invoice-list.page.html',
  styleUrl: './invoice-list.page.scss',
})
export class InvoiceListPage {
  private readonly invoiceService = inject(InvoiceService);
  private readonly clientService = inject(ClientService);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);
  private readonly router = inject(Router);
  protected readonly companies = inject(CompanyService);

  protected readonly statusLabels = UJP_STATUS_LABELS;
  protected readonly allStatuses = Object.keys(UJP_STATUS_LABELS) as UjpStatusCode[];

  // --- server-side window --------------------------------------------------

  private readonly currentYear = yearOf(todayIso());

  protected readonly range = signal<{ from: IsoDate; to: IsoDate }>(yearRange(this.currentYear));

  protected readonly quickRanges = computed<QuickRange[]>(() => {
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth() + 1;
    const q = Math.floor((m - 1) / 3) + 1;
    return [
      { label: 'Овој месец', ...monthRange(y, m) },
      { label: 'Овој квартал', ...quarterRange(y, q) },
      { label: String(y), ...yearRange(y) },
      { label: String(y - 1), ...yearRange(y - 1) },
    ];
  });

  private readonly loaded = toSignal(
    combineLatest([
      toObservable(this.companies.activeCompanyId),
      toObservable(this.range),
    ]).pipe(
      switchMap(([companyId, range]) =>
        companyId ? this.invoiceService.list(companyId, range.from, range.to) : of([]),
      ),
    ),
    { initialValue: undefined },
  );

  protected readonly loading = computed(() => this.loaded() === undefined);
  protected readonly invoices = computed<Invoice[]>(() => this.loaded() ?? []);

  protected readonly clients = toSignal(
    toObservable(this.companies.activeCompanyId).pipe(
      switchMap((id) => this.clientService.list(id)),
    ),
    { initialValue: [] },
  );

  // --- in-memory filters ---------------------------------------------------

  protected readonly search = signal('');
  protected readonly statusFilter = signal<UjpStatusCode[]>([]);
  protected readonly paymentFilter = signal<PaymentStatus[]>([]);
  protected readonly clientFilter = signal<string[]>([]);
  protected readonly minAmount = signal<number | null>(null);
  protected readonly maxAmount = signal<number | null>(null);
  protected readonly showFilters = signal(false);

  protected readonly activeFilterCount = computed(
    () =>
      (this.search().trim() ? 1 : 0) +
      (this.statusFilter().length ? 1 : 0) +
      (this.paymentFilter().length ? 1 : 0) +
      (this.clientFilter().length ? 1 : 0) +
      (this.minAmount() !== null ? 1 : 0) +
      (this.maxAmount() !== null ? 1 : 0),
  );

  protected readonly filtered = computed<Invoice[]>(() => {
    const query = this.search().trim();
    const statuses = this.statusFilter();
    const payments = this.paymentFilter();
    const clientIds = this.clientFilter();
    const min = this.minAmount();
    const max = this.maxAmount();

    return this.invoices().filter((invoice) => {
      if (statuses.length && !statuses.includes(invoice.status)) return false;
      if (payments.length && !payments.includes(invoice.paymentStatus)) return false;
      if (clientIds.length && !clientIds.includes(invoice.client.id ?? '')) return false;
      if (min !== null && invoice.totals.finalAmount < min) return false;
      if (max !== null && invoice.totals.finalAmount > max) return false;
      if (query) {
        const haystack = [
          invoice.number,
          invoice.client.name,
          invoice.client.taxNumber,
          invoice.notes,
          invoice.ujp?.euid ?? '',
        ].join(' ');
        if (!matchesSearch(haystack, query)) return false;
      }
      return true;
    });
  });

  // --- sorting -------------------------------------------------------------

  protected readonly sortKey = signal<SortKey>('issueDate');
  protected readonly sortDir = signal<SortDirection>('desc');

  protected toggleSort(key: SortKey): void {
    if (this.sortKey() === key) {
      this.sortDir.update((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      this.sortKey.set(key);
      // Dates and amounts are most useful highest-first; text ascending.
      this.sortDir.set(key === 'number' || key === 'client' ? 'asc' : 'desc');
    }
  }

  protected readonly rows = computed<Invoice[]>(() => {
    const key = this.sortKey();
    const factor = this.sortDir() === 'asc' ? 1 : -1;

    return [...this.filtered()].sort((a, b) => factor * compareBy(key, a, b));
  });

  // --- summary -------------------------------------------------------------

  protected readonly summary = computed(() => {
    const rows = this.filtered();
    const total = round2(rows.reduce((s, i) => s + i.totals.finalAmount, 0));
    const vat = round2(rows.reduce((s, i) => s + i.totals.vatAmount, 0));
    // Receivables are owed the moment an invoice is *issued*, which is not the
    // same as `status !== '00'`: УЈП's status stays "00" until they actually
    // have a copy, so testing it hid every issued-but-unsubmitted invoice from
    // the outstanding figure. `isEditable` is the real draft test.
    const receivable = rows.filter((i) => !isEditable(i) && i.paymentStatus !== 'paid');
    const outstanding = round2(
      receivable.reduce((s, i) => s + (i.totals.finalAmount - i.paidAmount), 0),
    );
    const overdue = receivable.filter((i) => i.dueDate < todayIso()).length;

    return { count: rows.length, total, vat, outstanding, overdue };
  });

  protected readonly currency = computed(
    () => this.companies.activeCompany()?.defaults.currency ?? 'MKD',
  );

  // --- actions -------------------------------------------------------------

  protected applyQuickRange(range: QuickRange): void {
    this.range.set({ from: range.from, to: range.to });
  }

  protected setRangeStart(date: Date | null): void {
    if (date) this.range.update((r) => ({ ...r, from: toIsoDate(date) }));
  }

  protected setRangeEnd(date: Date | null): void {
    if (date) this.range.update((r) => ({ ...r, to: toIsoDate(date) }));
  }

  protected rangeStartDate = computed(() => fromIsoDate(this.range().from));
  protected rangeEndDate = computed(() => fromIsoDate(this.range().to));

  protected clearFilters(): void {
    this.search.set('');
    this.statusFilter.set([]);
    this.paymentFilter.set([]);
    this.clientFilter.set([]);
    this.minAmount.set(null);
    this.maxAmount.set(null);
  }

  protected isOverdue(invoice: Invoice): boolean {
    return (
      invoice.status !== '00' &&
      invoice.paymentStatus !== 'paid' &&
      invoice.dueDate < todayIso()
    );
  }

  protected async duplicate(invoice: Invoice): Promise<void> {
    const company = this.companies.activeCompany();
    if (!company) return;
    const draft = this.invoiceService.duplicate(invoice, company);
    // The editor picks the draft up from history state — nothing is written
    // until the user actually saves it.
    await this.router.navigate(['/fakturi/nova'], { state: { draft } });
  }

  protected async togglePaid(invoice: Invoice): Promise<void> {
    const paid = invoice.paymentStatus === 'paid';
    await this.invoiceService.setPayment(
      invoice,
      paid ? 0 : invoice.totals.finalAmount,
      paid ? null : Date.now(),
    );
    this.snackBar.open(paid ? 'Означена како неплатена.' : 'Означена како платена.', 'Во ред');
  }

  protected share(invoice: Invoice): void {
    const data: ShareDialogData = { invoice };
    this.dialog.open(ShareDialog, { data, maxWidth: '96vw', width: '560px' });
  }

  /** Template helpers — an invoice УЈП has not seen can still be removed. */
  protected canDelete(invoice: Invoice): boolean {
    return isDeletable(invoice);
  }

  protected isDraft(invoice: Invoice): boolean {
    return isEditable(invoice);
  }

  protected async remove(invoice: Invoice): Promise<void> {
    const issued = !isEditable(invoice);
    // Only the newest number can be handed back to the counter; deleting any
    // earlier one leaves a gap in the invoice book, so say so plainly rather
    // than let someone discover it at an audit.
    const reusable =
      issued &&
      invoice.seq !== null &&
      this.companies.activeCompany()?.numbering.nextSeq === invoice.seq + 1;

    const data: ConfirmData = {
      title: issued ? 'Бришење фактура' : 'Бришење нацрт',
      message: issued
        ? `Фактурата „${invoice.number}“ сè уште не е испратена до УЈП, па може да се избрише. ` +
          (reusable
            ? 'Бројот ќе се врати и ќе го добие следната фактура.'
            : 'Внимание: бројот ќе остане празно место во низата, бидејќи има подоцнежни фактури.') +
          ' Ова не може да се врати.'
        : `Дали сте сигурни дека сакате да го избришете нацртот${
            invoice.number ? ` „${invoice.number}“` : ''
          }? Ова не може да се врати.`,
      confirmLabel: 'Избриши',
      destructive: true,
    };
    const confirmed = await this.dialog.open(ConfirmDialog, { data }).afterClosed().toPromise();
    if (!confirmed) return;

    await this.invoiceService.remove(invoice);
    this.snackBar.open(
      issued && reusable
        ? `Фактурата е избришана. Бројот ${invoice.number} е слободен.`
        : issued
          ? 'Фактурата е избришана.'
          : 'Нацртот е избришан.',
      'Во ред',
    );
  }

  /** Downloads the current view as CSV — what accountants ask for first. */
  protected exportCsv(): void {
    const rows = this.rows();
    const header = [
      'Број',
      'Датум',
      'Датум на промет',
      'Рок',
      'Клиент',
      'ЕДБ',
      'Основица',
      'ДДВ',
      'Вкупно',
      'Платено',
      'Статус',
      'EUID',
    ];

    const csv = [
      header.join(';'),
      ...rows.map((i) =>
        [
          i.number,
          i.issueDate,
          i.turnoverDate,
          i.dueDate,
          i.client.name,
          i.client.taxNumber,
          i.totals.netAmountDisc,
          i.totals.vatAmount,
          i.totals.finalAmount,
          i.paidAmount,
          UJP_STATUS_LABELS[i.status] ?? i.status,
          i.ujp?.euid ?? '',
        ]
          .map(csvCell)
          .join(';'),
      ),
    ].join('\r\n');

    // The BOM makes Excel open UTF-8 Cyrillic correctly instead of as mojibake.
    const blob = new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `fakturi-${this.range().from}-${this.range().to}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }
}

function csvCell(value: unknown): string {
  const text = String(value ?? '');
  return /[";\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function compareBy(key: SortKey, a: Invoice, b: Invoice): number {
  switch (key) {
    case 'number':
      // Compare by sequence when both are numbered so "10/2026" sorts after
      // "9/2026" rather than before it as a string would.
      if (a.seq !== null && b.seq !== null && a.periodKey === b.periodKey) {
        return a.seq - b.seq;
      }
      return a.number.localeCompare(b.number, 'mk', { numeric: true });
    case 'issueDate':
      return a.issueDate.localeCompare(b.issueDate) || a.number.localeCompare(b.number);
    case 'dueDate':
      return a.dueDate.localeCompare(b.dueDate);
    case 'client':
      return a.client.name.localeCompare(b.client.name, 'mk');
    case 'net':
      return a.totals.netAmountDisc - b.totals.netAmountDisc;
    case 'vat':
      return a.totals.vatAmount - b.totals.vatAmount;
    case 'total':
      return a.totals.finalAmount - b.totals.finalAmount;
    case 'status':
      return a.status.localeCompare(b.status);
    case 'payment':
      return a.paymentStatus.localeCompare(b.paymentStatus);
  }
}
