import { CdkDrag, type CdkDragDrop, CdkDropList, moveItemInArray } from "@angular/cdk/drag-drop";
import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  Injector,
  input,
  model,
  signal,
  untracked,
  viewChildren,
} from "@angular/core";
import { NgIcon, provideIcons } from "@ng-icons/core";
import { lucideX } from "@ng-icons/lucide";
import { HlmDropdownMenuImports } from "@spartan-ng/helm/dropdown-menu";
import { HlmFieldLabel } from "@spartan-ng/helm/field";
import { HlmInput } from "@spartan-ng/helm/input";

import { TRACE_WORDS, type TraceState } from "../change-trace";
import { FieldIssueComponent } from "./editor-chrome.component";

interface Token {
  id: number;
  value: string;
}

let tokens = 0;

/** "technology" → "technologies", "tag" → "tags": the field's nouns. */
const plural = (noun: string): string =>
  noun.endsWith("y") ? `${noun.slice(0, -1)}ies` : `${noun}s`;

/**
 * Short items as tokens (plan 5, U13: the stack, the tags): Enter or a comma adds (a paste with
 * commas adds each), Delete or Backspace on a token or its × removes it, Alt with an arrow key or a
 * drag moves it, and a click on a token opens Move and Remove for a single pointer (WCAG 2.5.7).
 * Backspace in the empty field goes to the last token and removes nothing. One polite line says
 * what each key did. A token is one Tab stop; its × is for the pointer.
 */
@Component({
  selector: "app-token-field",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CdkDrag,
    CdkDropList,
    FieldIssueComponent,
    HlmDropdownMenuImports,
    HlmFieldLabel,
    HlmInput,
    NgIcon,
  ],
  viewProviders: [provideIcons({ lucideX })],
  host: {
    class: "change-trace block",
    "[attr.data-change]": "state() === 'live' ? null : state()",
  },
  template: `
    <div class="flex flex-col gap-1.5">
      <div class="flex min-h-6 items-center justify-between gap-3">
        <label hlmFieldLabel [for]="id()">{{ label() }}</label>
        <span class="text-xs tabular-nums text-faint-foreground"
          >{{ entries().length }} / {{ max() }}</span
        >
      </div>
      <p
        [id]="id() + '-hint'"
        [class]="quietHint() ? 'sr-only' : 'm-0 text-hint text-muted-foreground'"
      >
        Enter or a comma adds. On a token, Delete removes it and Alt with an arrow key moves it.
      </p>
      <span [id]="id() + '-state'" class="sr-only">{{ words() }}</span>
      <div class="flex flex-wrap items-center gap-1.5">
        @if (entries().length) {
          <ul
            cdkDropList
            cdkDropListOrientation="mixed"
            class="m-0 flex list-none flex-wrap gap-1.5 p-0"
            [attr.aria-label]="label()"
            (cdkDropListDropped)="dropped($event)"
          >
            @for (entry of entries(); track entry.id; let i = $index) {
              <li
                cdkDrag
                class="flex items-center rounded-sm border border-border bg-surface-2 text-sm"
              >
                <button
                  #token
                  type="button"
                  class="token h-6 cursor-grab rounded-l-sm px-2 underline-offset-2 hover:underline focus-visible:outline-offset-1 pointer-coarse:h-11"
                  translate="no"
                  [hlmDropdownMenuTrigger]="menu"
                  [hlmDropdownMenuTriggerData]="{ $implicit: i }"
                  (keydown)="onTokenKey($event, i)"
                >
                  {{ entry.value }}
                </button>
                <button
                  type="button"
                  tabindex="-1"
                  class="flex size-6 items-center justify-center rounded-r-sm text-muted-foreground hover:text-foreground pointer-coarse:size-11"
                  [attr.aria-label]="'Remove ' + entry.value"
                  (click)="remove(i)"
                >
                  <ng-icon name="lucideX" size="12" aria-hidden="true" />
                </button>
              </li>
            }
          </ul>
        }
        <input
          #field
          hlmInput
          type="text"
          autocomplete="off"
          class="min-w-48 flex-1"
          [id]="id()"
          [placeholder]="'Add a ' + singular() + '…'"
          [attr.aria-invalid]="issue() ? true : null"
          [aria-describedby]="describedBy()"
          (keydown)="onFieldKey($event)"
          (input)="refused.set('')"
        />
      </div>
      <app-field-issue [id]="id() + '-issue'" [message]="issue()" />
      <!-- Why Enter did nothing, under the field until the next keystroke; the line below speaks it. -->
      @if (refused()) {
        <p [id]="id() + '-refused'" class="m-0 text-hint text-destructive">{{ refused() }}</p>
      }
      <p [id]="id() + '-said'" class="sr-only" aria-live="polite">{{ said() }}</p>
    </div>

    <ng-template #menu let-i>
      <hlm-dropdown-menu class="w-44">
        <button hlmDropdownMenuItem type="button" [disabled]="i === 0" (triggered)="move(i, -1)">
          Move left
        </button>
        <button
          hlmDropdownMenuItem
          type="button"
          [disabled]="i === entries().length - 1"
          (triggered)="move(i, 1)"
        >
          Move right
        </button>
        <hlm-dropdown-menu-separator />
        <button hlmDropdownMenuItem type="button" (triggered)="remove(i)">Remove</button>
      </hlm-dropdown-menu>
    </ng-template>
  `,
})
export class TokenFieldComponent {
  readonly value = model.required<string[]>();
  readonly id = input.required<string>();
  readonly label = input.required<string>();
  /** What one token is, for the placeholder and the limit: "technology". */
  readonly singular = input("item");
  readonly max = input(20);
  /** The last save's problem with the list, until it is edited. */
  readonly issue = input<string | null>(null);
  /** The trace, from the editor. */
  readonly state = input<TraceState>("live");
  /** The keys' hint for screen readers only: a page that repeats the field shows it once (Skills' groups). */
  readonly quietHint = input(false);

