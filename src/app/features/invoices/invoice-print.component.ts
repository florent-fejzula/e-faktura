import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { PrintSettingsService } from '../../core/data/print-settings.service';
import { formatAddress } from '../../core/models/common.model';
import { PRINT_TITLES, printSettings } from '../../core/models/company.model';
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

  private readonly printSettings = inject(PrintSettingsService);

  protected readonly formatAddress = formatAddress;

  /** Heading and logo placement, as frozen into the seller snapshot. */
  protected readonly layout = computed(() => printSettings(this.invoice().seller));
  protected readonly title = computed(() => PRINT_TITLES[this.layout().title].toUpperCase());

  /** Which logo to show — changes rarely, while the invoice changes on every keystroke. */
  private readonly logoRef = computed(
    () => {
      const invoice = this.invoice();
      const logoId = invoice.seller.logoId;
      return logoId ? { companyId: invoice.companyId, logoId } : null;
    },
    { equal: (a, b) => a?.logoId === b?.logoId && a?.companyId === b?.companyId },
  );

  /** The logo image, loaded from its own document once per session. */
  protected readonly logoUrl = signal<string | null>(null);

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
    effect((onCleanup) => {
      const ref = this.logoRef();
      if (!ref) {
        this.logoUrl.set(null);
        return;
      }
      let current = true;
      onCleanup(() => (current = false));
      void this.printSettings
        .logoUrl(ref.companyId, ref.logoId)
        .then((url) => current && this.logoUrl.set(url));
    });

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
