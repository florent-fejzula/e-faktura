import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { UJP_STATUS_LABELS, type PaymentStatus, type UjpStatusCode } from '../core/models/invoice.model';

type Tone = 'neutral' | 'info' | 'success' | 'warn' | 'danger';

const STATUS_TONE: Record<UjpStatusCode, Tone> = {
  '00': 'neutral', // Нацрт
  '01': 'info', // Испратена
  '03': 'success', // Прифатена
  '04': 'success', // Автоматски прифатена
  '05': 'danger', // Одбиена
  '07': 'danger', // Сторнирана
  '09': 'warn', // Корегирана
  '10': 'info', // Евидентирана
};

const PAYMENT_LABELS: Record<PaymentStatus, string> = {
  unpaid: 'Неплатена',
  partial: 'Делумно',
  paid: 'Платена',
};

const PAYMENT_TONE: Record<PaymentStatus, Tone> = {
  unpaid: 'neutral',
  partial: 'warn',
  paid: 'success',
};

/** Compact status pill used in the list, the editor header and the print view. */
@Component({
  selector: 'app-status-chip',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<span class="chip" [attr.data-tone]="tone()">{{ label() }}</span>`,
  styles: `
    .chip {
      display: inline-flex;
      align-items: center;
      padding: 3px 10px;
      border-radius: 999px;
      font: var(--mat-sys-label-small);
      white-space: nowrap;
    }
    .chip[data-tone='neutral'] {
      background: var(--mat-sys-surface-container-high);
      color: var(--mat-sys-on-surface-variant);
    }
    .chip[data-tone='info'] {
      background: color-mix(in srgb, var(--mat-sys-primary) 14%, transparent);
      color: var(--mat-sys-primary);
    }
    .chip[data-tone='success'] {
      background: color-mix(in srgb, #1b8a4b 16%, transparent);
      color: #0f6b38;
    }
    .chip[data-tone='warn'] {
      background: color-mix(in srgb, #b26a00 18%, transparent);
      color: #8a5200;
    }
    .chip[data-tone='danger'] {
      background: var(--mat-sys-error-container);
      color: var(--mat-sys-on-error-container);
    }
  `,
})
export class StatusChipComponent {
  /** UJP document status. Takes precedence when both are supplied. */
  readonly status = input<UjpStatusCode | null>(null);
  /** Payment status, shown when no UJP status is given. */
  readonly payment = input<PaymentStatus | null>(null);

  /**
   * Whether the document has been issued locally. A `00` document that has
   * been issued is no longer a draft, even though УЈП has no code for it.
   */
  readonly issued = input(false);

  protected readonly label = computed(() => {
    const status = this.status();
    if (status === '00' && this.issued()) return 'Издадена';
    if (status) return UJP_STATUS_LABELS[status] ?? status;
    const payment = this.payment();
    return payment ? PAYMENT_LABELS[payment] : '';
  });

  protected readonly tone = computed<Tone>(() => {
    const status = this.status();
    if (status === '00' && this.issued()) return 'info';
    if (status) return STATUS_TONE[status] ?? 'neutral';
    const payment = this.payment();
    return payment ? PAYMENT_TONE[payment] : 'neutral';
  });
}
