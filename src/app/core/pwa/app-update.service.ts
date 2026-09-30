import { DestroyRef, Injectable, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatSnackBar } from '@angular/material/snack-bar';
import { SwUpdate, type VersionReadyEvent } from '@angular/service-worker';
import { filter } from 'rxjs';

/**
 * Tells the user when a newer version has been deployed.
 *
 * With a service worker the app keeps running the version it was opened with:
 * the new one downloads in the background and only takes over on the next
 * load. In a browser tab that happens often enough on its own. An app
 * installed on a phone is different — it is resumed from the background for
 * days without ever reloading, so a fix would never arrive unless it is asked
 * for.
 *
 * Reloading is left to the user rather than done automatically, because a
 * reload in the middle of an unsaved invoice would throw the edits away.
 */
@Injectable({ providedIn: 'root' })
export class AppUpdateService {
  private readonly updates = inject(SwUpdate);
  private readonly snackBar = inject(MatSnackBar);
  private readonly destroyRef = inject(DestroyRef);

  /** Called once from the root component. A no-op in development. */
  start(): void {
    if (!this.updates.isEnabled) return;

    this.updates.versionUpdates
      .pipe(
        filter((event): event is VersionReadyEvent => event.type === 'VERSION_READY'),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(() => this.offerReload('Достапна е нова верзија на апликацијата.'));

    // The cached version can no longer be served — typically a deploy removed
    // a chunk this tab still needs. Nothing works until a reload.
    this.updates.unrecoverable
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.offerReload('Апликацијата мора да се освежи за да продолжи.'));

    // The service worker checks on every page load, which an installed app
    // resumed from the background never does. Checking when it comes back to
    // the foreground covers that; the request is a small JSON file.
    const onVisible = () => {
      if (document.visibilityState === 'visible') void this.updates.checkForUpdate().catch(() => {});
    };
    document.addEventListener('visibilitychange', onVisible);
    this.destroyRef.onDestroy(() => document.removeEventListener('visibilitychange', onVisible));
  }

  private offerReload(message: string): void {
    this.snackBar
      .open(message, 'Освежи', { duration: 0 })
      .onAction()
      .subscribe(() => document.location.reload());
  }
}
