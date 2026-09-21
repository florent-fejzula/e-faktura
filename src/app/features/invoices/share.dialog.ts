import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import type { Invoice } from '../../core/models/invoice.model';
import {
  mailtoHref,
  shareBody,
  shareSubject,
  viberHref,
  whatsappHref,
} from '../../core/util/share';

export interface ShareDialogData {
  invoice: Invoice;
}

/**
 * Sends an invoice to the buyer.
 *
 * The message is editable before it goes out, because the useful version is
 * almost always "the standard text plus one sentence". Each channel is a plain
 * link the operating system routes: `mailto:` for e-mail, `wa.me` for WhatsApp,
 * `viber://forward` for Viber, and the native share sheet where the browser
 * offers one — which on a phone is what actually reaches Messenger, Telegram
 * and the rest without this dialog needing to know about them.
 *
 * The document itself is not attached. A page cannot put a file into a
 * `mailto:` draft or a WhatsApp web intent; the PDF is produced by the browser's
 * own print dialog and attached by the sender, which is also the only route
 * that renders Cyrillic with the invoice's real font.
 */
@Component({
  selector: 'app-share-dialog',
  imports: [
    FormsModule,
    MatDialogModule,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatTooltipModule,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './share.dialog.html',
  styleUrl: './share.dialog.scss',
})
export class ShareDialog {
  protected readonly ref = inject(MatDialogRef<ShareDialog, 'print' | null>);
  protected readonly data = inject<ShareDialogData>(MAT_DIALOG_DATA);
  private readonly snackBar = inject(MatSnackBar);

  private readonly invoice = this.data.invoice;

  protected readonly subject = shareSubject(this.invoice);
  protected readonly email = signal(this.invoice.client.email ?? '');
  protected readonly phone = signal(this.invoice.client.phone ?? '');
  protected readonly message = signal(shareBody(this.invoice));

  /** `navigator.share` exists on phones and on some desktop browsers. */
  protected readonly canNativeShare = typeof navigator !== 'undefined' && 'share' in navigator;

  protected readonly hasEmail = computed(() => this.email().includes('@'));

  protected sendEmail(): void {
    if (!this.hasEmail()) return;
    this.open(mailtoHref(this.email(), this.subject, this.message()));
  }

  protected sendWhatsApp(): void {
    this.open(whatsappHref(this.message(), this.phone()));
  }

  protected sendViber(): void {
    this.open(viberHref(this.message()));
  }

  protected async copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.message());
      this.snackBar.open('Пораката е копирана.', 'Во ред', { duration: 3000 });
    } catch {
      this.snackBar.open('Копирањето не успеа — обележете го текстот рачно.', 'Затвори');
    }
  }

  protected async nativeShare(): Promise<void> {
    try {
      await navigator.share({ title: this.subject, text: this.message() });
    } catch (error) {
      // An abandoned share sheet rejects with AbortError; that is not a fault.
      if ((error as Error)?.name !== 'AbortError') {
        this.snackBar.open('Споделувањето не успеа.', 'Затвори');
      }
    }
  }

  /** Hands the print request back to the editor, which owns the print view. */
  protected printPdf(): void {
    this.ref.close('print');
  }

  private open(href: string): void {
    window.open(href, '_blank', 'noopener');
  }
}
