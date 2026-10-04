import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { AdminService } from '../../core/data/admin.service';
import type { Company } from '../../core/models/company.model';
import { MODULES, hasModule, type CompanyModules, type ModuleId } from '../../core/modules/modules';

export interface ModulesDialogData {
  company: Company;
}

/**
 * The operator's switchboard for one company's optional features.
 *
 * Rendered from the module registry, so a new module shows up here without
 * touching this dialog. Changes apply on save, together — a module flipped on
 * and off again by accident never reaches the customer.
 */
@Component({
  selector: 'app-modules-dialog',
  imports: [MatButtonModule, MatDialogModule, MatIconModule, MatSlideToggleModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h2 mat-dialog-title>Модули — {{ data.company.name }}</h2>
    <mat-dialog-content>
      <p class="lede">
        Дополнителни функции за оваа фирма. Вклучен модул се појавува кај клиентот веднаш,
        без освежување.
      </p>
      <ul class="modules">
        @for (module of modules; track module.id) {
          <li class="module">
            <mat-icon class="module__icon">{{ module.icon }}</mat-icon>
            <div class="module__text">
              <strong>{{ module.name }}</strong>
              <span>{{ module.description }}</span>
            </div>
            <mat-slide-toggle
              [checked]="isOn(module.id)"
              (change)="set(module.id, $event.checked)"
              [aria-label]="module.name"
            />
          </li>
        }
      </ul>
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
      margin: 0 0 12px;
      max-width: 52ch;
      color: var(--mat-sys-on-surface-variant);
    }
    .modules {
      display: flex;
      flex-direction: column;
      gap: 8px;
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .module {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 12px;
      border: 1px solid var(--mat-sys-outline-variant);
      border-radius: 12px;
    }
    .module__icon {
      flex: none;
      color: var(--mat-sys-primary);
    }
    .module__text {
      display: flex;
      flex: 1;
      flex-direction: column;
      gap: 2px;
      min-width: 0;

      span {
        color: var(--mat-sys-on-surface-variant);
        font: var(--mat-sys-body-small);
      }
    }
    .error {
      margin: 12px 0 0;
      color: var(--mat-sys-error);
    }
  `,
})
export class ModulesDialog {
  private readonly admin = inject(AdminService);
  protected readonly ref = inject(MatDialogRef<ModulesDialog, boolean>);
  protected readonly data = inject<ModulesDialogData>(MAT_DIALOG_DATA);

  protected readonly modules = MODULES;
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);

  /** Edited copy; the company document changes only on save. */
  private readonly draft = signal<CompanyModules>({ ...(this.data.company.modules ?? {}) });

  protected isOn(id: ModuleId): boolean {
    return hasModule(this.draft(), id);
  }

  protected set(id: ModuleId, on: boolean): void {
    this.draft.update((modules) => ({ ...modules, [id]: on }));
  }

  protected async save(): Promise<void> {
    this.saving.set(true);
    this.error.set(null);
    try {
      await this.admin.setModules(this.data.company.id, this.draft());
      this.ref.close(true);
    } catch (error) {
      this.error.set(`Не успеа: ${(error as Error)?.message ?? error}`);
    } finally {
      this.saving.set(false);
    }
  }
}
