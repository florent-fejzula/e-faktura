import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { CompanyService } from '../../core/data/company.service';
import { NUMBERING_PRESETS, previewNumbering } from '../../core/data/numbering';
import { defaultCompanyDefaults, defaultNumbering } from '../../core/models/company.model';
import { SEED_PAYMENT_TYPES, SEED_UNITS } from '../../core/ujp/codebooks';
import { todayIso } from '../../core/util/dates';
import { newId } from '../../core/util/id';

/**
 * First-run company setup.
 *
 * Split into three short steps rather than one long form: the data UJP demands
 * (a split address, a 13-digit ЕДБ, VAT status) is more than anyone wants to
 * face on a single screen, and getting it wrong here poisons every invoice the
 * company will ever issue.
 */
@Component({
  selector: 'app-onboarding-page',
  imports: [
    ReactiveFormsModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatIconModule,
    MatSelectModule,
    MatCheckboxModule,
    MatProgressBarModule,
    RouterLink,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './onboarding.page.html',
  styleUrl: './onboarding.page.scss',
})
export class OnboardingPage {
  private readonly fb = inject(FormBuilder);
  private readonly companies = inject(CompanyService);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly snackBar = inject(MatSnackBar);

  protected readonly paymentTypes = SEED_PAYMENT_TYPES;
  protected readonly units = SEED_UNITS;
  protected readonly presets = NUMBERING_PRESETS;

  private readonly route = inject(ActivatedRoute);

  /**
   * True when an existing user is adding another company from the switcher,
   * rather than being walked through first-run setup. Changes the wording and
   * gives them a way back out — this is optional, first-run is not.
   */
  protected readonly isAdditional =
    this.route.snapshot.queryParamMap.get('nova') === '1';

  protected readonly step = signal(0);
  protected readonly saving = signal(false);
  protected readonly totalSteps = 3;

  protected readonly identity = this.fb.nonNullable.group({
    name: ['', [Validators.required, Validators.maxLength(80)]],
    taxNumber: ['', [Validators.required, Validators.pattern(/^\d{13}$/)]],
    registrationNumber: [''],
    isVatRegistered: [true],
    vatNumber: [''],
  });

  protected readonly contact = this.fb.nonNullable.group({
    streetAddress: ['', Validators.required],
    streetNumber: ['', Validators.required],
    postalCode: ['', [Validators.required, Validators.pattern(/^\d{4}$/)]],
    city: ['', Validators.required],
    email: ['', Validators.email],
    phone: [''],
    bankName: [''],
    accountNumber: [''],
  });

  protected readonly preferences = this.fb.nonNullable.group({
    pattern: ['{SEQ}/{YYYY}', Validators.required],
    prefix: [''],
    padding: [4, [Validators.min(0), Validators.max(10)]],
    nextSeq: [1, [Validators.required, Validators.min(1)]],
    dueDays: [15, [Validators.min(0), Validators.max(365)]],
    paymentTypeCode: ['P12', Validators.required],
    unit: ['ком', Validators.required],
  });

  /** Live example of the first number this company will issue. */
  protected readonly numberPreview = computed(() => {
    const v = this.previewSource();
    return previewNumbering(
      {
        ...defaultNumbering(),
        pattern: v.pattern,
        prefix: v.prefix,
        padding: v.padding,
        nextSeq: v.nextSeq,
        periodKey: String(new Date().getFullYear()),
        reset: 'yearly',
      },
      todayIso(),
    );
  });

  /** Mirrors the preferences form into a signal so `computed` can track it. */
  private readonly previewSource = signal(this.preferences.getRawValue());

  constructor() {
    this.preferences.valueChanges.subscribe(() =>
      this.previewSource.set(this.preferences.getRawValue()),
    );

    // A VAT-registered company's ДДВ number is its ЕДБ with a МК prefix, so
    // fill it in automatically rather than making the user retype 13 digits.
    this.identity.controls.taxNumber.valueChanges.subscribe((value) => {
      if (this.identity.controls.isVatRegistered.value && /^\d{13}$/.test(value)) {
        this.identity.controls.vatNumber.setValue(`МК${value}`, { emitEvent: false });
      }
    });
    this.identity.controls.isVatRegistered.valueChanges.subscribe((registered) => {
      const tax = this.identity.controls.taxNumber.value;
      this.identity.controls.vatNumber.setValue(
        registered && /^\d{13}$/.test(tax) ? `МК${tax}` : '',
        { emitEvent: false },
      );
    });
  }

  protected readonly userName = computed(
    () => this.auth.user()?.displayName?.split(' ')[0] ?? '',
  );

  protected next(): void {
    const group = this.step() === 0 ? this.identity : this.contact;
    if (group.invalid) {
      group.markAllAsTouched();
      return;
    }
    this.step.update((s) => Math.min(s + 1, this.totalSteps - 1));
  }

  protected back(): void {
    this.step.update((s) => Math.max(s - 1, 0));
  }

  protected async finish(): Promise<void> {
    if (this.identity.invalid || this.contact.invalid || this.preferences.invalid) {
      this.identity.markAllAsTouched();
      this.contact.markAllAsTouched();
      this.preferences.markAllAsTouched();
      this.step.set(this.identity.invalid ? 0 : this.contact.invalid ? 1 : 2);
      return;
    }

    this.saving.set(true);
    try {
      const id = this.identity.getRawValue();
      const c = this.contact.getRawValue();
      const p = this.preferences.getRawValue();

      await this.companies.create({
        name: id.name,
        taxNumber: id.taxNumber,
        vatNumber: id.vatNumber,
        isVatRegistered: id.isVatRegistered,
        registrationNumber: id.registrationNumber,
        address: {
          streetAddress: c.streetAddress,
          streetNumber: c.streetNumber,
          postalCode: c.postalCode,
          city: c.city,
          countryCode: 'MK',
          countryName: 'Северна Македонија',
        },
        email: c.email,
        phone: c.phone,
        bankAccounts: c.accountNumber
          ? [
              {
                id: newId(),
                bankName: c.bankName,
                accountNumber: c.accountNumber,
                isPrimary: true,
              },
            ]
          : [],
        numbering: {
          ...defaultNumbering(),
          pattern: p.pattern,
          prefix: p.prefix,
          padding: p.padding,
          nextSeq: p.nextSeq,
        },
        defaults: {
          ...defaultCompanyDefaults(),
          dueDays: p.dueDays,
          paymentTypeCode: p.paymentTypeCode,
          unit: p.unit,
          taxIndicator: id.isVatRegistered ? 'DDV-A' : 'DDV-G',
        },
      });

      await this.router.navigate(['/fakturi']);
      this.snackBar.open(
        this.isAdditional
          ? 'Фирмата е додадена и е активна. Менувајте ја горе лево.'
          : 'Фирмата е зачувана. Можете да издадете прва фактура.',
        'Во ред',
      );
    } catch (error) {
      this.snackBar.open(
        `Неуспешно зачувување: ${(error as Error)?.message ?? error}`,
        'Затвори',
        { duration: 8000 },
      );
    } finally {
      this.saving.set(false);
    }
  }

  protected applyPreset(pattern: string): void {
    this.preferences.controls.pattern.setValue(pattern);
  }
}
