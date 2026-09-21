import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatTooltipModule } from '@angular/material/tooltip';
import { AdminService } from '../../core/data/admin.service';
import type { IssuedCredentials } from '../../core/models/provisioning.model';
import { addDays, formatDate, fromIsoDate, todayIso, toIsoDate } from '../../core/util/dates';
import { newId } from '../../core/util/id';
import { generatePassword, groupForReading } from '../../core/util/password';

/** Subscription length offered on the form. `custom` reveals the date picker. */
type Preset = 'trial30' | 'paid180' | 'paid365' | 'custom';

const PRESET_DAYS: Record<Exclude<Preset, 'custom'>, number> = {
  trial30: 30,
  paid180: 180,
  paid365: 365,
};

/**
 * Creating a customer: their company details, their sign-in credentials, and
 * how long they are paid up for — in one pass.
 *
 * The dialog does not close on success. It swaps to a panel showing the
 * password, because that is the only moment it is ever visible: it is sent to
 * the function, hashed by Firebase Auth and never stored anywhere this app can
 * read. Closing too early means resetting it for a customer who has not yet
 * been told what it is.
 */
@Component({
  selector: 'app-new-customer-dialog',
  imports: [
    ReactiveFormsModule,
    MatButtonModule,
    MatCheckboxModule,
    MatDatepickerModule,
    MatDialogModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSelectModule,
    MatTooltipModule,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './new-customer.dialog.html',
  styleUrl: './new-customer.dialog.scss',
})
export class NewCustomerDialog {
  private readonly fb = inject(FormBuilder);
  private readonly admin = inject(AdminService);
  protected readonly ref = inject(MatDialogRef<NewCustomerDialog, IssuedCredentials | null>);

  protected readonly saving = signal(false);
  protected readonly saveError = signal<string | null>(null);
  protected readonly showPassword = signal(true);
  protected readonly copied = signal<string | null>(null);

  /** Set once the customer exists. Switches the dialog to the handover panel. */
  protected readonly issued = signal<IssuedCredentials | null>(null);

  protected readonly form = this.fb.nonNullable.group({
    // Фирма
    name: ['', [Validators.required, Validators.maxLength(80)]],
    taxNumber: ['', [Validators.required, Validators.pattern(/^\d{13}$/)]],
    isVatRegistered: [true],
    vatNumber: [''],
    registrationNumber: [''],

    // Адреса
    streetAddress: ['', Validators.required],
    streetNumber: ['', Validators.required],
    postalCode: ['', [Validators.required, Validators.pattern(/^\d{4}$/)]],
    city: ['', Validators.required],

    // Контакт
    email: ['', [Validators.email]],
    phone: [''],
    contactPerson: [''],

    // Банка
    bankName: [''],
    accountNumber: [''],

    // Најава
    loginEmail: ['', [Validators.required, Validators.email]],
    password: [generatePassword(), [Validators.required, Validators.minLength(12)]],

    // Претплата
    preset: ['paid365' as Preset],
    paidUntil: [addDays(todayIso(), PRESET_DAYS.paid365)],
    note: [''],
  });

  constructor() {
    const { taxNumber, vatNumber, email, loginEmail, preset, paidUntil } = this.form.controls;

    // Same convenience as onboarding and the client dialog: the ДДВ number is
    // the ЕДБ with a МК prefix, so derive it rather than asking twice. Cyrillic
    // МК — the УЈП API rejects the Latin spelling here.
    taxNumber.valueChanges.subscribe((value) => {
      if (/^\d{13}$/.test(value) && !vatNumber.dirty) {
        vatNumber.setValue(`МК${value}`, { emitEvent: false });
      }
    });

    // The company address is almost always the address they will sign in with,
    // and typing it twice is how a typo gets into the one field that locks the
    // customer out. Stops as soon as the operator edits the login field.
    email.valueChanges.subscribe((value) => {
      if (!loginEmail.dirty) loginEmail.setValue(value.trim(), { emitEvent: false });
    });

    preset.valueChanges.subscribe((value) => {
      if (value === 'custom') return;
      paidUntil.setValue(addDays(todayIso(), PRESET_DAYS[value]));
    });
  }

  protected readonly isCustomPeriod = computed(() => this.form.controls.preset.value === 'custom');

  /** The chosen end date, spelled out under the period selector. */
  protected readonly paidUntilLabel = computed(() => formatDate(this.form.controls.paidUntil.value));

  protected readonly grouped = computed(() => {
    const credentials = this.issued();
    return credentials ? groupForReading(credentials.password) : '';
  });

  /** Ready to paste into an e-mail, Viber or WhatsApp. */
  protected readonly handoverMessage = computed(() => {
    const credentials = this.issued();
    return credentials ? welcomeMessage(credentials, location.origin) : '';
  });

  protected asDate(value: string): Date | null {
    return fromIsoDate(value);
  }

  protected setPaidUntil(date: Date | null): void {
    if (date) this.form.controls.paidUntil.setValue(toIsoDate(date));
  }

  protected regeneratePassword(): void {
    this.form.controls.password.setValue(generatePassword());
    this.showPassword.set(true);
  }

  protected async copy(value: string, what: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(value);
      this.copied.set(what);
      setTimeout(() => this.copied.set(null), 2000);
    } catch {
      // Clipboard access is denied over plain http and in some locked-down
      // browsers. The value is on screen and selectable, so this is a missing
      // shortcut rather than a missing capability — nothing to report.
    }
  }

  protected async create(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.saveError.set('Пополнете ги задолжителните полиња означени со црвено.');
      return;
    }

    this.saving.set(true);
    this.saveError.set(null);
    const v = this.form.getRawValue();

    try {
      await this.admin.createCustomer({
        account: {
          email: v.loginEmail.trim(),
          password: v.password,
          displayName: v.contactPerson.trim() || v.name.trim(),
        },
        company: {
          name: v.name.trim(),
          taxNumber: v.taxNumber.trim(),
          vatNumber: v.isVatRegistered ? v.vatNumber.trim() : '',
          isVatRegistered: v.isVatRegistered,
          registrationNumber: v.registrationNumber.trim(),
          address: {
            streetAddress: v.streetAddress.trim(),
            streetNumber: v.streetNumber.trim(),
            postalCode: v.postalCode.trim(),
            city: v.city.trim(),
            countryCode: 'MK',
            countryName: 'Северна Македонија',
          },
          email: v.email.trim(),
          phone: v.phone.trim(),
          contactPerson: v.contactPerson.trim(),
          // One account is what the form collects; the customer adds the rest
          // under Поставки. Sent as an empty list rather than a blank record so
          // the invoice footer does not print an empty bank line.
          bankAccounts: v.accountNumber.trim()
            ? [
                {
                  id: newId(),
                  bankName: v.bankName.trim(),
                  accountNumber: v.accountNumber.trim(),
                  isPrimary: true,
                },
              ]
            : [],
        },
        subscription: {
          paidUntil: v.paidUntil,
          plan: v.preset === 'trial30' ? 'trial' : 'paid',
          note: v.note.trim(),
        },
      });

      this.issued.set({
        email: v.loginEmail.trim(),
        password: v.password,
        companyName: v.name.trim(),
      });
    } catch (error) {
      this.saveError.set((error as Error)?.message ?? 'Создавањето не успеа.');
    } finally {
      this.saving.set(false);
    }
  }

  protected finish(): void {
    this.ref.close(this.issued());
  }
}

/**
 * The message the operator sends on. Written as a pure function so the wording
 * can be changed — and read — without going through the template, the same way
 * the invoice share text is handled.
 */
export function welcomeMessage(credentials: IssuedCredentials, appUrl: string): string {
  return [
    'Почитувани,',
    '',
    `Вашата сметка за е-Фактура е подготвена. Податоците за „${credentials.companyName}“ се веќе внесени — можете веднаш да издавате фактури.`,
    '',
    `Адреса: ${appUrl}`,
    `Е-пошта: ${credentials.email}`,
    `Лозинка: ${credentials.password}`,
    '',
    // Points at the reset flow that actually exists, on the login page. There
    // is no change-password screen inside the app, so telling them to "change
    // it in settings" would send them looking for something that is not there.
    'Лозинката можете да ја промените преку „Заборавена лозинка?“ на страницата за најава.',
    '',
    'Со почит,',
  ].join('\n');
}
