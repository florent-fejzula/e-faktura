import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
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
import { Title } from '@angular/platform-browser';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { map, of, switchMap } from 'rxjs';
import { ClientService } from '../../core/data/client.service';
import { CodebookService } from '../../core/data/codebook.service';
import { CompanyService } from '../../core/data/company.service';
import { InvoiceService, createItem } from '../../core/data/invoice.service';
import type { Client } from '../../core/models/client.model';
import { snapshotClient } from '../../core/models/client.model';
import type { Invoice, InvoiceItem, PriceMode } from '../../core/models/invoice.model';
import { isDeletable, isEditable } from '../../core/models/invoice.model';
import { computeInvoice } from '../../core/ujp/totals';
import { validateInvoice } from '../../core/ujp/ujp-validator';
import { amountInWordsMk } from '../../core/util/amount-in-words';
import { addDays, fromIsoDate, toIsoDate } from '../../core/util/dates';
import { matchesSearch, newId } from '../../core/util/id';
import { pdfFileName } from '../../core/util/share';
import { toNumber } from '../../core/util/money';
import { ClientDialog, type ClientDialogData } from '../clients/client.dialog';
import { ConfirmDialog, type ConfirmData } from '../../shared/confirm.dialog';
import { ShareDialog, type ShareDialogData } from './share.dialog';
import { FORMAT_PIPES } from '../../shared/format.pipes';
import { StatusChipComponent } from '../../shared/status-chip.component';
import { InvoicePrintComponent } from './invoice-print.component';
import { UjpPreviewDialog, type UjpPreviewData } from './ujp-preview.dialog';

/**
 * Invoice editor.
 *
 * The invoice is held as a single signal and every derived figure — line
 * totals, the VAT recap, the amount in words, the validation list — is a
 * `computed` over it. Nothing is stored twice, so the totals on screen are by
 * construction the totals that get saved and the totals that get signed.
 */
