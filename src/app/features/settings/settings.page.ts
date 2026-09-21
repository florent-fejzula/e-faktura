import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatDividerModule } from '@angular/material/divider';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { AuthService } from '../../core/auth/auth.service';
import { CodebookService } from '../../core/data/codebook.service';
import { CompanyService } from '../../core/data/company.service';
import { NUMBERING_PRESETS, previewNumbering } from '../../core/data/numbering';
import {
  SUBSCRIPTION_LABELS,
  daysRemaining,
  subscriptionState,
  type NumberingReset,
} from '../../core/models/company.model';
import { UjpSigner, UjpTransport } from '../../core/ujp/ujp-signer';
import { todayIso } from '../../core/util/dates';
import { newId } from '../../core/util/id';
import { RenewDialog, type RenewDialogData } from '../billing/renew.dialog';
import { FORMAT_PIPES } from '../../shared/format.pipes';
import { environment } from '../../../environments/environment';

@Component({
  selector: 'app-settings-page',
  imports: [
    ReactiveFormsModule,
    MatButtonModule,
    MatIconModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatCheckboxModule,
    MatExpansionModule,
    MatDialogModule,
    MatDividerModule,
    MatTooltipModule,
    ...FORMAT_PIPES,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './settings.page.html',
  styleUrl: './settings.page.scss',
})
export class SettingsPage {
  private readonly fb = inject(FormBuilder);
  private readonly snackBar = inject(MatSnackBar);
  private readonly signer = inject(UjpSigner);
  private readonly transport = inject(UjpTransport);
  protected readonly companies = inject(CompanyService);
  protected readonly codebookService = inject(CodebookService);

  protected readonly presets = NUMBERING_PRESETS;
  protected readonly saving = signal(false);
  protected readonly signerStatus = this.signer.status();
  protected readonly transportStatus = this.transport.status();
  protected readonly ujpEnvironment = environment.ujp.environment;
  protected readonly ujpApiBaseUrl = environment.ujp.apiBaseUrl;

  protected readonly company = this.companies.activeCompany;

  private readonly auth = inject(AuthService);

  /** Shown so the operator can be granted admin without hunting for the uid. */
  protected readonly userId = computed(() => this.auth.user()?.uid ?? '');

  protected readonly subscription = computed(() => this.company()?.subscription ?? null);

  protected readonly subscriptionLabel = computed(
    () => SUBSCRIPTION_LABELS[subscriptionState(this.subscription())],
  );

  private readonly dialog = inject(MatDialog);

  protected openRenew(): void {
    const company = this.company();
    if (!company) return;
    const data: RenewDialogData = { company };
    this.dialog.open(RenewDialog, { data, maxWidth: '94vw', width: '480px' });
  }

  protected readonly subscriptionSummary = computed(() => {
    const sub = this.subscription();
    if (!sub?.paidUntil) return 'Активна';
    const left = daysRemaining(sub);
    if (left < 0) return 'Истечена';
    if (left === 0) return 'Истекува денес';
    return `Уште ${left} ${left === 1 ? 'ден' : 'дена'}`;
  });

  protected readonly form = this.fb.nonNullable.group({
    name: ['', [Validators.required, Validators.maxLength(80)]],
    taxNumber: ['', [Validators.required, Validators.pattern(/^\d{13}$/)]],
    vatNumber: [''],
    registrationNumber: [''],
    isVatRegistered: [true],
    streetAddress: ['', Validators.required],
    streetNumber: ['', Validators.required],
    postalCode: ['', [Validators.required, Validators.pattern(/^\d{4}$/)]],
    city: ['', Validators.required],
    email: ['', Validators.email],
    phone: [''],
    contactPerson: [''],
    bankName: [''],
    accountNumber: [''],
  });

  protected readonly numberingForm = this.fb.nonNullable.group({
    pattern: ['{SEQ}/{YYYY}', Validators.required],
    prefix: [''],
    padding: [4, [Validators.min(0), Validators.max(10)]],
    nextSeq: [1, [Validators.required, Validators.min(1)]],
    reset: ['yearly' as NumberingReset, Validators.required],
  });

  protected readonly defaultsForm = this.fb.nonNullable.group({
    dueDays: [15, [Validators.min(0), Validators.max(365)]],
    paymentTypeCode: ['P12'],
    currency: ['MKD'],
    unit: ['ком'],
    taxIndicator: ['DDV-A'],
    invoiceFooter: [''],
  });

  protected readonly ujpForm = this.fb.nonNullable.group({
    eujpId: [''],
    certificateSerialNumber: [''],
  });

  private readonly numberingSource = signal(this.numberingForm.getRawValue());

  protected readonly numberPreview = computed(() => {
    const v = this.numberingSource();
    return previewNumbering(
      {
        pattern: v.pattern,
        prefix: v.prefix,
        padding: v.padding,
        nextSeq: v.nextSeq,
        reset: v.reset,
        periodKey: this.company()?.numbering.periodKey ?? String(new Date().getFullYear()),
      },
      todayIso(),
    );
  });

  protected readonly codebooks = this.codebookService.codebooks;

  protected readonly codebookSummary = computed(() => {
    const set = this.codebooks();
    return {
      syncedAt: set.syncedAt,
      indicators: set.taxIndicators.length,
      groups: set.taxGroups.length,
      paymentTypes: set.paymentTypes.length,
    };
  });

  constructor() {
    // Refill the forms whenever the active company changes.
    effect(() => {
      const company = this.company();
      if (!company) return;

      const bank = company.bankAccounts.find((b) => b.isPrimary) ?? company.bankAccounts[0];

      this.form.reset({
        name: company.name,
        taxNumber: company.taxNumber,
        vatNumber: company.vatNumber,
        registrationNumber: company.registrationNumber,
        isVatRegistered: company.isVatRegistered,
        streetAddress: company.address.streetAddress,
        streetNumber: company.address.streetNumber,
        postalCode: company.address.postalCode,
        city: company.address.city,
        email: company.email,
        phone: company.phone,
        contactPerson: company.contactPerson,
        bankName: bank?.bankName ?? '',
        accountNumber: bank?.accountNumber ?? '',
      });

      this.numberingForm.reset({
        pattern: company.numbering.pattern,
        prefix: company.numbering.prefix,
        padding: company.numbering.padding,
        nextSeq: company.numbering.nextSeq,
        reset: company.numbering.reset,
      });

      this.defaultsForm.reset({ ...company.defaults });
      this.ujpForm.reset({
        eujpId: company.ujp.eujpId,
        certificateSerialNumber: company.ujp.certificateSerialNumber,
      });
    });

    this.numberingForm.valueChanges.subscribe(() =>
      this.numberingSource.set(this.numberingForm.getRawValue()),
    );
  }

  protected async saveCompany(): Promise<void> {
    const company = this.company();
    if (!company || this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    const v = this.form.getRawValue();
    const existing = company.bankAccounts.find((b) => b.isPrimary) ?? company.bankAccounts[0];

    await this.persist(() =>
      this.companies.update(company.id, {
        name: v.name,
        taxNumber: v.taxNumber,
        vatNumber: v.vatNumber,
        registrationNumber: v.registrationNumber,
        isVatRegistered: v.isVatRegistered,
        address: {
          ...company.address,
          streetAddress: v.streetAddress,
          streetNumber: v.streetNumber,
          postalCode: v.postalCode,
          city: v.city,
        },
        email: v.email,
        phone: v.phone,
        contactPerson: v.contactPerson,
        bankAccounts: v.accountNumber
          ? [
              {
                id: existing?.id ?? newId(),
                bankName: v.bankName,
                accountNumber: v.accountNumber,
                isPrimary: true,
              },
              ...company.bankAccounts.filter((b) => b.id !== existing?.id),
            ]
          : [],
      }),
    );
  }

  protected async saveNumbering(): Promise<void> {
    const company = this.company();
    if (!company || this.numberingForm.invalid) {
      this.numberingForm.markAllAsTouched();
      return;
    }
    const v = this.numberingForm.getRawValue();
    await this.persist(() =>
      this.companies.update(company.id, {
        numbering: { ...company.numbering, ...v },
      }),
    );
  }

  protected async saveDefaults(): Promise<void> {
    const company = this.company();
    if (!company) return;
    await this.persist(() =>
      this.companies.update(company.id, { defaults: this.defaultsForm.getRawValue() }),
    );
  }

  protected async saveUjp(): Promise<void> {
    const company = this.company();
    if (!company) return;
    const v = this.ujpForm.getRawValue();
    await this.persist(() =>
      this.companies.update(company.id, {
        ujp: { ...company.ujp, eujpId: v.eujpId.trim(), certificateSerialNumber: v.certificateSerialNumber.trim() },
      }),
    );
  }

  protected async syncCodebooks(): Promise<void> {
    const ok = await this.codebookService.sync();
    this.snackBar.open(
      ok ? 'Шифрарниците се ажурирани од УЈП.' : (this.codebookService.syncError() ?? 'Синхронизацијата не успеа.'),
      'Во ред',
      { duration: ok ? 4000 : 9000 },
    );
  }

  protected applyPreset(pattern: string): void {
    this.numberingForm.controls.pattern.setValue(pattern);
  }

  private async persist(action: () => Promise<void>): Promise<void> {
    this.saving.set(true);
    try {
      await action();
      this.snackBar.open('Зачувано.', 'Во ред');
    } catch (error) {
      this.snackBar.open(`Грешка: ${(error as Error)?.message ?? error}`, 'Затвори', {
        duration: 8000,
      });
    } finally {
      this.saving.set(false);
    }
  }
}
