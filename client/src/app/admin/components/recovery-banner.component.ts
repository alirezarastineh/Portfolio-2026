import { ChangeDetectionStrategy, Component, computed, ElementRef, inject } from "@angular/core";
import { HlmButton } from "@spartan-ng/helm/button";

import { RecoveryService, typedAt } from "../recovery.service";
import { toastDiscarded } from "../save-feedback";

/** Above the page: unsaved edits that came back from the browser, to keep or to throw away. */
@Component({
  selector: "app-recovery-banner",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [HlmButton],
  host: { class: "contents" },
  template: `
    @if (when(); as time) {
      <div
        class="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-accent-orange/40 bg-accent-orange/10 px-4 py-3"
        role="status"
      >
        <div class="flex min-w-0 flex-col gap-1 text-sm">
          <p class="m-0">Unsaved edits from {{ time }} are back.</p>
          @if (changedSince()) {
            <p class="m-0">
              The saved version changed since then. If you keep these edits, saving replaces it.
            </p>
          }
        </div>
        <div class="flex shrink-0 gap-2">
          <button hlmBtn size="sm" type="button" (click)="keep()">Keep</button>
          <button hlmBtn size="sm" variant="ghost" type="button" (click)="discard()">
            Discard
          </button>
        </div>
      </div>
    }
  `,
})
export class RecoveryBannerComponent {
  private readonly recovery = inject(RecoveryService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  protected readonly when = computed(() => {
    const back = this.recovery.back();
    return back.length ? typedAt(Math.max(...back.map((one) => one.at))) : null;
  });
  protected readonly changedSince = computed(() =>
    this.recovery.back().some((one) => one.changedSince),
  );

  protected keep(): void {
    this.recovery.back.set([]);
    this.focusTitle();
  }

  protected discard(): void {
    const undos = this.recovery.back().map((one) => one.discard());
    this.recovery.back.set([]);
    toastDiscarded(() => {
      for (const undo of undos) undo();
    });
    this.focusTitle();
  }

  /** The banner took the focused button with it: the panel it sits in, or the page's title. */
  private focusTitle(): void {
    const panel = this.host.nativeElement.closest<HTMLElement>("[role=dialog]");
    (panel ?? document.querySelector<HTMLElement>("h1"))?.focus();
  }
}
