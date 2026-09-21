import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTabsModule } from '@angular/material/tabs';
import { MatTooltipModule } from '@angular/material/tooltip';
import type { Invoice } from '../../core/models/invoice.model';
import type { CodebookSet } from '../../core/ujp/codebooks';
import { buildUjpPayload } from '../../core/ujp/ujp-document.builder';
import { UjpSigner } from '../../core/ujp/ujp-signer';
import { validateInvoice } from '../../core/ujp/ujp-validator';

export interface UjpPreviewData {
  invoice: Invoice;
  codebooks: CodebookSet;
}

/**
 * Shows the exact document that would be signed and sent to УЈП, next to the
 * pre-flight validation results.
 *
 * This is the main way to be confident about a submission before a signing
 * certificate exists: the payload here is produced by the same builder the
 * real submission uses, so what is inspected is what would be sent.
 */
@Component({
  selector: 'app-ujp-preview-dialog',
  imports: [
    MatDialogModule,
    MatButtonModule,
    MatIconModule,
    MatTabsModule,
    MatTooltipModule,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './ujp-preview.dialog.html',
  styleUrl: './ujp-preview.dialog.scss',
})
export class UjpPreviewDialog {
  protected readonly ref = inject(MatDialogRef<UjpPreviewDialog>);
  protected readonly data = inject<UjpPreviewData>(MAT_DIALOG_DATA);
  private readonly snackBar = inject(MatSnackBar);
  protected readonly signer = inject(UjpSigner);

  protected readonly signerStatus = this.signer.status();

  protected readonly payload = computed(() =>
    buildUjpPayload(this.data.invoice, this.data.codebooks),
  );

  protected readonly json = computed(() => JSON.stringify(this.payload(), null, 2));

  protected readonly validation = computed(() =>
    validateInvoice(this.data.invoice, this.data.codebooks),
  );

  protected readonly copied = signal(false);

  protected async copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.json());
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 2000);
    } catch {
      this.snackBar.open('Копирањето не успеа. Обележете го текстот рачно.', 'Во ред');
    }
  }

  protected download(): void {
    const invoice = this.data.invoice;
    const blob = new Blob([this.json()], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `ujp-${invoice.number || invoice.id}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }
}
