import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatTooltipModule } from '@angular/material/tooltip';
import { CatalogService } from '../../core/data/catalog.service';
import { CodebookService } from '../../core/data/codebook.service';
import { CATALOG_LIMITS, type CatalogItem } from '../../core/models/catalog.model';
import type { PriceMode } from '../../core/models/invoice.model';
import { resolveIndicator } from '../../core/ujp/codebooks';

export interface CatalogItemDialogData {
  entry: CatalogItem;
  isNew: boolean;
}

/**
 * Add or edit one price-list entry.
 *
 * The fields are exactly the ones an invoice line takes from the entry, with
 * the same controls the editor uses for them, so what is entered here is what
 * lands on the line.
 */
@Component({
  selector: 'app-catalog-item-dialog',
  imports: [
    ReactiveFormsModule,
    MatAutocompleteModule,
    MatButtonModule,
    MatDialogModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSelectModule,
    MatTooltipModule,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './catalog-item.dialog.html',
  styleUrl: './catalog-item.dialog.scss',
})
export class CatalogItemDialog {
  private readonly fb = inject(FormBuilder);
  private readonly catalog = inject(CatalogService);
  private readonly codebooks = inject(CodebookService).codebooks;
  protected readonly ref = inject(MatDialogRef<CatalogItemDialog, CatalogItem | null>);
  protected readonly data = inject<CatalogItemDialogData>(MAT_DIALOG_DATA);

  protected readonly limits = CATALOG_LIMITS;
  protected readonly saving = signal(false);
  protected readonly saveError = signal<string | null>(null);

  protected readonly form = this.fb.nonNullable.group({
    name: [
      this.data.entry.name,
      [Validators.required, Validators.maxLength(CATALOG_LIMITS.name)],
    ],
    sku: [this.data.entry.sku, Validators.maxLength(CATALOG_LIMITS.sku)],
    unit: [this.data.entry.unit, [Validators.required, Validators.maxLength(CATALOG_LIMITS.unit)]],
    unitPrice: [this.data.entry.unitPrice as number | null, [Validators.required, Validators.min(0)]],
    priceMode: [this.data.entry.priceMode as PriceMode],
    taxIndicator: [this.data.entry.taxIndicator, Validators.required],
  });

  private readonly unitValue = toSignal(this.form.controls.unit.valueChanges, {
    initialValue: this.form.controls.unit.value,
  });
  private readonly indicatorValue = toSignal(this.form.controls.taxIndicator.valueChanges, {
    initialValue: this.form.controls.taxIndicator.value,
  });

  /** Units narrowed by what has been typed, the way the editor's field works. */
  protected readonly units = computed(() => {
    const typed = (this.unitValue() ?? '').trim().toLowerCase();
    const all = this.codebooks().units;
    return typed
      ? all.filter((u) => u.code.toLowerCase().includes(typed) || u.name.toLowerCase().includes(typed))
      : all;
  });

  /**
   * The common indicators, plus the entry's own if it is one of the rare ones —
   * otherwise editing an entry saved with a granular code would show a blank.
   */
  protected readonly indicators = computed(() => {
    const all = this.codebooks().taxIndicators;
    const current = this.indicatorValue();
    return all.filter((i) => i.common || i.code === current);
  });

  protected readonly allowsGrossPrice = computed(
    () => resolveIndicator(this.codebooks(), this.indicatorValue() ?? '')?.allowsGrossPrice ?? false,
  );

  protected togglePriceMode(): void {
    const control = this.form.controls.priceMode;
    control.setValue(control.value === 'gross' ? 'net' : 'gross');
  }

  protected async save(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.saveError.set('Пополнете ги задолжителните полиња означени со црвено.');
      return;
    }

    const v = this.form.getRawValue();
    const resolved = resolveIndicator(this.codebooks(), v.taxIndicator);
    if (!resolved) {
      this.saveError.set('Непозната даночна шифра.');
      return;
    }

    this.saving.set(true);
    this.saveError.set(null);
    try {
      const saved = await this.catalog.save({
        ...this.data.entry,
        name: v.name,
        sku: v.sku,
        unit: v.unit,
        unitPrice: Number(v.unitPrice) || 0,
        // Same rule as the editor: no "with VAT" price where no VAT is added.
        priceMode: resolved.allowsGrossPrice ? v.priceMode : 'net',
        taxIndicator: resolved.taxIndicator,
        vatGroup: resolved.vatGroup,
        vatRate: resolved.vatRate,
      });
      this.ref.close(saved);
    } catch (error) {
      this.saveError.set(`Зачувувањето не успеа: ${(error as Error)?.message ?? error}`);
    } finally {
      this.saving.set(false);
    }
  }
}
