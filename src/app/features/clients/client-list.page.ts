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
import { MatTooltipModule } from '@angular/material/tooltip';
import { Router } from '@angular/router';
import { switchMap } from 'rxjs';
import { ClientService } from '../../core/data/client.service';
import { CompanyService } from '../../core/data/company.service';
import { InvoiceService } from '../../core/data/invoice.service';
import type { Client } from '../../core/models/client.model';
import { formatAddress } from '../../core/models/common.model';
import { matchesSearch } from '../../core/util/id';
import { ConfirmDialog, type ConfirmData } from '../../shared/confirm.dialog';
import { FORMAT_PIPES } from '../../shared/format.pipes';
import { ClientDialog, type ClientDialogData } from './client.dialog';

type ClientSort = 'name' | 'recent' | 'billed' | 'count';

@Component({
  selector: 'app-client-list-page',
  imports: [
    FormsModule,
    MatButtonModule,
    MatIconModule,
    MatFormFieldModule,
    MatInputModule,
    MatMenuModule,
    MatTooltipModule,
    MatDividerModule,
    ...FORMAT_PIPES,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './client-list.page.html',
  styleUrl: './client-list.page.scss',
})
export class ClientListPage {
  private readonly clientService = inject(ClientService);
  private readonly invoiceService = inject(InvoiceService);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);
  private readonly router = inject(Router);
  protected readonly companies = inject(CompanyService);

  protected readonly formatAddress = formatAddress;

  private readonly loaded = toSignal(
    toObservable(this.companies.activeCompanyId).pipe(
      switchMap((id) => this.clientService.list(id)),
    ),
    { initialValue: undefined },
  );

  protected readonly loading = computed(() => this.loaded() === undefined);
  protected readonly search = signal('');
  protected readonly sort = signal<ClientSort>('name');

  protected readonly clients = computed<Client[]>(() => {
    const query = this.search().trim();
    const list = (this.loaded() ?? []).filter((client) =>
      query ? matchesSearch(`${client.name} ${client.taxNumber} ${client.email}`, query) : true,
    );

    const sort = this.sort();
    return [...list].sort((a, b) => {
      switch (sort) {
        case 'recent':
          return (b.lastInvoiceAt ?? 0) - (a.lastInvoiceAt ?? 0);
        case 'billed':
          return b.totalBilled - a.totalBilled;
        case 'count':
          return b.invoiceCount - a.invoiceCount;
        default:
          return a.name.localeCompare(b.name, 'mk');
      }
    });
  });

  protected readonly currency = computed(
    () => this.companies.activeCompany()?.defaults.currency ?? 'MKD',
  );

  protected async openDialog(client?: Client): Promise<void> {
    const companyId = this.companies.activeCompanyId();
    if (!companyId) return;
    const data: ClientDialogData = { companyId, client };
    const saved = await this.dialog
      .open(ClientDialog, { data, maxWidth: '96vw' })
      .afterClosed()
      .toPromise();
    if (saved) {
      this.snackBar.open(client ? 'Клиентот е ажуриран.' : 'Клиентот е додаден.', 'Во ред');
    }
  }

  /** Starts a new invoice already addressed to this client. */
  protected async newInvoice(client: Client): Promise<void> {
    const company = this.companies.activeCompany();
    if (!company) return;
    const draft = this.invoiceService.createDraft(company, client);
    await this.router.navigate(['/fakturi/nova'], { state: { draft } });
  }

  protected async remove(client: Client): Promise<void> {
    const data: ConfirmData = {
      title: 'Бришење клиент',
      message:
        client.invoiceCount > 0
          ? `„${client.name}“ има ${client.invoiceCount} фактури. Фактурите остануваат непроменети — во нив податоците за клиентот се зачувани посебно. Да го избришеме од листата?`
          : `Да го избришеме „${client.name}“?`,
      confirmLabel: 'Избриши',
      destructive: true,
    };
    const confirmed = await this.dialog.open(ConfirmDialog, { data }).afterClosed().toPromise();
    if (!confirmed) return;

    await this.clientService.remove(client.companyId, client.id);
    this.snackBar.open('Клиентот е избришан.', 'Во ред');
  }
}
