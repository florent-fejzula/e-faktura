import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
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
import { CatalogService } from '../../core/data/catalog.service';
import { ClientService } from '../../core/data/client.service';
import { CodebookService } from '../../core/data/codebook.service';
import { CompanyService } from '../../core/data/company.service';
import { InvoiceService, createItem } from '../../core/data/invoice.service';
import {
  applyCatalogItem,
  catalogFieldsFromLine,
  findByName,
  type CatalogItem,
} from '../../core/models/catalog.model';
import type { Client } from '../../core/models/client.model';
import { snapshotClient } from '../../core/models/client.model';
import { printSettings, snapshotCompany } from '../../core/models/company.model';
import type { Invoice, InvoiceItem, PriceMode } from '../../core/models/invoice.model';
import { NEW_INVOICE_SEGMENT, isDeletable, isEditable } from '../../core/models/invoice.model';
import { indicatorShortLabel, resolveIndicator } from '../../core/ujp/codebooks';
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
 *
 * A draft saves itself (see "autosave" below): looking something up on another
 * screen and pressing Back returns to the invoice as it was left.
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
  host: {
    // Window events rather than the Печати button, so Ctrl+P names the file too.
    '(window:beforeprint)': 'titleForPrint()',
    '(window:afterprint)': 'restoreTitle()',
    // Switching to another app on a phone, or closing the tab, saves the draft
    // there and then instead of waiting out the autosave delay.
    '(document:visibilitychange)': 'onVisibilityChange()',
    '(window:pagehide)': 'flushAutosave()',
  },
})
export class InvoiceEditorPage {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly invoiceService = inject(InvoiceService);
  private readonly clientService = inject(ClientService);
  private readonly catalogService = inject(CatalogService);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);
  private readonly title = inject(Title);
  protected readonly companies = inject(CompanyService);
  protected readonly codebookService = inject(CodebookService);

  protected readonly invoice = signal<Invoice | null>(null);
  protected readonly loading = signal(true);
  /** An explicit save, issue or delete is running — the progress bar. */
  protected readonly saving = signal(false);
  /** Edits not yet handed to Firestore. */
  private readonly dirty = signal(false);
  /** What the header says about the draft's autosave. */
  protected readonly saveState = signal<'idle' | 'saving' | 'saved' | 'error'>('idle');
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

  // --- Ценовник module ------------------------------------------------------

  protected readonly catalogEnabled = computed(() => this.companies.hasModule('catalog'));

  /** The price list, loaded only for companies that have the module. */
  private readonly catalogEntries = toSignal(
    toObservable(
      computed(() => (this.catalogEnabled() ? this.companies.activeCompanyId() : null)),
    ).pipe(switchMap((id) => this.catalogService.list(id))),
    { initialValue: [] as CatalogItem[] },
  );

  /**
   * Price-list entries for a line's description box. With nothing typed it
   * offers the start of the list, so the list is discoverable from an empty
   * line; once the description matches an entry exactly there is nothing left
   * to suggest.
   */
  protected catalogMatches(query: string): CatalogItem[] {
    if (!this.catalogEnabled()) return [];
    const all = this.catalogEntries();
    const text = query.trim();
    if (!text) return all.slice(0, 8);
    if (findByName(all, text)?.name === text) return [];
    return all.filter((e) => matchesSearch(`${e.name} ${e.sku}`, text)).slice(0, 8);
  }

  protected applyCatalog(index: number, entry: CatalogItem): void {
    const current = this.invoice();
    if (!current) return;
    const items = current.items.map((item, i) => (i === index ? applyCatalogItem(item, entry) : item));
    this.patch({ items });
  }

  /**
   * "Save to price list" from a line. A line whose description already names
   * an entry updates that entry rather than adding a near-duplicate — the
   * usual reason to do this is that the price changed.
   */
  protected async saveLineToCatalog(index: number): Promise<void> {
    const company = this.companies.activeCompany();
    const line = this.invoice()?.items[index];
    if (!company || !line) return;

    const fields = catalogFieldsFromLine(line);
    if (!fields.name) {
      this.snackBar.open('Внесете опис на ставката пред да ја зачувате во ценовникот.', 'Во ред');
      return;
    }

    const existing = findByName(this.catalogEntries(), fields.name);
    try {
      await this.catalogService.save({ ...(existing ?? this.catalogService.blank(company)), ...fields });
      this.snackBar.open(
        existing ? `„${fields.name}“ е ажурирано во ценовникот.` : `„${fields.name}“ е додадено во ценовникот.`,
        'Во ред',
      );
    } catch (error) {
      this.reportError(error);
    }
  }

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

  /** Short label for the closed tax-indicator field, e.g. `ДДВ 18%`. */
  protected indicatorLabel(code: string): string {
    return indicatorShortLabel(this.codebooks(), code);
  }

  protected readonly units = computed(() => this.codebooks().units);
  protected readonly paymentTypes = computed(() => this.codebooks().paymentTypes);
  protected readonly currencies = computed(() => this.codebooks().currencies);

  /** Id of the invoice in the address bar; `null` for `/fakturi/nova`. */
  private readonly routeId = toSignal(
    this.route.paramMap.pipe(map((params) => invoiceIdFrom(params.get('id')))),
    { initialValue: invoiceIdFrom(this.route.snapshot.paramMap.get('id')) },
  );

  /**
   * The active company's id once it has loaded. The editor reloads when the
   * company *changes*, not on every update to it — a colleague issuing an
   * invoice bumps the numbering on the company document, and that must not
   * reset a new invoice someone is halfway through.
   */
  private readonly companyId = computed(() => this.companies.activeCompany()?.id ?? null);

  /**
   * What the print component renders. A draft shows the company as it is now,
   * since that is what it will be issued with; an issued invoice shows exactly
   * what was frozen into it.
   */
  protected readonly printable = computed(() => {
    const invoice = this.invoice();
    return invoice ? this.withCurrentSeller(invoice) : null;
  });

  constructor() {
    // Load the invoice named by the route, or start a fresh draft. A draft
    // handed over by "save as new" arrives in navigation state.
    effect((onCleanup) => {
      const companyId = this.companyId();
      const id = this.routeId();
      if (!companyId) return;

      // The route moved on to another invoice, or the company was switched, in
      // the same editor (the route is shared, so the page is kept): what was
      // typed into the one on screen is saved first.
      const onScreen = untracked(() => this.isOnScreen(companyId, id));
      if (!onScreen) untracked(() => void this.flushAutosave());

      if (!id) {
        // `history.state` is the only place the handed-over draft survives once
        // the navigation itself has finished.
        const handedOver = history.state?.['draft'] as Invoice | undefined;
        untracked(() => {
          const company = this.companies.activeCompany()!;
          this.startEditing(handedOver ?? this.invoiceService.createDraft(company));
          // A copy is new work the user has not saved, so it saves itself too.
          if (handedOver) this.markEdited();
          this.loading.set(false);
        });
        return;
      }

      // A new invoice that has just taken its own address is the invoice
      // already on screen: no spinner, nothing to reload.
      if (!onScreen) untracked(() => this.loading.set(true));

      const subscription = this.invoiceService
        .watch(companyId, id)
        .subscribe((loaded) => this.receive(companyId, id, loaded));
      onCleanup(() => subscription.unsubscribe());
    });

    // Leaving for another screen destroys the editor; nothing typed is lost.
    inject(DestroyRef).onDestroy(() => void this.flushAutosave());
  }

  private isOnScreen(companyId: string, id: string | null): boolean {
    const current = this.invoice();
    return !!current && current.id === id && current.companyId === companyId;
  }

  /** A snapshot of the invoice the route names, from the live listener. */
  private receive(companyId: string, id: string, loaded: Invoice | null): void {
    if (this.isOnScreen(companyId, id)) {
      // Keep what is on screen when the document has not been written yet (a
      // new invoice before its first autosave), when this is our own write
      // coming back, or while there are edits still to be saved. What is left
      // is a change made elsewhere — another tab or device.
      const ownEcho = loaded !== null && this.ownWrites.has(loaded.updatedAt);
      if (loaded && !ownEcho && !this.dirty()) this.invoice.set(loaded);
    } else {
      this.startEditing(loaded);
    }
    this.loading.set(false);
  }

  private startEditing(invoice: Invoice | null): void {
    clearTimeout(this.autosaveTimer);
    this.dirty.set(false);
    this.saveState.set('idle');
    this.discarded = false;
    this.ownWrites.clear();
    this.invoice.set(invoice);
  }

  // --- autosave ------------------------------------------------------------
  //
  // A draft saves itself a moment after the last edit, when the editor is
  // left, and when the tab is hidden. Firestore keeps writes it has not sent
  // yet in IndexedDB, so a save handed over just as the tab closes is still
  // delivered the next time the app opens.
  //
  // Drafts never take a number (that happens on issue), so saving them early
  // costs nothing but a row in the list marked „Нацрт“.

  private static readonly AUTOSAVE_DELAY_MS = 1200;

  private autosaveTimer: ReturnType<typeof setTimeout> | undefined;
  /** Bumped by every edit, so a save can tell whether more arrived while it ran. */
  private revision = 0;
  /** `updatedAt` of every write made here, to tell their echoes from someone else's edit. */
  private readonly ownWrites = new Set<number>();
  /** The latest write still in flight. Issuing and deleting wait for it. */
  private lastWrite: Promise<boolean> = Promise.resolve(true);
  /** Set once the draft is deleted, so a late autosave cannot recreate it. */
  private discarded = false;
  /** A new invoice whose change of address is already on its way. */
  private adopting: string | null = null;

  private markEdited(): void {
    this.revision++;
    this.dirty.set(true);
    this.saveState.set('saving');
    this.adoptAddress();
    clearTimeout(this.autosaveTimer);
    this.autosaveTimer = setTimeout(
      () => void this.flushAutosave(),
      InvoiceEditorPage.AUTOSAVE_DELAY_MS,
    );
  }

  /**
   * Gives a new invoice its own address on its first edit, so that Back from
   * another screen returns to it. The route is shared with `/fakturi/nova`, so
   * this changes the address bar and leaves the page as it is.
   */
  private adoptAddress(): void {
    const invoice = this.invoice();
    if (!invoice || this.routeId() === invoice.id || this.adopting === invoice.id) return;
    this.adopting = invoice.id;
    void this.router.navigate(['/fakturi', invoice.id], { replaceUrl: true });
  }

  /** Saves whatever has not been handed to Firestore yet. Safe to call at any time. */
  protected flushAutosave(): Promise<boolean> {
    clearTimeout(this.autosaveTimer);
    const invoice = this.invoice();
    if (!invoice || !this.dirty() || this.discarded || !isEditable(invoice)) {
      return this.lastWrite;
    }
    return this.writeDraft(invoice);
  }

  protected onVisibilityChange(): void {
    if (document.visibilityState === 'hidden') void this.flushAutosave();
  }

  /**
   * Writes the draft. Resolves to whether it was saved; never rejects. A
   * failure is reported here — once per run of failures for autosaves, every
   * time for the explicit save — and the edits stay marked unsaved, so the next
   * edit or the next flush tries again.
   */
  private writeDraft(invoice: Invoice, explicit = false): Promise<boolean> {
    const revision = this.revision;
    const finalized = this.invoiceService.finalize(this.withCurrentSeller(invoice), this.codebooks());
    this.ownWrites.add(finalized.updatedAt);
    this.dirty.set(false);
    this.saveState.set('saving');

    const write = this.invoiceService.write(finalized).then(
      () => {
        if (this.invoice()?.id === invoice.id && this.revision === revision) {
          this.saveState.set('saved');
        }
        return true;
      },
      (error: unknown) => {
        if (this.invoice()?.id === invoice.id) {
          this.dirty.set(true);
          if (explicit || this.saveState() !== 'error') {
            this.reportError(error, 'Нацртот не е зачуван');
          }
          this.saveState.set('error');
        }
        return false;
      },
    );
    this.lastWrite = write;
    return write;
  }

  /** A draft carries the company as it is now; it is frozen only when issued. */
  private withCurrentSeller(invoice: Invoice): Invoice {
    const company = this.companies.activeCompany();
    return company && company.id === invoice.companyId && isEditable(invoice)
      ? { ...invoice, seller: snapshotCompany(company) }
      : invoice;
  }

  // --- mutation helpers ----------------------------------------------------

  private patch(changes: Partial<Invoice>): void {
    const current = this.invoice();
    if (!current) return;
    this.invoice.set({ ...current, ...changes });
    this.markEdited();
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
    const resolved = resolveIndicator(this.codebooks(), code);
    if (!resolved) return;

    // A "with VAT" price is meaningless where no VAT is charged, so fall back
    // to net entry rather than silently reinterpreting the number.
    const priceMode: PriceMode = resolved.allowsGrossPrice
      ? this.invoice()!.items[index].priceMode
      : 'net';

    this.patchItem(index, {
      taxIndicator: resolved.taxIndicator,
      vatGroup: resolved.vatGroup,
      vatRate: resolved.vatRate,
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

  /**
   * The explicit save. The draft saves itself anyway; this one says so out
   * loud, and also writes an untouched new invoice for someone who wants it
   * in the list before filling it in.
   */
  protected async saveDraft(): Promise<void> {
    const invoice = this.invoice();
    if (!invoice) return;

    clearTimeout(this.autosaveTimer);
    this.saving.set(true);
    try {
      if (await this.writeDraft(invoice, true)) {
        this.snackBar.open('Нацртот е зачуван.', 'Во ред');
        this.adoptAddress();
      }
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
      // The draft's last autosave reaches the server before the transaction
      // that freezes it, or it would arrive after and be refused.
      await this.flushAutosave();

      const issued = await this.invoiceService.issue(this.invoice() ?? invoice, this.codebooks());
      this.startEditing(issued);

      if (issued.client.id) {
        await this.clientService.recordInvoice(
          issued.companyId,
          issued.client.id,
          issued.totals.finalAmount,
        );
      }

      this.snackBar.open(`Фактура ${issued.number} е издадена.`, 'Во ред');
      this.adoptAddress();
    } catch (error) {
      this.reportError(error);
    } finally {
      this.saving.set(false);
    }
  }

  /**
   * "Save as new". The copy goes through `/fakturi/nova`, so starting one is
   * behind the paywall like any other new invoice, and is picked up there by
   * the load effect.
   */
  protected async duplicate(): Promise<void> {
    const invoice = this.invoice();
    const company = this.companies.activeCompany();
    if (!invoice || !company) return;
    await this.flushAutosave();
    const draft = this.invoiceService.duplicate(invoice, company);
    await this.router.navigate(['/fakturi', NEW_INVOICE_SEGMENT], { state: { draft } });
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
      // Whatever is still on its way lands first, and then nothing more is
      // written: an autosave arriving after the delete would recreate the draft.
      await this.flushAutosave();
      this.discarded = true;
      clearTimeout(this.autosaveTimer);

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
      this.discarded = false;
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
    const naming = printSettings(this.companies.activeCompany()).fileName;
    this.title.setTitle(pdfFileName(invoice, naming));
  }

  protected restoreTitle(): void {
    if (this.titleBeforePrint === null) return;
    this.title.setTitle(this.titleBeforePrint);
    this.titleBeforePrint = null;
  }

  private reportError(error: unknown, prefix = 'Грешка'): void {
    this.snackBar.open(
      `${prefix}: ${(error as Error)?.message ?? error}`,
      'Затвори',
      { duration: 8000 },
    );
  }
}

/** The invoice an address names; `/fakturi/nova` does not name one yet. */
function invoiceIdFrom(segment: string | null): string | null {
  return segment && segment !== NEW_INVOICE_SEGMENT ? segment : null;
}
