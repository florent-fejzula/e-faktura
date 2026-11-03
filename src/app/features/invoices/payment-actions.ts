import { Injectable, inject } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { InvoiceService } from '../../core/data/invoice.service';
import { docLabel, paymentStatusFor, type Invoice } from '../../core/models/invoice.model';
import { formatDate, toIsoDate, todayIso, type IsoDate } from '../../core/util/dates';
import { formatMoney, round2 } from '../../core/util/money';

/**
 * Records payments, and offers to take each one back.
 *
 * Marking an invoice paid is a click or two from the list, so a wrong click has
 * to cost nothing: every change is followed by "Врати", which puts back exactly
 * what was there before — the amount and the date.
 */
@Injectable({ providedIn: 'root' })
export class PaymentActions {
  private readonly invoices = inject(InvoiceService);
  private readonly snackBar = inject(MatSnackBar);

  async record(invoice: Invoice, paidAmount: number, paidAt: number | null): Promise<void> {
    const before = { paidAmount: invoice.paidAmount ?? 0, paidAt: invoice.paidAt ?? null };
    await this.invoices.setPayment(invoice, paidAmount, paidAt);

    this.snackBar
      .open(describe(invoice, paidAmount, paidAt), 'Врати', { duration: 8000 })
      .onAction()
      .subscribe(() => {
        this.invoices.setPayment(invoice, before.paidAmount, before.paidAt).then(
          () => this.snackBar.open('Вратено како што беше.', undefined, { duration: 3000 }),
          (error) =>
            this.snackBar.open(`Не успеа: ${(error as Error)?.message ?? error}`, 'Затвори', {
              duration: 8000,
            }),
        );
      });
  }
}

/**
 * When the money arrived, as a calendar day — for an invoice that has received
 * any. Older records hold the moment someone clicked, which reads the same way.
 */
export function paidOn(invoice: Pick<Invoice, 'paidAt' | 'paymentStatus'>): IsoDate | null {
  if (invoice.paymentStatus === 'unpaid' || !invoice.paidAt) return null;
  return toIsoDate(new Date(invoice.paidAt));
}

/**
 * The stored moment for a payment received on `date`. Today is now; an earlier
 * day is its noon, well clear of midnight, so the day it reads back as cannot
 * shift with the clock.
 */
export function paidAtFor(date: Date): number {
  if (toIsoDate(date) === todayIso()) return Date.now();
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12).getTime();
}

function describe(invoice: Invoice, paidAmount: number, paidAt: number | null): string {
  const name = invoice.number ? `${docLabel(invoice)} ${invoice.number}` : 'Фактурата';
  const total = invoice.totals.finalAmount;
  switch (paymentStatusFor(round2(paidAmount), total)) {
    case 'paid':
      return paidAt
        ? `${name} е платена на ${formatDate(toIsoDate(new Date(paidAt)))}.`
        : `${name} е платена.`;
    case 'partial':
      return (
        `${name}: платени ${formatMoney(paidAmount, invoice.currency)} ` +
        `од ${formatMoney(total, invoice.currency)}.`
      );
    default:
      return `${name} е означена неплатена.`;
  }
}