  protected readonly entries = signal<Token[]>([]);
  /** What the last key did, for screen readers. */
  protected readonly said = signal("");
  /** The last add's refusal (a duplicate, the limit), shown under the field. */
  protected readonly refused = signal("");
  protected readonly words = computed(() => TRACE_WORDS[this.state()]);
  protected readonly describedBy = computed(() =>
    [
      this.issue() ? `${this.id()}-issue` : null,
      this.refused() ? `${this.id()}-refused` : null,
      this.state() === "live" ? null : `${this.id()}-state`,
      `${this.id()}-hint`,
    ]
      .filter(Boolean)
      .join(" "),
  );

  private readonly buttons = viewChildren<ElementRef<HTMLButtonElement>>("token");
  private readonly field = viewChildren<ElementRef<HTMLInputElement>>("field");
  private readonly injector = inject(Injector);
  private gone = false;
  private lastEmitted: string[] = [];

  constructor() {
    inject(DestroyRef).onDestroy(() => (this.gone = true));
    // Rebuilt only when the value changed from outside (a load, a discard, a recovery copy).
    effect(() => {
      const incoming = this.value();
      untracked(() => {
        if (
          incoming.length === this.lastEmitted.length &&
          incoming.every((v, i) => v === this.lastEmitted[i])
        ) {
          return;
        }
        this.entries.set(incoming.map((value) => ({ id: ++tokens, value })));
        this.lastEmitted = [...incoming];
      });
    });
  }

  protected onFieldKey(event: KeyboardEvent): void {
    const field = event.target as HTMLInputElement;
    if ((event.key === "Enter" || event.key === ",") && !event.isComposing) {
      // A comma never lands in the text, and Enter never submits a form.
      event.preventDefault();
      field.value = this.add(field.value);
    } else if (event.key === "Backspace" && field.value === "" && this.entries().length) {
      event.preventDefault();
      this.focusToken(this.entries().length - 1);
    }
  }

  protected onTokenKey(event: KeyboardEvent, index: number): void {
    const back = event.key === "ArrowLeft" || event.key === "ArrowUp";
    if (event.altKey && (back || event.key === "ArrowRight" || event.key === "ArrowDown")) {
      event.preventDefault();
      this.move(index, back ? -1 : 1);
    } else if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      this.remove(index);
    }
  }

  /** Adds each comma-separated part; returns what stays in the field (the parts refused). */
  private add(text: string): string {
    const parts = text
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);
    const list = [...this.entries()];
    const refused: string[] = [];
    let reason = "";
    for (const part of parts) {
      const same = list.find((entry) => entry.value.toLowerCase() === part.toLowerCase());
      if (same) {
        refused.push(part);
        reason = `${same.value} is already in the list.`;
      } else if (list.length >= this.max()) {
        refused.push(part);
        reason = `At most ${this.max()} ${plural(this.singular())}.`;
      } else {
        list.push({ id: ++tokens, value: part });
      }
    }
    const added = list.length - this.entries().length;
    if (added) {
      this.set(list);
      const last = list.at(-1);
      this.said.set(
        added === 1 && last
          ? `${last.value} added, ${list.length} of ${list.length}.`
          : `${added} added.`,
      );
    }
    if (reason) {
      this.said.set(reason);
    }
    this.refused.set(reason);
    return refused.join(", ");
  }

  protected remove(index: number): void {
    const list = [...this.entries()];
    const [gone] = list.splice(index, 1);
    if (!gone) {
      return;
    }
    this.set(list);
    this.said.set(`${gone.value} removed.`);
    // Its neighbour takes the focus, else the field.
    if (list.length) {
      this.focusToken(Math.min(index, list.length - 1));
    } else {
      this.afterRender(() => this.field()[0]?.nativeElement.focus());
    }
  }

  protected move(index: number, by: -1 | 1): void {
    this.moveTo(index, index + by);
  }

  protected dropped(event: CdkDragDrop<unknown>): void {
    this.moveTo(event.previousIndex, event.currentIndex);
  }

  private moveTo(from: number, to: number): void {
    const list = [...this.entries()];
    if (from === to || to < 0 || to >= list.length) {
      return;
    }
    moveItemInArray(list, from, to);
    this.set(list);
    this.said.set(`${list[to].value} moved to ${to + 1} of ${list.length}.`);
    this.focusToken(to);
  }

  private set(list: Token[]): void {
    this.entries.set(list);
    this.lastEmitted = list.map((entry) => entry.value);
    this.value.set(this.lastEmitted);
  }

  /** After the list renders: a moved token is a node moved, which loses the focus. */
  private focusToken(index: number): void {
    this.afterRender(() => this.buttons()[index]?.nativeElement.focus());
  }

  private afterRender(run: () => void): void {
    afterNextRender(() => !this.gone && run(), { injector: this.injector });
  }
}
