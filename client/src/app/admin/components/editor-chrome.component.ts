import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  input,
  model,
  output,
  signal,
} from "@angular/core";
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

/** A field's problem from the last save, under the field; `id` is its `aria-describedby`. */
@Component({
  selector: "app-field-issue",
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: "contents" },
  template: `
    @if (message()) {
      <p [id]="id()" class="m-0 mt-1 text-[0.75rem] leading-snug text-destructive">
        {{ message() }}
      </p>
    }
  `,
})
export class FieldIssueComponent {
  readonly id = input.required<string>();
  readonly message = input<string | null>(null);
}

/** True for Ctrl+S / ⌘S, the one save shortcut every editor shares. */
export function isSaveShortcut(event: KeyboardEvent): boolean {
  return (
    (event.ctrlKey || event.metaKey) &&
    !event.altKey &&
    !event.shiftKey &&
    event.key.toLowerCase() === "s"
  );
}

/**
 * The one save model of the admin: edits stay local until Save (or Ctrl+S /
 * ⌘S), Discard puts the last saved state back, and the bar says which of
 * unsaved / saving / saved / needs attention the editor is in.
 *
 * Sticky, not fixed: it lives inside the sidebar inset, so it follows the
 * sidebar whether it is expanded, collapsed to icons, or off-canvas on mobile —
 * a fixed bar would need a hard-coded offset that is wrong in two of the three.
 */
@Component({
  selector: "app-save-bar",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [HlmButton, HlmSpinner],
  host: { class: "block", "(document:keydown)": "onKeydown($event)" },
  template: `
    <div
      class="sticky bottom-0 z-20 -mx-6 border-t border-border bg-card/95 px-6 py-3 backdrop-blur"
    >
      <div class="mx-auto flex max-w-4xl items-center justify-between gap-4">
        <p class="m-0 font-mono text-[0.75rem]" [class]="statusClass()" role="status">
          {{ status() }}
        </p>
        <div class="flex items-center gap-2">
          <kbd
            class="hidden rounded border border-border px-1.5 py-0.5 font-mono text-[0.65rem] text-muted-foreground sm:inline"
            aria-hidden="true"
            >{{ shortcut }}</kbd
          >
          <button
            hlmBtn
            variant="ghost"
            type="button"
            [disabled]="!dirty() || saving()"
            (click)="discard.emit()"
          >
            Discard
          </button>
          <button
            hlmBtn
            type="button"
            [disabled]="!dirty() || saving()"
            [attr.aria-keyshortcuts]="ariaShortcut"
            (click)="save.emit()"
          >
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
  /** Fields the last save flagged, still unfixed. */
  readonly problems = input(0);
  readonly saveLabel = input("Save draft");
  readonly hint = input("publish from the dashboard to go live");

  readonly save = output<void>();
  readonly discard = output<void>();

  private readonly isMac =
    typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform ?? "");
  protected readonly shortcut = this.isMac ? "⌘S" : "Ctrl+S";
  protected readonly ariaShortcut = this.isMac ? "Meta+S" : "Control+S";

  /** When the last save that left nothing unsaved finished. */
  private readonly savedAt = signal<Date | null>(null);
  private wasSaving = false;

  protected readonly status = computed(() => {
    if (this.saving()) return "saving…";
    const problems = this.problems();
    if (problems > 0) {
      return problems === 1 ? "1 field needs attention" : `${problems} fields need attention`;
    }
    if (this.dirty()) return "unsaved changes";
    const at = this.savedAt();
    return at ? `saved at ${formatTime(at)} — ${this.hint()}` : `saved — ${this.hint()}`;
  });

  protected readonly statusClass = computed(() => {
    if (this.problems() > 0 && !this.saving()) return "text-destructive";
    return this.dirty() && !this.saving() ? "text-accent-orange" : "text-muted-foreground";
  });

  constructor() {
    effect(() => {
      const saving = this.saving();
      const dirty = this.dirty();
      if (this.wasSaving && !saving && !dirty) this.savedAt.set(new Date());
      this.wasSaving = saving;
    });
  }

  protected onKeydown(event: KeyboardEvent): void {
    if (!isSaveShortcut(event)) return;
    // Never the browser's "Save page as…" inside an editor.
    event.preventDefault();
    if (this.saving()) return;
    if (this.dirty()) {
      this.save.emit();
      return;
    }
    // Typed and saved in one breath: the keystroke's edit reaches `dirty`
    // with the next change detection, which may not have run yet.
    setTimeout(() => {
      if (this.dirty() && !this.saving()) this.save.emit();
    }, 50);
  }
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
