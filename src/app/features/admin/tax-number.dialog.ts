import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { AdminService } from '../../core/data/admin.service';
import type { Company } from '../../core/models/company.model';

export interface TaxNumberDialogData {
  company: Company;
}

/**
 * Corrects a company's ЕДБ. Customers cannot change it themselves — the
 * subscription is sold per ЕДБ — so a typo made during onboarding is fixed here.
 */
@Component({
  selector: 'app-tax-number-dialog',
  imports: [ReactiveFormsModule, MatButtonModule, MatDialogModule, MatFormFieldModule, MatInputModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h2 mat-dialog-title>ЕДБ — {{ data.company.name }}</h2>
    <mat-dialog-content>
      <p class="lede">
        Само за исправка на погрешно внесен број. Издадените фактури го задржуваат ЕДБ со кој се
        издадени, а стариот број се ослободува.
      </p>
      <form (ngSubmit)="save()">
        <mat-form-field class="field">
          <mat-label>ЕДБ</mat-label>
          <input matInput [formControl]="taxNumber" inputmode="numeric" maxlength="13" />
          @if (taxNumber.touched && taxNumber.invalid) {
            <mat-error>13 цифри.</mat-error>
          }
        </mat-form-field>
      </form>
      @if (error(); as message) {
        <p class="error" role="alert">{{ message }}</p>
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button type="button" (click)="ref.close(false)">Откажи</button>
      <button mat-flat-button type="button" [disabled]="saving()" (click)="save()">Зачувај</button>
    </mat-dialog-actions>
  `,
  styles: `
    .lede {
      margin: 0 0 16px;
      max-width: 48ch;
      color: var(--mat-sys-on-surface-variant);
    }
    .field {
      width: 100%;
    }
    .error {
      margin: 4px 0 0;
      color: var(--mat-sys-error);
    }
  `,
})
export class TaxNumberDialog {
  private readonly admin = inject(AdminService);
  protected readonly ref = inject(MatDialogRef<TaxNumberDialog, boolean>);
  protected readonly data = inject<TaxNumberDialogData>(MAT_DIALOG_DATA);

  protected readonly taxNumber = new FormControl(this.data.company.taxNumber ?? '', {
    nonNullable: true,
    validators: [Validators.required, Validators.pattern(/^\d{13}$/)],
  });
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);

  protected async save(): Promise<void> {
    if (this.taxNumber.invalid) {
      this.taxNumber.markAsTouched();
      return;
    }
    this.saving.set(true);
    this.error.set(null);
    try {
      await this.admin.changeTaxNumber(this.data.company, this.taxNumber.value);
      this.ref.close(true);
    } catch (error) {
      this.error.set(`Не успеа: ${(error as Error)?.message ?? error}`);
    } finally {
      this.saving.set(false);
    }
  }
}
