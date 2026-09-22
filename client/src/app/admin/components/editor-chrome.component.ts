import { ChangeDetectionStrategy, Component, input, model, output } from "@angular/core";
import { HlmButton } from "@spartan-ng/helm/button";
import { HlmTabsImports } from "@spartan-ng/helm/tabs";
import { HlmSpinner } from "@spartan-ng/helm/spinner";

import type { LocaleView } from "./field-pair.component";

/** EN / DE / both switch, shared by every bilingual editor. */
@Component({
  selector: "app-locale-toggle",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [HlmTabsImports],
  host: { class: "inline-block" },
  template: `
    <div hlmTabs [tab]="view()" (tabActivated)="onTab($event)">
      <div hlmTabsList aria-label="Language view">
        @for (option of options; track option) {
          <button
            [hlmTabsTrigger]="option"
            class="font-mono text-[0.75rem] uppercase tracking-widest"
          >
            {{ option }}
          </button>
        }
      </div>
    </div>
  `,
})
export class LocaleToggleComponent {
  readonly view = model.required<LocaleView>();
  protected readonly options: LocaleView[] = ["en", "de", "both"];

  protected onTab(tab: string | number): void {
    this.view.set(tab as LocaleView);
  }
}

/**
 * Sticky, not fixed: it lives inside the sidebar inset, so it follows the
 * sidebar whether it is expanded, collapsed to icons, or off-canvas on mobile —
 * a fixed bar would need a hard-coded offset that is wrong in two of the three.
 */
@Component({
  selector: "app-save-bar",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [HlmButton, HlmSpinner],
  host: { class: "block" },
  template: `
    <div
      class="sticky bottom-0 z-20 -mx-6 border-t border-border bg-card/95 px-6 py-3 backdrop-blur"
    >
      <div class="mx-auto flex max-w-4xl items-center justify-between gap-4">
        <p
          class="m-0 font-mono text-[0.75rem]"
          [class.text-accent-orange]="dirty()"
          [class.text-muted-foreground]="!dirty()"
        >
          {{ dirty() ? "unsaved changes" : hint() }}
        </p>
        <div class="flex gap-2">
          <button
            hlmBtn
            variant="ghost"
            type="button"
            [disabled]="!dirty() || saving()"
            (click)="discard.emit()"
          >
            Discard
          </button>
          <button hlmBtn type="button" [disabled]="!dirty() || saving()" (click)="save.emit()">
            @if (saving()) {
              <hlm-spinner class="size-4" />
            } @else {
              {{ saveLabel() }}
            }
          </button>
        </div>
      </div>
    </div>
  `,
})
export class SaveBarComponent {
  readonly dirty = input.required<boolean>();
  readonly saving = input(false);
  readonly saveLabel = input("Save draft");
  readonly hint = input("saved — publish from the dashboard to go live");

  readonly save = output<void>();
  readonly discard = output<void>();
}
