import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { paymentStatusFor, type Invoice } from '../../core/models/invoice.model';
import { fromIsoDate, todayIso } from '../../core/util/dates';
import { formatMoney, round2 } from '../../core/util/money';
import { FORMAT_PIPES } from '../../shared/format.pipes';
import { PaymentActions, paidAtFor } from './payment-actions';

/**
 * When an invoice was paid, and how much of it. Used in the list's payment
 * popover and the invoice's own Наплата panel, so both behave the same.
 *
 * Starts on the common case — the whole amount, today — so marking an invoice
 * paid is a single click on the button. The date is there because the money
 * often arrived a few days before anyone looked at the bank; the amount,
 * because some clients pay in parts.
 */
@Component({
  selector: 'app-payment-form',
  imports: [
    ReactiveFormsModule,
    MatButtonModule,
    MatDatepickerModule,
    MatFormFieldModule,
    MatInputModule,
    ...FORMAT_PIPES,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <form class="pay" [formGroup]="form" (ngSubmit)="save()">
      @if (invoice().paymentStatus === 'partial') {
        <p class="pay__so-far">
          Досега платено <strong>{{ invoice().paidAmount | money: invoice().currency }}</strong>
          од {{ total() | money: invoice().currency }}.
        </p>
      }

      <mat-form-field subscriptSizing="dynamic">
        <mat-label>Платено на</mat-label>
        <input matInput [matDatepicker]="picker" formControlName="date" [max]="today" />
        <mat-datepicker-toggle matIconSuffix [for]="picker" />
        <mat-datepicker #picker />
        <mat-error>Внесете датум, најдоцна денес.</mat-error>
      </mat-form-field>

      <mat-form-field subscriptSizing="dynamic">
        <mat-label>Вкупно платено</mat-label>
        <input
          matInput
          type="number"
          inputmode="decimal"
          step="0.01"
          min="0"
          formControlName="amount"
        />
        <span matTextSuffix>{{ invoice().currency | currencySymbol }}</span>
        <mat-error>Внесете износ.</mat-error>
      </mat-form-field>

      @if (error(); as message) {
        <p class="pay__error" role="alert">{{ message }}</p>
      }

      <div class="pay__actions">
        @if (invoice().paymentStatus !== 'unpaid') {
          <button mat-button type="button" (click)="markUnpaid()" [disabled]="busy()">
            Означи неплатена
          </button>
        }
        <button mat-flat-button type="submit" [disabled]="busy()">{{ primaryLabel() }}</button>
      </div>
    </form>
  `,
  styles: `
    .pay {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    mat-form-field {
      width: 100%;
    }
    .pay__so-far {
      margin: 0;
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-small);
    }
    .pay__error {
      margin: 0;
      color: var(--mat-sys-error);
      font: var(--mat-sys-body-small);
    }
    .pay__actions {
      display: flex;
      flex-wrap: wrap;
      justify-content: flex-end;
      gap: 8px;
    }
  `,
})
export class PaymentFormComponent {
  private readonly payments = inject(PaymentActions);

  readonly invoice = input.required<Invoice>();
  /** A change was saved; the popover closes on it. */
  readonly done = output<void>();

  protected readonly today = fromIsoDate(todayIso())!;
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly form = new FormGroup({
    date: new FormControl<Date | null>(null, Validators.required),
    amount: new FormControl<number | null>(null, [Validators.required, Validators.min(0.01)]),
  });

  protected readonly total = computed(() => this.invoice().totals.finalAmount);

  /** Changes only when the payment itself does, not on every snapshot. */
  private readonly recorded = computed(() => {
    const invoice = this.invoice();
    return `${invoice.id}|${invoice.paymentStatus}|${invoice.paidAmount}|${invoice.paidAt}`;
  });

  constructor() {
    // A paid invoice opens on what was recorded, to be corrected; anything
    // else opens on a full payment today.
    effect(() => {
      this.recorded();
      untracked(() => {
        const invoice = this.invoice();
        const paid = invoice.paymentStatus === 'paid';
        this.form.reset({
          date: paid && invoice.paidAt ? new Date(invoice.paidAt) : fromIsoDate(todayIso()),
          amount: paid ? invoice.paidAmount : invoice.totals.finalAmount,
        });
        this.error.set(null);
      });
    });
  }

  protected primaryLabel(): string {
    const status = this.invoice().paymentStatus;
    const amount = round2(this.form.controls.amount.value ?? 0);
    const full = paymentStatusFor(amount, this.total()) === 'paid';
    if (status === 'paid') return 'Зачувај';
    return full ? 'Означи платена' : 'Означи делумно платена';
  }

  protected async save(): Promise<void> {
    this.error.set(null);
    const { date, amount } = this.form.getRawValue();
    if (this.form.invalid || !date || amount === null) {
      this.form.markAllAsTouched();
      return;
    }
    const invoice = this.invoice();
    if (round2(amount) > this.total() + 0.005) {
      this.error.set(
        `Износот е поголем од фактурата (${formatMoney(this.total(), invoice.currency)}).`,
      );
      return;
    }
    await this.run(() => this.payments.record(invoice, amount, paidAtFor(date)));
  }

  protected async markUnpaid(): Promise<void> {
    await this.run(() => this.payments.record(this.invoice(), 0, null));
  }

  private async run(action: () => Promise<void>): Promise<void> {
    this.busy.set(true);
    try {
      await action();
      this.done.emit();
    } catch (error) {
      this.error.set(`Не успеа: ${(error as Error)?.message ?? error}`);
    } finally {
      this.busy.set(false);
    }
  }
}
