import { ChangeDetectionStrategy, Component, inject } from "@angular/core";
import { HlmDialogImports, type HlmDialog } from "@spartan-ng/helm/dialog";

import { AdminSessionService } from "../admin-session.service";
import { SignInFormComponent } from "./sign-in-form.component";

/**
 * A lost session signs in again over the page, and the page stays as it is.
 * Not dismissable: until the session is back, nothing behind it can be saved.
 */
@Component({
  selector: "app-session-dialog",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [HlmDialogImports, SignInFormComponent],
  template: `
    <hlm-dialog
      #dialog="hlmDialog"
      [state]="session.lost() ? 'open' : 'closed'"
      disableClose
      autoFocus="#session-password"
      (closed)="reopenWhileLost(dialog)"
    >
      <hlm-dialog-content *hlmDialogPortal="let ctx" [showCloseButton]="false" class="sm:max-w-sm">
        <hlm-dialog-header>
          <h2 hlmDialogTitle>Sign in to carry on</h2>
          <p hlmDialogDescription>You were signed out. Nothing on this page is lost.</p>
        </hlm-dialog-header>
        <app-sign-in-form
          idPrefix="session-"
          [email]="session.user()?.email ?? ''"
          (signedIn)="session.regain($event)"
        />
      </hlm-dialog-content>
    </hlm-dialog>
  `,
})
export class SessionDialogComponent {
  protected readonly session = inject(AdminSessionService);

  /**
   * The browser's Back disposes any open overlay; the guard keeps the page, so
   * this comes back. A microtask later, once the CDK has freed the dialog's id.
   */
  protected reopenWhileLost(dialog: HlmDialog): void {
    queueMicrotask(() => {
      if (this.session.lost()) dialog.open();
    });
  }
}
