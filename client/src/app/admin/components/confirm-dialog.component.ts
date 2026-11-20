import { ChangeDetectionStrategy, Component, inject, Injectable } from "@angular/core";
import { firstValueFrom } from "rxjs";
import { BrnDialogRef, injectBrnDialogContext } from "@spartan-ng/brain/dialog";
import { HlmButton } from "@spartan-ng/helm/button";
import { HlmDialogDescription, HlmDialogService, HlmDialogTitle } from "@spartan-ng/helm/dialog";

export interface ConfirmOptions {
  title: string;
  description: string;
  /** What it does, a line each, under the description (Settings' changes). */
  items?: readonly string[];
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
}

@Component({
  selector: "app-confirm-dialog",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [HlmButton, HlmDialogDescription, HlmDialogTitle],
  host: { class: "block" },
  template: `
    <div class="flex flex-col gap-4">
      <div class="flex flex-col gap-1.5">
        <!-- The title names the dialog and the description describes it (axe's aria-dialog-name). -->
        <h2 hlmDialogTitle class="m-0 wrap-anywhere">{{ context.title }}</h2>
        <p hlmDialogDescription class="m-0 wrap-anywhere">{{ context.description }}</p>
        @if (context.items?.length) {
          <ul class="m-0 flex list-disc flex-col gap-1 ps-5 text-sm wrap-anywhere">
            @for (item of context.items; track $index) {
              <li>{{ item }}</li>
            }
          </ul>
        }
      </div>
      <div class="flex justify-end gap-2">
        <button hlmBtn variant="ghost" type="button" (click)="close(false)">
          {{ context.cancelLabel ?? "Cancel" }}
        </button>
        <button
          hlmBtn
          type="button"
          [variant]="context.destructive ? 'destructive' : 'default'"
          (click)="close(true)"
        >
          {{ context.confirmLabel ?? "Confirm" }}
        </button>
      </div>
    </div>
  `,
})
export class ConfirmDialogComponent {
  private readonly ref = inject<BrnDialogRef<boolean>>(BrnDialogRef);
  protected readonly context = injectBrnDialogContext<ConfirmOptions>();

  protected close(result: boolean): void {
    this.ref.close(result);
  }
}

/**
 * Imperative confirmation, because a route guard has no template of its own.
 * Replaces `window.confirm`, which cannot be styled and blocks the main thread.
 */
@Injectable({ providedIn: "root" })
export class ConfirmService {
  private readonly dialog = inject(HlmDialogService);
  private sequence = 0;

  async ask(options: ConfirmOptions): Promise<boolean> {
    const ref = this.dialog.open(ConfirmDialogComponent, {
      // Its own ids: Spartan numbers dialogs opened here and dialogs declared
      // in templates (a sheet) with two separate counters that both yield
      // `brn-dialog-<n>`, so asking while a sheet is open could collide
      // ("Dialog with ID … already exists").
      id: `confirm-dialog-${++this.sequence}`,
      context: options,
      contentClass: "max-w-md",
      // The plan named `HlmAlertDialog`, but that component is template-only
      // and a route guard has no template. Opening through the service with the
      // alertdialog role gives the same semantics: assistive tech announces it
      // as an interrupting alert rather than an ordinary dialog.
      role: "alertdialog",
      ariaModal: true,
    });

    // Dismissing by backdrop or Escape resolves undefined — treat as "no".
    return (await firstValueFrom(ref.closed$)) === true;
  }
}
