import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  effect,
  ElementRef,
  inject,
  Injector,
  input,
  model,
  signal,
  untracked,
} from "@angular/core";
import { FormsModule } from "@angular/forms";
import { NgIcon, provideIcons } from "@ng-icons/core";
import { lucidePlus, lucideTrash2 } from "@ng-icons/lucide";
import { HlmButton } from "@spartan-ng/helm/button";
import { HlmInput } from "@spartan-ng/helm/input";
import { HlmTextarea } from "@spartan-ng/helm/textarea";

import { SortableListComponent, SortableRowDirective } from "./sortable-list.component";

interface Entry {
  id: string;
  value: string;
}

let counter = 0;

/**
 * An ordered list of free-text values — skill tags, tech stack, outcomes.
 *
 * Entries carry a synthetic id so the `@for` track and drag reorder stay stable
 * while the text is being edited; tracking by value would re-create rows on
 * every keystroke and lose focus.
 */
@Component({
  selector: "app-string-list",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    HlmButton,
    HlmInput,
    HlmTextarea,
    NgIcon,
    SortableListComponent,
    SortableRowDirective,
  ],
  viewProviders: [provideIcons({ lucidePlus, lucideTrash2 })],
  host: { class: "block" },
  template: `
    <div class="flex flex-col gap-3">
      <div class="flex items-baseline justify-between gap-3">
        <span class="text-sm font-medium">{{ label() }}</span>
        <span class="text-xs text-muted-foreground tabular-nums">
          {{ entries().length }}{{ max() ? " / " + max() : "" }}
        </span>
      </div>

      <app-sortable-list
        [items]="entries()"
        [trackBy]="trackEntry"
        [label]="label()"
        [emptyText]="emptyText()"
        [ruled]="multiline()"
        (reordered)="onReorder($event)"
      >
        <ng-template appSortableRow let-entry let-i="index">
          <div class="flex items-center gap-2">
            <!-- Standalone: inside a page's form (the experience sheet), nameless
                 rows would share one control and all show the last value. -->
            @if (multiline()) {
              <!-- Grows with its text (hlmTextarea's field-sizing): a sentence is never cut. -->
              <textarea
                hlmTextarea
                rows="2"
                class="min-h-9 flex-1 py-1.5"
                autocomplete="off"
                [attr.lang]="lang()"
                [ngModel]="entry.value"
                [ngModelOptions]="{ standalone: true }"
                (ngModelChange)="update(entry.id, $event)"
                [attr.aria-label]="label() + ' ' + (i + 1)"
              ></textarea>
            } @else {
              <input
                hlmInput
                class="h-8 flex-1"
                [ngModel]="entry.value"
                [ngModelOptions]="{ standalone: true }"
                (ngModelChange)="update(entry.id, $event)"
                [attr.aria-label]="label() + ' ' + (i + 1)"
              />
            }
            <button
              hlmBtn
              variant="ghost"
              size="sm"
              type="button"
              class="h-8 px-2 text-muted-foreground hover:text-destructive pointer-coarse:min-w-11"
              data-remove
              [attr.aria-label]="'Remove ' + label() + ' ' + (i + 1)"
              (click)="remove(entry.id)"
            >
              <ng-icon name="lucideTrash2" size="14" aria-hidden="true" />
            </button>
          </div>
        </ng-template>
      </app-sortable-list>

      <button
        hlmBtn
        variant="outline"
        size="sm"
        type="button"
        class="self-start"
        data-add
        [disabled]="max() > 0 && entries().length >= max()"
        (click)="add()"
      >
        <ng-icon name="lucidePlus" size="14" aria-hidden="true" />
        <span class="ml-1.5">Add {{ singular() }}</span>
      </button>
    </div>
  `,
})
export class StringListComponent {
  readonly value = model.required<string[]>();
  readonly label = input("Items");
  readonly singular = input("item");
  readonly emptyText = input("No entries yet.");
  readonly max = input(0);
  /** Sentences (a project's outcomes): each a growing textarea, never one cut line. */
  readonly multiline = input(false);
  /** The entries' language, for spelling and screen readers. */
  readonly lang = input<string | null>(null);

  private readonly entriesState = signal<Entry[]>([]);
  private lastEmitted: string[] = [];
  private readonly host = inject(ElementRef);
  private readonly injector = inject(Injector);

  protected readonly entries = this.entriesState.asReadonly();

  constructor() {
    effect(() => {
      const incoming = this.value();
      // Rebuild rows only when the value genuinely changed from outside.
      // Re-keying on every keystroke would recreate the inputs and steal focus.
      untracked(() => this.syncFromValue(incoming));
    });
  }

  private syncFromValue(incoming: string[]): void {
    if (this.sameAsLast(incoming)) {
      return;
    }

    this.entriesState.set(incoming.map((v) => ({ id: `s${counter++}`, value: v })));
    this.lastEmitted = [...incoming];
  }

  private sameAsLast(next: string[]): boolean {
    return (
      next.length === this.lastEmitted.length && next.every((v, i) => v === this.lastEmitted[i])
    );
  }

  protected readonly trackEntry = (entry: Entry): string => entry.id;

  private emit(): void {
    const next = this.entriesState().map((e) => e.value);
    this.lastEmitted = next;
    this.value.set(next);
  }

  protected update(id: string, value: string): void {
    this.entriesState.update((list) => list.map((e) => (e.id === id ? { ...e, value } : e)));
    this.emit();
  }

  protected remove(id: string): void {
    const at = this.entriesState().findIndex((e) => e.id === id);
    this.entriesState.update((list) => list.filter((e) => e.id !== id));
    this.emit();
    // The button went with its row: the next row's Remove takes the focus, else Add.
    afterNextRender(
      () => {
        const root = this.host.nativeElement as HTMLElement;
        const removes = root.querySelectorAll<HTMLButtonElement>("button[data-remove]");
        (
          removes[Math.min(at, removes.length - 1)] ?? root.querySelector("button[data-add]")
        )?.focus();
      },
      { injector: this.injector },
    );
  }

  protected add(): void {
    this.entriesState.update((list) => [...list, { id: `s${counter++}`, value: "" }]);
    this.emit();
  }

  protected onReorder(next: Entry[]): void {
    this.entriesState.set(next);
    this.emit();
  }
}
