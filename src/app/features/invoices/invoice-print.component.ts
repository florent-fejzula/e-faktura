import { ChangeDetectionStrategy, Component, computed, effect, input, signal } from '@angular/core';
import { formatAddress } from '../../core/models/common.model';
import type { ComputedLine, Invoice, VatTotalLine } from '../../core/models/invoice.model';
import type { InvoiceTotals } from '../../core/models/invoice.model';
import { FORMAT_PIPES } from '../../shared/format.pipes';

/**
 * The printable invoice — the document the buyer actually receives.
 *
 * Rendered off-screen at all times and revealed only by the print stylesheet,
 * so "Печати" produces a proper A4 invoice rather than a screenshot of the
 * editor. Printing to PDF through the browser is deliberate: it renders the
 * Cyrillic text with the page's own webfont, which a client-side PDF library
 * would need a bundled Cyrillic font to match.
 *
 * Once a document has been through УЈП, `GET /documents/sales-invoice/pdf`
 * returns the official PDF and that becomes the authoritative copy; this
 * remains the pre-submission and non-UJP rendering.
 */
@Component({
  selector: 'app-invoice-print',
  imports: [...FORMAT_PIPES],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './invoice-print.component.html',
  styleUrl: './invoice-print.component.scss',
})
export class InvoicePrintComponent {
  readonly invoice = input.required<Invoice>();
  readonly lines = input.required<ComputedLine[]>();
  readonly totals = input.required<InvoiceTotals>();
  readonly vatTotals = input.required<VatTotalLine[]>();
  readonly amountInWords = input('');

  protected readonly formatAddress = formatAddress;

  /** Data URL for the УЈП verification QR, generated only when there is one. */
  protected readonly qrDataUrl = signal<string | null>(null);

  protected readonly hasDiscount = computed(() =>
    this.lines().some((line) => line.item.discountPercent > 0),
  );

  /** Distinct tax-indicator notes, printed once under the totals. */
  protected readonly taxNotes = computed(() => {
    const seen = new Set<string>();
    const notes: string[] = [];
    for (const row of this.vatTotals()) {
      if (row.taxIndicatorNote && !seen.has(row.taxIndicatorNote)) {
        seen.add(row.taxIndicatorNote);
        notes.push(row.taxIndicatorNote);
      }
    }
    return notes;
  });

  constructor() {
    effect(() => {
      const link = this.invoice().ujp?.qrLink;
      if (!link) {
        this.qrDataUrl.set(null);
        return;
      }
      // Loaded lazily: the QR library is only needed for submitted invoices,
      // and should not weigh on the editor's initial chunk.
      void import('qrcode').then((qrcode) =>
        qrcode
          .toDataURL(link, { margin: 0, width: 220, errorCorrectionLevel: 'M' })
          .then((url) => this.qrDataUrl.set(url))
          .catch(() => this.qrDataUrl.set(null)),
      );
    });
  }
}
