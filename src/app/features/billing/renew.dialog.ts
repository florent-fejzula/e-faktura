import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import type { Company } from '../../core/models/company.model';
import { daysRemaining, subscriptionState } from '../../core/models/company.model';
import { formatDate } from '../../core/util/dates';
import { mailtoHref } from '../../core/util/share';
import { environment } from '../../../environments/environment';

export interface RenewDialogData {
  company: Company;
}

/**
 * How to pay.
 *
 * The screen a customer reaches when their subscription lapses used to say what
 * had stopped and nothing about what to do next, which is a dead end — someone
 * willing to pay had no price, no account number and no one to call. This is
 * that missing half.
 *
 * The primary action is not "here are the details, good luck": it is a
 * one-click e-mail requesting an invoice, already carrying the company's name
 * and ЕДБ, because the operator has to issue a real invoice anyway and that
 * message is what starts it.
 */
@Component({
  selector: 'app-renew-dialog',
  imports: [MatDialogModule, MatButtonModule, MatIconModule, MatTooltipModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './renew.dialog.html',
  styleUrl: './renew.dialog.scss',
})
export class RenewDialog {
  protected readonly ref = inject(MatDialogRef<RenewDialog, void>);
  protected readonly data = inject<RenewDialogData>(MAT_DIALOG_DATA);
  private readonly snackBar = inject(MatSnackBar);

  protected readonly billing = environment.billing;
  private readonly company = this.data.company;

  protected readonly state = computed(() => subscriptionState(this.company.subscription));
  protected readonly daysLeft = computed(() => daysRemaining(this.company.subscription));

  protected readonly paidUntilLabel = computed(() => {
    const until = this.company.subscription?.paidUntil;
    return until ? formatDate(until) : '—';
  });

  protected readonly headline = computed(() => {
    const left = this.daysLeft();
    if (this.state() === 'none') return 'Претплата';
    if (left < 0) return 'Претплатата истече';
    if (left === 0) return 'Претплатата истекува денес';
    return `Претплатата истекува за ${left} ${left === 1 ? 'ден' : 'дена'}`;
  });

  /** Payment reference, so the operator can match the transfer to the payer. */
  protected readonly reference = computed(() => this.company.taxNumber || this.company.name);

  /**
   * Opens a prefilled request for an invoice. This is the conversion step —
   * everything else on the dialog is reference material.
   */
  protected requestInvoice(): void {
    const subject = `Барање за фактура — претплата — ${this.company.name}`;
    const body = [
      'Почитувани,',
      '',
      'Ве молам испратете ми фактура за годишна претплата за е-Фактура.',
      '',
      `Фирма: ${this.company.name}`,
      `ЕДБ: ${this.company.taxNumber}`,
      this.company.address?.city ? `Град: ${this.company.address.city}` : '',
      this.company.email ? `Е-пошта: ${this.company.email}` : '',
      '',
      'Со почит.',
    ]
      .filter(Boolean)
      .join('\n');

    window.location.href = mailtoHref(this.billing.contactEmail, subject, body);
  }

  protected async copyAccount(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.billing.bankAccount);
      this.snackBar.open('Сметката е копирана.', 'Во ред', { duration: 3000 });
    } catch {
      this.snackBar.open('Копирањето не успеа.', 'Затвори');
    }
  }
}