@Component({
  selector: 'app-invoice-editor-page',
  imports: [
    FormsModule,
    RouterLink,
    MatButtonModule,
    MatIconModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatDatepickerModule,
    MatAutocompleteModule,
    MatMenuModule,
    MatTooltipModule,
    MatDividerModule,
    MatCheckboxModule,
    MatProgressBarModule,
    StatusChipComponent,
    InvoicePrintComponent,
    ...FORMAT_PIPES,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './invoice-editor.page.html',
  styleUrl: './invoice-editor.page.scss',
  // Window events rather than the Печати button, so Ctrl+P names the file too.
  host: {
    '(window:beforeprint)': 'titleForPrint()',
    '(window:afterprint)': 'restoreTitle()',
  },
})
export class InvoiceEditorPage {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly invoiceService = inject(InvoiceService);
  private readonly clientService = inject(ClientService);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);
  private readonly title = inject(Title);
  protected readonly companies = inject(CompanyService);
  protected readonly codebookService = inject(CodebookService);

  protected readonly invoice = signal<Invoice | null>(null);
  protected readonly loading = signal(true);
  protected readonly saving = signal(false);
  protected readonly dirty = signal(false);
  protected readonly showUjpDetails = signal(false);

  protected readonly codebooks = this.codebookService.codebooks;

  protected readonly clients = toSignal(
    toObservable(this.companies.activeCompanyId).pipe(
      switchMap((id) => this.clientService.list(id)),
    ),
    { initialValue: [] as Client[] },
  );

  /** Text typed into the client box, used for filtering and prefilling. */
  protected readonly clientQuery = signal('');

  protected readonly clientMatches = computed(() => {
    const query = this.clientQuery().trim();
    const all = this.clients();
    if (!query) return all.slice(0, 8);
    return all
      .filter((c) => matchesSearch(`${c.name} ${c.taxNumber}`, query))
      .slice(0, 8);
  });

  // --- derived amounts -----------------------------------------------------

  /** Single source of truth for every amount shown, saved or signed. */
  private readonly calculation = computed(() => {
    const invoice = this.invoice();
    if (!invoice) return null;
    return computeInvoice(invoice.items, this.codebooks(), {
      advanceAmount: invoice.advanceAmount,
    });
  });

  protected readonly totals = computed(() => this.calculation()?.totals ?? null);
  protected readonly vatTotals = computed(() => this.calculation()?.vatTotals ?? []);
  protected readonly lines = computed(() => this.calculation()?.lines ?? []);

  protected readonly amountInWords = computed(() => {
    const invoice = this.invoice();
    const totals = this.totals();
    if (!invoice || !totals) return '';
    return amountInWordsMk(totals.finalAmount, invoice.currency);
  });

  /** Validation runs against the invoice *with* fresh totals applied. */
  protected readonly validation = computed(() => {
    const invoice = this.invoice();
    const totals = this.totals();
    const vatTotals = this.vatTotals();
    if (!invoice || !totals) return null;
    return validateInvoice({ ...invoice, totals, vatTotals }, this.codebooks());
  });

  protected readonly editable = computed(() => {
    const invoice = this.invoice();
    return invoice ? isEditable(invoice) : false;
  });

  /**
   * An invoice УЈП has not seen can still be deleted, issued or not. Gated on
   * the route id as well, since an unsaved new draft has nothing to delete.
   */
  protected readonly deletable = computed(() => {
    const invoice = this.invoice();
    return !!invoice && !!this.routeId() && isDeletable(invoice);
  });

  protected readonly indicators = computed(() =>
    this.showAllIndicators()
      ? this.codebooks().taxIndicators
      : this.codebooks().taxIndicators.filter((i) => i.common),
  );
  protected readonly showAllIndicators = signal(false);

  /**
   * Short label for the closed tax-indicator field, e.g. `ДДВ 18%` or
   * `DDV-11-A · пренесен`. The full category name is far too long for a field
   * this narrow, but the bare code alone tells a user nothing.
   */
  protected indicatorLabel(code: string): string {
    const set = this.codebooks();
    const indicator = set.taxIndicators.find((i) => i.code === code);
    if (!indicator) return code;

    const rate = set.taxGroups.find((g) => g.code === indicator.taxGroupCode)?.percent ?? 0;
    switch (indicator.vatImpact) {
      case 'STANDARD':
        return `ДДВ ${rate}%`;
      case 'PRENESEN':
        return `${code} · пренесен`;
      case 'OSLOBODEN':
        return `${code} · ослободен`;
      case 'NULA':
        return `${code} · без ДДВ`;
    }
  }

  protected readonly units = computed(() => this.codebooks().units);
  protected readonly paymentTypes = computed(() => this.codebooks().paymentTypes);
  protected readonly currencies = computed(() => this.codebooks().currencies);

  /** Route id as a signal, so navigating between invoices reloads correctly. */
  private readonly routeId = toSignal(
    this.route.paramMap.pipe(map((params) => params.get('id'))),
    { initialValue: this.route.snapshot.paramMap.get('id') },
  );

  constructor() {
    // Load the invoice named by the route, or start a fresh draft. A draft
    // handed over by "save as new" arrives in navigation state.
    effect((onCleanup) => {
      const company = this.companies.activeCompany();
      const id = this.routeId();
      if (!company) return;

      if (!id) {
        // `history.state` is the only place the handed-over draft survives once
        // the navigation itself has finished.
        const draft = history.state?.['draft'] as Invoice | undefined;
        untracked(() => {
          this.invoice.set(draft ?? this.invoiceService.createDraft(company));
          this.dirty.set(!!draft);
          this.loading.set(false);
        });
        return;
      }

      untracked(() => this.loading.set(true));

      const subscription = this.invoiceService.watch(company.id, id).subscribe((loaded) => {
        // A live update must not clobber edits the user has not saved yet.
        if (!this.dirty()) this.invoice.set(loaded);
        this.loading.set(false);
      });
      onCleanup(() => subscription.unsubscribe());
    });
  }

  // --- mutation helpers ----------------------------------------------------

  private patch(changes: Partial<Invoice>): void {
    const current = this.invoice();
    if (!current) return;
    this.invoice.set({ ...current, ...changes });
    this.dirty.set(true);
  }

  protected patchItem(index: number, changes: Partial<InvoiceItem>): void {
    const current = this.invoice();
    if (!current) return;
    const items = current.items.map((item, i) => (i === index ? { ...item, ...changes } : item));
    this.patch({ items });
  }

  /**
   * Changing the tax indicator moves the line to that indicator's rate and
   * group, so the two can never disagree with each other.
   */
  protected setIndicator(index: number, code: string): void {
    const set = this.codebooks();
    const indicator = set.taxIndicators.find((i) => i.code === code);
    if (!indicator) return;
    const group = set.taxGroups.find((g) => g.code === indicator.taxGroupCode);
    const rate =
      indicator.vatImpact === 'OSLOBODEN' || indicator.vatImpact === 'NULA'
        ? 0
        : (group?.percent ?? 0);

    // A "with VAT" price is meaningless where no VAT is charged, so fall back
    // to net entry rather than silently reinterpreting the number.
    const priceMode: PriceMode =
      indicator.vatImpact === 'STANDARD' ? this.invoice()!.items[index].priceMode : 'net';

    this.patchItem(index, {
      taxIndicator: code,
      vatGroup: indicator.taxGroupCode,
      vatRate: rate,
      priceMode,
    });
  }

  protected addItem(): void {
    const company = this.companies.activeCompany();
    const current = this.invoice();
    if (!company || !current) return;

    // A new line inherits the tax treatment of the previous one — invoices are
    // overwhelmingly single-rate, and re-picking the indicator every time is
    // the most repetitive thing about invoice entry.
    const previous = current.items.at(-1);
    const item = createItem(company);
    this.patch({
      items: [
        ...current.items,
        previous
          ? {
              ...item,
              unit: previous.unit,
              taxIndicator: previous.taxIndicator,
              vatGroup: previous.vatGroup,
              vatRate: previous.vatRate,
              priceMode: previous.priceMode,
            }
          : item,
      ],
    });
  }

  protected removeItem(index: number): void {
    const current = this.invoice();
    if (!current) return;
    const items = current.items.filter((_, i) => i !== index);
    this.patch({ items: items.length ? items : [createItem(this.companies.activeCompany()!)] });
  }

  protected duplicateItem(index: number): void {
    const current = this.invoice();
    if (!current) return;
    const source = current.items[index];
    const items = [...current.items];
    items.splice(index + 1, 0, { ...source, id: newId() });
    this.patch({ items });
  }

  protected moveItem(index: number, delta: number): void {
    const current = this.invoice();
    if (!current) return;
    const target = index + delta;
    if (target < 0 || target >= current.items.length) return;
    const items = [...current.items];
    [items[index], items[target]] = [items[target], items[index]];
    this.patch({ items });
  }

  // --- field bindings ------------------------------------------------------

  protected setNumber(value: string): void {
    this.patch({ number: value });
  }

  protected setIssueDate(date: Date | null): void {
    if (!date) return;
    const issueDate = toIsoDate(date);
    const company = this.companies.activeCompany();
    const current = this.invoice();
    if (!current) return;

    // Keep the turnover date and due date in step unless the user has already
    // moved them off the defaults themselves.
    const dueDays = company?.defaults.dueDays ?? 15;
    const turnoverFollowed = current.turnoverDate === current.issueDate;
    const dueFollowed = current.dueDate === addDays(current.issueDate, dueDays);

    this.patch({
      issueDate,
      turnoverDate: turnoverFollowed ? issueDate : current.turnoverDate,
      dueDate: dueFollowed ? addDays(issueDate, dueDays) : current.dueDate,
      exchangeRateDate: issueDate,
    });
  }

  protected setTurnoverDate(date: Date | null): void {
    if (date) this.patch({ turnoverDate: toIsoDate(date) });
  }

  protected setDueDate(date: Date | null): void {
    if (date) this.patch({ dueDate: toIsoDate(date) });
  }

  protected setPaymentType(code: string): void {
    const description =
      this.paymentTypes().find((p) => p.code === code)?.description ?? '';
    this.patch({ paymentTypeCode: code, paymentTypeDesc: description });
  }

  protected setCurrency(code: string): void {
    this.patch({ currency: code, exchangeRate: code === 'MKD' ? 1 : this.invoice()!.exchangeRate });
  }

  protected setField<K extends keyof Invoice>(key: K, value: Invoice[K]): void {
    this.patch({ [key]: value } as Partial<Invoice>);
  }

  protected setNumeric<K extends keyof Invoice>(key: K, value: unknown): void {
    this.patch({ [key]: toNumber(value) } as Partial<Invoice>);
  }

  protected asDate(value: string | null): Date | null {
    return fromIsoDate(value);
  }

  // --- client --------------------------------------------------------------

  protected selectClient(client: Client): void {
    this.patch({
      client: snapshotClient(client),
      dueDate:
        client.defaultDueDays != null
          ? addDays(this.invoice()!.issueDate, client.defaultDueDays)
          : this.invoice()!.dueDate,
      paymentTypeCode: client.defaultPaymentTypeCode ?? this.invoice()!.paymentTypeCode,
      currency: client.defaultCurrency ?? this.invoice()!.currency,
    });
    this.clientQuery.set('');
  }

  protected clearClient(): void {
    this.patch({
      client: {
        id: null,
        name: '',
        taxNumber: '',
        vatNumber: '',
        foreignTaxNumber: '',
        address: {
          streetAddress: '',
          streetNumber: '',
          postalCode: '',
          city: '',
          countryCode: 'MK',
          countryName: 'Северна Македонија',
        },
        email: '',
        phone: '',
        contactPerson: '',
      },
    });
  }

  protected async openClientDialog(existing?: boolean): Promise<void> {
    const companyId = this.companies.activeCompanyId();
    if (!companyId) return;

    const currentId = this.invoice()?.client.id;
    const client = existing && currentId ? this.clients().find((c) => c.id === currentId) : undefined;

    const data: ClientDialogData = {
      companyId,
      client,
      prefillName: existing ? undefined : this.clientQuery().trim(),
    };

    const saved = await this.dialog
      .open(ClientDialog, { data, maxWidth: '96vw' })
      .afterClosed()
      .toPromise();

    if (saved) this.selectClient(saved);
  }

  // --- persistence ---------------------------------------------------------

  protected async saveDraft(): Promise<void> {
    const invoice = this.invoice();
    if (!invoice) return;

    this.saving.set(true);
    try {
      const saved = await this.invoiceService.save(invoice, this.codebooks());
      this.invoice.set(saved);
      this.dirty.set(false);
      this.snackBar.open('Нацртот е зачуван.', 'Во ред');
      if (!this.route.snapshot.paramMap.get('id')) {
        await this.router.navigate(['/fakturi', saved.id], { replaceUrl: true });
      }
    } catch (error) {
      this.reportError(error);
    } finally {
      this.saving.set(false);
    }
  }

  /**
   * Issues the invoice: assigns the next number and freezes it.
   *
   * The UJP submission itself is a separate, later step — it needs a signing
   * certificate, which the app does not have until one is wired in. Issuing is
   * still meaningful on its own: the number is allocated, the document becomes
   * immutable, and it can be printed and sent.
   */
  protected async issue(): Promise<void> {
    const invoice = this.invoice();
    const result = this.validation();
    if (!invoice || !result) return;

    if (!result.canSubmit) {
      this.snackBar.open(
        `Фактурата има ${result.errors.length} ${result.errors.length === 1 ? 'грешка' : 'грешки'} што мора да се исправат.`,
        'Во ред',
      );
      return;
    }

    const data: ConfirmData = {
      title: 'Издавање фактура',
      message:
        'По издавањето, фактурата добива број и повеќе не може да се менува. ' +
        'Продолжувате?',
      confirmLabel: 'Издај',
    };
    const confirmed = await this.dialog.open(ConfirmDialog, { data }).afterClosed().toPromise();
    if (!confirmed) return;

    this.saving.set(true);
    try {
      const issued = await this.invoiceService.issue(invoice, this.codebooks());
      this.invoice.set(issued);
      this.dirty.set(false);

      if (issued.client.id) {
        await this.clientService.recordInvoice(
          issued.companyId,
          issued.client.id,
          issued.totals.finalAmount,
        );
      }

      this.snackBar.open(`Фактура ${issued.number} е издадена.`, 'Во ред');
      if (!this.route.snapshot.paramMap.get('id')) {
        await this.router.navigate(['/fakturi', issued.id], { replaceUrl: true });
      }
    } catch (error) {
      this.reportError(error);
    } finally {
      this.saving.set(false);
    }
  }

  protected async duplicate(): Promise<void> {
    const invoice = this.invoice();
    const company = this.companies.activeCompany();
    if (!invoice || !company) return;
    const draft = this.invoiceService.duplicate(invoice, company);
    this.dirty.set(false);
    await this.router.navigate(['/fakturi/nova'], { state: { draft } });
    this.invoice.set(draft);
  }

  protected openUjpPreview(): void {
    const invoice = this.invoice();
    const totals = this.totals();
    const vatTotals = this.vatTotals();
    if (!invoice || !totals) return;

    const data: UjpPreviewData = {
      invoice: { ...invoice, totals, vatTotals },
      codebooks: this.codebooks(),
    };
    this.dialog.open(UjpPreviewDialog, { data, maxWidth: '96vw', width: '820px' });
  }

  protected async remove(): Promise<void> {
    const invoice = this.invoice();
    if (!invoice || !isDeletable(invoice)) return;

    const issued = !isEditable(invoice);
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
        : 'Нацртот ќе биде избришан. Ова не може да се врати.',
      confirmLabel: 'Избриши',
      destructive: true,
    };
    const confirmed = await this.dialog.open(ConfirmDialog, { data }).afterClosed().toPromise();
    if (!confirmed) return;

    this.saving.set(true);
    try {
      await this.invoiceService.remove(invoice);
      this.dirty.set(false);
      this.snackBar.open(
        issued && reusable
          ? `Фактурата е избришана. Бројот ${invoice.number} е слободен.`
          : issued
            ? 'Фактурата е избришана.'
            : 'Нацртот е избришан.',
        'Во ред',
      );
      await this.router.navigate(['/fakturi']);
    } catch (error) {
      this.reportError(error);
    } finally {
      this.saving.set(false);
    }
  }

  /**
   * Opens the share sheet. It closes with 'print' when the sender chose to
   * produce the PDF, which has to happen here: printing from inside an open
   * dialog would put the dialog's backdrop on the page.
   */
  protected async share(): Promise<void> {
    const invoice = this.invoice();
    if (!invoice) return;

    const data: ShareDialogData = { invoice };
    const result = await this.dialog
      .open(ShareDialog, { data, maxWidth: '96vw', width: '560px' })
      .afterClosed()
      .toPromise();

    if (result === 'print') this.print();
  }

  protected print(): void {
    window.print();
  }

  /** The route title while printing, so it can be put back afterwards. */
  private titleBeforePrint: string | null = null;

  /**
   * "Save as PDF" names the file after the page title, which is otherwise the
   * route's generic „Фактура — е-Фактура“ for every invoice. Swapped only for
   * the duration of the print so the browser tab keeps its usual name.
   */
  protected titleForPrint(): void {
    const invoice = this.invoice();
    if (!invoice) return;
    this.titleBeforePrint ??= this.title.getTitle();
    this.title.setTitle(pdfFileName(invoice));
  }

  protected restoreTitle(): void {
    if (this.titleBeforePrint === null) return;
    this.title.setTitle(this.titleBeforePrint);
    this.titleBeforePrint = null;
  }

  private reportError(error: unknown): void {
    this.snackBar.open(
      `Грешка: ${(error as Error)?.message ?? error}`,
      'Затвори',
      { duration: 8000 },
    );
  }
}
