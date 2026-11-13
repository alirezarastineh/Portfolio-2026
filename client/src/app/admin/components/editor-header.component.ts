import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from "@angular/core";
import { NgIcon, provideIcons } from "@ng-icons/core";
import { lucideEllipsis } from "@ng-icons/lucide";
import { HlmButton } from "@spartan-ng/helm/button";
import { HlmDropdownMenuImports } from "@spartan-ng/helm/dropdown-menu";

import { RecoveryService, typedAt } from "../recovery.service";
import { isSaveShortcut } from "./editor-chrome.component";

/** "1 field", "3 fields". */
const count = (n: number, word: string): string => `${n} ${word}${n === 1 ? "" : "s"}`;

/**
 * An editor's header (plan 5, U10), in place of the page header and the save bar: the page's
 * `h1`, its state in words, what the page projects (the language switch, the live preview's
 * switch), Save with its key, and ⋯ with Discard. Sticky under the top bar on a raised surface,
 * so Save is in view at every scroll. Ctrl/⌘ S saves from anywhere on the page.
 */
@Component({
  selector: "app-editor-header",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [HlmButton, HlmDropdownMenuImports, NgIcon],
  viewProviders: [provideIcons({ lucideEllipsis })],
  host: { class: "sticky top-12 z-30 block", "(document:keydown)": "onKeydown($event)" },
  template: `
    <!-- The surface reaches the column's edges; the main column clips it sideways. -->
    <div
      class="relative flex min-h-14 flex-wrap items-center gap-x-3 gap-y-2 py-2 before:absolute before:inset-y-0 before:inset-x-[-100vw] before:-z-10 before:border-b before:border-border before:bg-card"
    >
      <h1
        tabindex="-1"
        class="m-0 min-w-0 text-page-title wrap-break-word text-foreground outline-none max-md:sr-only"
      >
        {{ title() }}
      </h1>
      @let shown = status();
      <p class="m-0 min-w-0 flex-1 text-hint" [class]="shown.tone" role="status">
        <span [textContent]="shown.words"></span>
        @if (shown.time) {
          &ngsp;<span class="text-data" [textContent]="shown.time"></span>
        }
      </p>
      <ng-content />
      <button
        hlmBtn
        type="button"
        [disabled]="!changes() || saving()"
        [attr.aria-keyshortcuts]="ariaShortcut"
        (click)="save.emit()"
      >
        Save
        <!-- The button's own colour, quieter: muted grey on the foreground fill could not be read. -->
        <kbd
          class="rounded-sm border border-current px-1.5 py-px font-data text-xs opacity-60 max-md:hidden pointer-coarse:hidden"
          aria-hidden="true"
          >{{ shortcut }}</kbd
        >
      </button>
      <button
        hlmBtn
        variant="ghost"
        size="icon-sm"
        type="button"
        class="text-muted-foreground"
        [hlmDropdownMenuTrigger]="more"
        [attr.aria-label]="'More actions for ' + title()"
      >
        <ng-icon name="lucideEllipsis" size="16" aria-hidden="true" />
      </button>
      <ng-template #more>
        <hlm-dropdown-menu class="w-56">
          <button
            hlmDropdownMenuItem
            [disabled]="!changes() || saving()"
            (triggered)="discard.emit()"
          >
            {{ discardLabel() }}
          </button>
        </hlm-dropdown-menu>
      </ng-template>
    </div>
    @if (recovery.full()) {
      <p class="m-0 bg-card py-2 text-sm text-destructive" role="status">
        The browser's storage is full or blocked: these edits have no recovery copy. Save to keep
        them.
      </p>
    }
  `,
})
export class EditorHeaderComponent {
  readonly title = input.required<string>();
  /** Fields that differ from what is saved. */
  readonly changes = input(0);
  readonly saving = input(false);
  /** Fields the last save flagged, still unfixed. */
  readonly problems = input(0);
  /** Fields saved to the draft and not live; null while the review is unknown. */
  readonly notLive = input<number | null>(null);

  readonly save = output<void>();
  readonly discard = output<void>();

  protected readonly recovery = inject(RecoveryService);

  private readonly isMac =
    typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform ?? "");
  protected readonly shortcut = this.isMac ? "⌘S" : "Ctrl S";
  protected readonly ariaShortcut = this.isMac ? "Meta+S" : "Control+S";

  /** When the last save that left nothing unsaved finished, in this visit. */
  private readonly savedAt = signal<number | null>(null);
  private wasSaving = false;

  protected readonly status = computed(() => {
    const quiet = "text-muted-foreground";
    if (this.saving()) return { words: "Saving…", time: null, tone: quiet };
    const problems = this.problems();
    if (problems) {
      const words = `${count(problems, "field")} ${problems === 1 ? "needs" : "need"} attention`;
      return { words, time: null, tone: "text-destructive" };
    }
    const changes = this.changes();
    if (changes) {
      return { words: count(changes, "unsaved change"), time: null, tone: "text-accent-orange" };
    }
    const at = this.savedAt();
    if (at) return { words: "Saved", time: typedAt(at), tone: quiet };
    const notLive = this.notLive();
    if (notLive === null) return { words: "", time: null, tone: quiet };
    // "Live", not the top bar's "All live": that one is the whole site's.
    return {
      words: notLive ? `${count(notLive, "field")} not live` : "Live",
      time: null,
      tone: quiet,
    };
  });

  protected readonly discardLabel = computed(() => {
    const n = this.changes();
    return n ? `Discard ${count(n, "change")}` : "Nothing to discard";
  });

  constructor() {
    effect(() => {
      const saving = this.saving();
      if (this.wasSaving && !saving && !this.changes() && !this.problems()) {
        this.savedAt.set(Date.now());
      }
      this.wasSaving = saving;
    });
  }

  protected onKeydown(event: KeyboardEvent): void {
    if (!isSaveShortcut(event)) return;
    // Never the browser's "Save page as…" inside an editor.
    event.preventDefault();
    if (this.saving()) return;
    if (this.changes()) {
      this.save.emit();
      return;
    }
    // Typed and saved in one breath: the keystroke's edit reaches `changes` with the next
    // change detection, which may not have run yet.
    setTimeout(() => {
      if (this.changes() && !this.saving()) this.save.emit();
    }, 50);
  }
}
