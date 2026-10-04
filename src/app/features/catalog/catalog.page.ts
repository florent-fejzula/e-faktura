import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatDividerModule } from '@angular/material/divider';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatMenuModule } from '@angular/material/menu';
import { MatSnackBar } from '@angular/material/snack-bar';
import { switchMap } from 'rxjs';
import { CatalogService } from '../../core/data/catalog.service';
import { CodebookService } from '../../core/data/codebook.service';
import { CompanyService } from '../../core/data/company.service';
import type { CatalogItem } from '../../core/models/catalog.model';
import { indicatorShortLabel } from '../../core/ujp/codebooks';
import { matchesSearch } from '../../core/util/id';
import { ConfirmDialog, type ConfirmData } from '../../shared/confirm.dialog';
import { FORMAT_PIPES } from '../../shared/format.pipes';
import { CatalogItemDialog, type CatalogItemDialogData } from './catalog-item.dialog';

/**
 * The Ценовник module: what the company sells, at what price.
 *
 * Laid out like the client list on purpose — same search, same rows, same
 * actions — so the second list in the app needs no learning. Entries are
 * picked on the invoice line's description field.
 */
@Component({
  selector: 'app-catalog-page',
  imports: [
    FormsModule,
    MatButtonModule,
    MatDividerModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatMenuModule,
    ...FORMAT_PIPES,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './catalog.page.html',
  // Shares the client list's stylesheet so the two lists cannot drift apart.
  styleUrls: ['../clients/client-list.page.scss', './catalog.page.scss'],
})
export class CatalogPage {
  private readonly catalog = inject(CatalogService);
  private readonly codebooks = inject(CodebookService).codebooks;
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);
  protected readonly companies = inject(CompanyService);

  private readonly loaded = toSignal(
    toObservable(this.companies.activeCompanyId).pipe(switchMap((id) => this.catalog.list(id))),
    { initialValue: undefined },
  );

  protected readonly loading = computed(() => this.loaded() === undefined);
  protected readonly search = signal('');
  protected readonly total = computed(() => this.loaded()?.length ?? 0);

  protected readonly entries = computed<CatalogItem[]>(() => {
    const query = this.search().trim();
    const all = this.loaded() ?? [];
    const list = query ? all.filter((e) => matchesSearch(`${e.name} ${e.sku}`, query)) : all;
    return [...list].sort((a, b) => a.name.localeCompare(b.name, 'mk'));
  });

  protected readonly currency = computed(
    () => this.companies.activeCompany()?.defaults.currency ?? 'MKD',
  );

  protected taxLabel(entry: CatalogItem): string {
    return indicatorShortLabel(this.codebooks(), entry.taxIndicator);
  }

  protected async openDialog(existing?: CatalogItem): Promise<void> {
    const company = this.companies.activeCompany();
    if (!company) return;
    const data: CatalogItemDialogData = {
      entry: existing ?? this.catalog.blank(company),
      isNew: !existing,
    };
    const saved = await this.dialog
      .open(CatalogItemDialog, { data, maxWidth: '96vw' })
      .afterClosed()
      .toPromise();
    if (saved) {
      this.snackBar.open(existing ? 'Ставката е ажурирана.' : 'Ставката е додадена.', 'Во ред');
    }
  }

  protected async remove(entry: CatalogItem): Promise<void> {
    const data: ConfirmData = {
      title: 'Бришење од ценовникот',
      message:
        `Да го избришеме „${entry.name}“ од ценовникот? ` +
        'Фактурите во кои е користен остануваат непроменети.',
      confirmLabel: 'Избриши',
      destructive: true,
    };
    const confirmed = await this.dialog.open(ConfirmDialog, { data }).afterClosed().toPromise();
    if (!confirmed) return;

    await this.catalog.remove(entry.companyId, entry.id);
    this.snackBar.open('Ставката е избришана од ценовникот.', 'Во ред');
  }
}
