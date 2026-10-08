import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { AbstractControl, FormBuilder, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSnackBar } from '@angular/material/snack-bar';
import { AuthService, MIN_PASSWORD_LENGTH } from '../../core/auth/auth.service';

/**
 * Change the password of the signed-in account.
 *
 * Asks for the current password even though the person is signed in: the
 * password the operator handed over is the one most people will be replacing,
 * and re-entering it is what lets Firebase accept the change (see
 * `AuthService.changePassword`). The fields carry `autocomplete` hints so a
 * browser or phone offers to save the new password in place of the old one.
 */
@Component({
  selector: 'app-change-password-dialog',
  imports: [
    ReactiveFormsModule,
    MatButtonModule,
    MatDialogModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h2 mat-dialog-title>Промена на лозинка</h2>
    <form [formGroup]="form" (ngSubmit)="save()" novalidate>
      <mat-dialog-content>
        <mat-form-field>
          <mat-label>Тековна лозинка</mat-label>
          <input
            matInput
            [type]="visible() ? 'text' : 'password'"
            formControlName="current"
            autocomplete="current-password"
          />
          @if (form.controls.current.touched && form.controls.current.hasError('required')) {
            <mat-error>Внесете ја тековната лозинка.</mat-error>
          }
        </mat-form-field>

        <mat-form-field>
          <mat-label>Нова лозинка</mat-label>
          <input
            matInput
            [type]="visible() ? 'text' : 'password'"
            formControlName="next"
            autocomplete="new-password"
          />
          <button
            matSuffix
            mat-icon-button
            type="button"
            (click)="visible.set(!visible())"
            [attr.aria-label]="visible() ? 'Скриј ги лозинките' : 'Прикажи ги лозинките'"
            [attr.aria-pressed]="visible()"
          >
            <mat-icon>{{ visible() ? 'visibility_off' : 'visibility' }}</mat-icon>
          </button>
          <mat-hint>Најмалку {{ minLength }} знаци.</mat-hint>
          @if (form.controls.next.touched && form.controls.next.invalid) {
            <mat-error>
              {{
                form.controls.next.hasError('required')
                  ? 'Внесете нова лозинка.'
                  : form.controls.next.hasError('same')
                    ? 'Новата лозинка мора да се разликува од тековната.'
                    : 'Лозинката е прекратка — потребни се најмалку ' + minLength + ' знаци.'
              }}
            </mat-error>
          }
        </mat-form-field>

        <mat-form-field>
          <mat-label>Повторете ја новата лозинка</mat-label>
          <input
            matInput
            [type]="visible() ? 'text' : 'password'"
            formControlName="confirm"
            autocomplete="new-password"
          />
          @if (form.controls.confirm.touched && form.controls.confirm.invalid) {
            <mat-error>
              {{
                form.controls.confirm.hasError('required')
                  ? 'Повторете ја новата лозинка.'
                  : 'Лозинките не се исти.'
              }}
            </mat-error>
          }
        </mat-form-field>

        @if (error(); as message) {
          <p class="error" role="alert">
            <mat-icon>error</mat-icon>
            <span>{{ message }}</span>
          </p>
        }
      </mat-dialog-content>

      <mat-dialog-actions align="end">
        <button mat-button type="button" (click)="ref.close(false)">Откажи</button>
        <button mat-flat-button type="submit" [disabled]="saving()">Промени лозинка</button>
      </mat-dialog-actions>
    </form>
  `,
  styles: `
    :host {
      display: block;
    }
    mat-dialog-content {
      display: flex;
      flex-direction: column;
      gap: 6px;
      min-width: min(380px, 80vw);
    }
    .error {
      display: flex;
      align-items: flex-start;
      gap: 8px;
      margin: 4px 0 0;
      padding: 10px 12px;
      border-radius: 10px;
      background: var(--mat-sys-error-container);
      color: var(--mat-sys-on-error-container);
      font: var(--mat-sys-body-small);

      mat-icon {
        flex: none;
        width: 18px;
        height: 18px;
        font-size: 18px;
      }
    }
  `,
})
export class ChangePasswordDialog {
  private readonly fb = inject(FormBuilder);
  private readonly auth = inject(AuthService);
  private readonly snackBar = inject(MatSnackBar);
  protected readonly ref = inject(MatDialogRef<ChangePasswordDialog, boolean>);

  protected readonly minLength = MIN_PASSWORD_LENGTH;
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);
  /** One switch for all three fields: checking what was typed is the point. */
  protected readonly visible = signal(false);

  protected readonly form = this.fb.nonNullable.group({
    current: ['', Validators.required],
    next: ['', [Validators.required, Validators.minLength(MIN_PASSWORD_LENGTH), differsFromCurrent]],
    confirm: ['', [Validators.required, matchesNext]],
  });

  constructor() {
    // The two checks that compare fields have to follow the field they compare to.
    this.form.controls.current.valueChanges.subscribe(() =>
      this.form.controls.next.updateValueAndValidity(),
    );
    this.form.controls.next.valueChanges.subscribe(() =>
      this.form.controls.confirm.updateValueAndValidity(),
    );
  }

  protected async save(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    const { current, next } = this.form.getRawValue();
    this.saving.set(true);
    this.error.set(null);
    const failure = await this.auth.changePassword(current, next);
    this.saving.set(false);

    if (failure) {
      this.error.set(failure);
      return;
    }
    this.snackBar.open('Лозинката е променета.', 'Во ред', { duration: 6000 });
    this.ref.close(true);
  }
}

function differsFromCurrent(control: AbstractControl): ValidationErrors | null {
  const current = control.parent?.get('current')?.value as string | undefined;
  return current && control.value && control.value === current ? { same: true } : null;
}

function matchesNext(control: AbstractControl): ValidationErrors | null {
  const next = control.parent?.get('next')?.value as string | undefined;
  return control.value && control.value !== next ? { mismatch: true } : null;
}
