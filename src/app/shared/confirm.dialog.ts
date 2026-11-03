import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';

export interface ConfirmData {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Colours the confirm button as a destructive action. */
  destructive?: boolean;
  /** Things worth a look before confirming, under `notesTitle`. */
  notes?: string[];
  notesTitle?: string;
}

@Component({
  selector: 'app-confirm-dialog',
  imports: [MatDialogModule, MatButtonModule, MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h2 mat-dialog-title>{{ data.title }}</h2>
    <mat-dialog-content>
      <p class="message">{{ data.message }}</p>
      @if (data.notes?.length) {
        <div class="notes">
          <mat-icon>info</mat-icon>
          <div>
            @if (data.notesTitle) {
              <strong>{{ data.notesTitle }}</strong>
            }
            <ul>
              @for (note of data.notes; track note) {
                <li>{{ note }}</li>
              }
            </ul>
          </div>
        </div>
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button type="button" (click)="ref.close(false)">
        {{ data.cancelLabel ?? 'Откажи' }}
      </button>
      <button
        mat-flat-button
        type="button"
        [class.destructive]="data.destructive"
        (click)="ref.close(true)"
      >
        {{ data.confirmLabel ?? 'Потврди' }}
      </button>
    </mat-dialog-actions>
  `,
  styles: `
    .message {
      margin: 0;
      max-width: 44ch;
      color: var(--mat-sys-on-surface-variant);
      line-height: 1.5;
    }
    .notes {
      display: flex;
      gap: 10px;
      max-width: 44ch;
      margin-top: 16px;
      padding: 10px 12px;
      border-radius: 12px;
      background: var(--mat-sys-surface-container-high);
      font: var(--mat-sys-body-medium);

      mat-icon {
        flex: none;
        color: var(--mat-sys-primary);
      }

      ul {
        margin: 4px 0 0;
        padding-inline-start: 18px;
        color: var(--mat-sys-on-surface-variant);
      }
    }
    .destructive {
      --mdc-filled-button-container-color: var(--mat-sys-error);
      --mdc-filled-button-label-text-color: var(--mat-sys-on-error);
    }
  `,
})
export class ConfirmDialog {
  protected readonly ref = inject(MatDialogRef<ConfirmDialog, boolean>);
  protected readonly data = inject<ConfirmData>(MAT_DIALOG_DATA);
}
