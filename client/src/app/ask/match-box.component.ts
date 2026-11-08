import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  inject,
  input,
  output,
  signal,
  viewChild,
} from "@angular/core";

import { LanguageService } from "../services/language.service";
import { ASK_COPY } from "./ask-copy";
import { counterLine, MATCH_BRIEF_CHARS, type MatchKind } from "./match";

let instances = 0;

/**
 * A brief's paste box (visitor plan V20): one text of at most 4,000
 * characters, a counter, and a note on where the text goes, read before
 * anything is sent. "check it" (or Ctrl+Enter) sends it, Esc puts it away.
 * The terminal loads it with the first `match` (`@defer`), so its own chunk
 * stays as it was.
 */
@Component({
  selector: "app-match-box",
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: "block" },
  template: `
    <form
      [class]="page() ? 'flex max-w-3xl flex-col gap-3' : 'flex flex-col gap-1.5 pb-3'"
      (submit)="$event.preventDefault(); send()"
    >
      <label
        [for]="inputId"
        [class]="page() ? 'text-base font-medium text-foreground' : 'text-accent-orange'"
        >{{ copy().label[kind()] }}</label
      >
      <div [class.field-line]="page()">
        <textarea
          #box
          [id]="inputId"
          [attr.rows]="page() ? 10 : 6"
          [attr.maxlength]="max"
          [class]="page() ? 'field resize-y' : terminalField"
          [attr.aria-describedby]="noteId + ' ' + countId"
          autocomplete="off"
          (input)="text.set(box.value)"
          (keydown)="onKey($event)"
        ></textarea>
      </div>
      <span
        [id]="noteId"
        [class]="page() ? 'text-small text-muted-foreground' : 'text-xs text-muted-foreground'"
        >{{ copy().note }}</span
      >
      <span class="flex flex-wrap items-center gap-2">
        <button
          type="submit"
          [class]="page() ? 'btn btn-solid press' : terminalButton"
          [disabled]="!ready()"
          [attr.aria-disabled]="busy() ? 'true' : null"
          [attr.aria-busy]="busy() ? 'true' : null"
        >
          {{ copy().send }}
        </button>
        @if (!page()) {
          <button type="button" [class]="terminalButton" (click)="dismissed.emit()">
            {{ copy().cancel }}
          </button>
        }
        <span
          [id]="countId"
          [class]="
            page()
              ? 'ml-auto text-data text-muted-foreground'
              : 'ml-auto text-xs tabular-nums text-muted-foreground'
          "
          >{{ counter() }}</span
        >
      </span>
    </form>
  `,
  styles: `
    /* iOS zooms into a field under 16px when it takes focus. */
    @media (width < 64rem) {
      textarea {
        font-size: 1rem;
      }
    }
    @media (pointer: coarse) {
      button:not(.btn) {
        min-height: 2.75rem;
      }
    }
  `,
})
export class MatchBoxComponent {
  readonly kind = input.required<MatchKind>();
  /** On the match page (plan 3 W3): it stays, so it takes no focus and has nothing to cancel. */
  readonly page = input(false);
  /** A brief is being checked: on the page, its button shows it and takes no second one. */
  readonly busy = input(false);
  /** The brief, trimmed, once the visitor sends it. */
  readonly sent = output<string>();
  /** Put away, nothing sent. */
  readonly dismissed = output<void>();

  private readonly lang = inject(LanguageService);
  private readonly box = viewChild.required<ElementRef<HTMLTextAreaElement>>("box");

  protected readonly terminalField =
    "w-full resize-y rounded-md border border-border bg-transparent p-2 text-foreground focus-visible:outline-2 focus-visible:outline-accent-orange";
  protected readonly terminalButton =
    "press min-h-7 cursor-pointer rounded-md border border-border px-2.5 hover:border-accent-orange disabled:cursor-default disabled:opacity-50";

  protected readonly max = MATCH_BRIEF_CHARS;
  private readonly n = ++instances;
  protected readonly inputId = `match-brief-${this.n}`;
  protected readonly noteId = `match-note-${this.n}`;
  protected readonly countId = `match-count-${this.n}`;

  protected readonly copy = computed(() => ASK_COPY[this.lang.lang()].match);
  protected readonly text = signal("");
  protected readonly counter = computed(() =>
    counterLine(this.text().length, this.copy(), this.lang.lang()),
  );
  protected readonly ready = computed(() => {
    const length = this.text().trim().length;
    return length > 0 && length <= MATCH_BRIEF_CHARS;
  });

  constructor() {
    afterNextRender(() => {
      if (!this.page()) this.box().nativeElement.focus();
    });
  }

  protected send(): void {
    if (this.ready()) this.sent.emit(this.text().trim());
  }

  protected onKey(event: KeyboardEvent): void {
    if (event.key === "Escape" && !this.page()) {
      // The box's Esc only: the sheet around the terminal stays open.
      event.preventDefault();
      event.stopPropagation();
      this.dismissed.emit();
    } else if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      this.send();
    }
  }
}
