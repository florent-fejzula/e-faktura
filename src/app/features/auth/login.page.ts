import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';

type Mode = 'signin' | 'register' | 'reset';

@Component({
  selector: 'app-login-page',
  imports: [
    ReactiveFormsModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatIconModule,
    MatProgressBarModule,
    MatCheckboxModule,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './login.page.html',
  styleUrl: './login.page.scss',
})
export class LoginPage {
  private readonly fb = inject(FormBuilder);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly snackBar = inject(MatSnackBar);
  protected readonly auth = inject(AuthService);

  protected readonly mode = signal<Mode>('signin');
  protected readonly showPassword = signal(false);

  protected readonly form = this.fb.nonNullable.group({
    displayName: [''],
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, Validators.minLength(6)]],
  });

  protected readonly title = computed(() => {
    switch (this.mode()) {
      case 'register':
        return 'Создадете сметка';
      case 'reset':
        return 'Ресетирање на лозинка';
      default:
        return 'Најавете се';
    }
  });

  protected setMode(mode: Mode): void {
    this.mode.set(mode);
    this.auth.error.set(null);

    const password = this.form.controls.password;
    if (mode === 'reset') {
      password.disable();
    } else {
      password.enable();
    }
  }

  protected toggleShowPassword(): void {
    this.showPassword.update((v) => !v);
  }

  protected async signInWithGoogle(): Promise<void> {
    if (await this.auth.signInWithGoogle()) await this.leave();
  }

  protected async submit(): Promise<void> {
    const mode = this.mode();

    if (mode === 'reset') {
      const email = this.form.controls.email;
      if (email.invalid) {
        email.markAsTouched();
        return;
      }
      if (await this.auth.resetPassword(email.value)) {
        this.snackBar.open('Испративме линк за ресетирање на вашата е-пошта.', 'Во ред');
        this.setMode('signin');
      }
      return;
    }

    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    const { email, password, displayName } = this.form.getRawValue();
    const ok =
      mode === 'register'
        ? await this.auth.register(email, password, displayName)
        : await this.auth.signInWithEmail(email, password);

    if (ok) await this.leave();
  }

  /** Returns to wherever the guard interrupted, or the invoice list. */
  private async leave(): Promise<void> {
    const redirectTo = this.route.snapshot.queryParamMap.get('redirectTo');
    await this.router.navigateByUrl(redirectTo || '/fakturi');
  }
}
