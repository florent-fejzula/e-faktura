import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { ClientService } from '../../core/data/client.service';
import type { Client } from '../../core/models/client.model';
import { SEED_PAYMENT_TYPES } from '../../core/ujp/codebooks';

export interface ClientDialogData {
  companyId: string;
  /** Existing client to edit; omit to create a new one. */
  client?: Client;
  /** Pre-fills the name when opened from the invoice editor's search box. */
  prefillName?: string;
}

/**
 * Create or edit a buyer.
 *
 * The address is captured in parts because that is what UJP requires, and the
 * ЕДБ is validated to 13 digits here rather than at submission time — a wrong
 * tax number fails the registry cross-check and rejects the whole invoice.
 */
@Component({
  selector: 'app-client-dialog',
  imports: [
    ReactiveFormsModule,
    MatDialogModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatIconModule,
    MatSelectModule,
    MatSlideToggleModule,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './client.dialog.html',
  styleUrl: './client.dialog.scss',
})
export class ClientDialog {
  private readonly fb = inject(FormBuilder);
  private readonly clients = inject(ClientService);
  protected readonly ref = inject(MatDialogRef<ClientDialog, Client | null>);
  protected readonly data = inject<ClientDialogData>(MAT_DIALOG_DATA);

  protected readonly paymentTypes = SEED_PAYMENT_TYPES;
  protected readonly saving = signal(false);
  protected readonly showAdvanced = signal(false);
  protected readonly isEdit = !!this.data.client;

  private readonly base: Client =
    this.data.client ?? this.clients.blank(this.data.companyId);

  protected readonly form = this.fb.nonNullable.group({
    name: [this.base.name || this.data.prefillName || '', [Validators.required, Validators.maxLength(80)]],
    taxNumber: [this.base.taxNumber, [Validators.required, Validators.pattern(/^\d{13}$/)]],
    vatNumber: [this.base.vatNumber],
    registrationNumber: [this.base.registrationNumber],
    streetAddress: [this.base.address.streetAddress, Validators.required],
    streetNumber: [this.base.address.streetNumber, Validators.required],
    postalCode: [this.base.address.postalCode, [Validators.required, Validators.pattern(/^\d{4}$/)]],
    city: [this.base.address.city, Validators.required],
    countryCode: [this.base.address.countryCode || 'MK'],
    foreignTaxNumber: [this.base.foreignTaxNumber],
    email: [this.base.email, Validators.email],
    phone: [this.base.phone],
    contactPerson: [this.base.contactPerson],
    notes: [this.base.notes],
    defaultDueDays: [this.base.defaultDueDays as number | null],
    defaultPaymentTypeCode: [this.base.defaultPaymentTypeCode as string | null],
  });

  constructor() {
    // Same convenience as onboarding: the ДДВ number is the ЕДБ with a МК
    // prefix, so derive it instead of asking for 13 digits twice.
    this.form.controls.taxNumber.valueChanges.subscribe((value) => {
      if (/^\d{13}$/.test(value) && !this.form.controls.vatNumber.dirty) {
        this.form.controls.vatNumber.setValue(`МК${value}`, { emitEvent: false });
      }
    });
  }

  /** Set when the write fails, so the dialog explains itself instead of just
   *  refusing to close. */
  protected readonly saveError = signal<string | null>(null);

  protected async save(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.saveError.set('Пополнете ги задолжителните полиња означени со црвено.');
      return;
    }

    this.saving.set(true);
    this.saveError.set(null);
    try {
      const v = this.form.getRawValue();
      const saved = await this.clients.save({
        ...this.base,
        name: v.name,
        taxNumber: v.taxNumber,
        vatNumber: v.vatNumber,
        registrationNumber: v.registrationNumber,
        foreignTaxNumber: v.foreignTaxNumber,
        address: {
          streetAddress: v.streetAddress,
          streetNumber: v.streetNumber,
          postalCode: v.postalCode,
          city: v.city,
          countryCode: v.countryCode || 'MK',
          countryName: v.countryCode === 'MK' ? 'Северна Македонија' : '',
        },
        email: v.email,
        phone: v.phone,
        contactPerson: v.contactPerson,
        notes: v.notes,
        defaultDueDays: v.defaultDueDays,
        defaultPaymentTypeCode: v.defaultPaymentTypeCode,
        defaultCurrency: this.base.defaultCurrency,
      });
      this.ref.close(saved);
    } catch (error) {
      // Without this the dialog just sits there: `close` never runs and the
      // user gets no explanation for why nothing happened.
      this.saveError.set(
        `Зачувувањето не успеа: ${(error as Error)?.message ?? error}`,
      );
    } finally {
      this.saving.set(false);
    }
  }
}
