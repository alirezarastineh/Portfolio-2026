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
    <form class="flex flex-col gap-1.5 pb-3" (submit)="$event.preventDefault(); send()">
      <label [for]="inputId" class="text-accent-orange">{{ copy().label[kind()] }}</label>
      <textarea
        #box
        [id]="inputId"
        rows="6"
        [attr.maxlength]="max"
        class="w-full resize-y rounded-md border border-border bg-transparent p-2 text-foreground focus-visible:outline-2 focus-visible:outline-accent-orange"
        [attr.aria-describedby]="noteId + ' ' + countId"
        autocomplete="off"
        (input)="text.set(box.value)"
        (keydown)="onKey($event)"
      ></textarea>
      <span [id]="noteId" class="text-xs text-muted-foreground">{{ copy().note }}</span>
      <span class="flex flex-wrap items-center gap-2">
        <button
          type="submit"
          class="press min-h-7 cursor-pointer rounded-md border border-border px-2.5 hover:border-accent-orange disabled:cursor-default disabled:opacity-50"
          [disabled]="!ready()"
        >
          {{ copy().send }}
        </button>
        <button
          type="button"
          class="press min-h-7 cursor-pointer rounded-md border border-border px-2.5 hover:border-accent-orange"
          (click)="dismissed.emit()"
        >
          {{ copy().cancel }}
        </button>
        <span [id]="countId" class="ml-auto text-xs tabular-nums text-muted-foreground">{{
          counter()
        }}</span>
      </span>
    </form>
  `,
})
export class MatchBoxComponent {
  readonly kind = input.required<MatchKind>();
  /** The brief, trimmed, once the visitor sends it. */
  readonly sent = output<string>();
  /** Put away, nothing sent. */
  readonly dismissed = output<void>();

  private readonly lang = inject(LanguageService);
  private readonly box = viewChild.required<ElementRef<HTMLTextAreaElement>>("box");

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
    afterNextRender(() => this.box().nativeElement.focus());
  }

  protected send(): void {
    if (this.ready()) this.sent.emit(this.text().trim());
  }

  protected onKey(event: KeyboardEvent): void {
    if (event.key === "Escape") {
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
