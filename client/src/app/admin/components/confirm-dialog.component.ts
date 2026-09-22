import { ChangeDetectionStrategy, Component, inject, Injectable } from "@angular/core";
import { firstValueFrom } from "rxjs";
import { BrnDialogRef, injectBrnDialogContext } from "@spartan-ng/brain/dialog";
import { HlmButton } from "@spartan-ng/helm/button";
import { HlmDialogService } from "@spartan-ng/helm/dialog";

export interface ConfirmOptions {
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
}

@Component({
  selector: "app-confirm-dialog",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [HlmButton],
  host: { class: "block" },
  template: `
    <div class="flex flex-col gap-4">
      <div class="flex flex-col gap-1.5">
        <h2 class="m-0 font-mono text-base font-medium">{{ context.title }}</h2>
        <p class="m-0 text-sm text-muted-foreground">{{ context.description }}</p>
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

  async ask(options: ConfirmOptions): Promise<boolean> {
    const ref = this.dialog.open(ConfirmDialogComponent, {
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
