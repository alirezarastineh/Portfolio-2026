import {
  CdkDrag,
  CdkDragDrop,
  CdkDragHandle,
  CdkDropList,
  moveItemInArray,
} from "@angular/cdk/drag-drop";
import {
  ChangeDetectionStrategy,
  Component,
  contentChild,
  Directive,
  input,
  output,
  TemplateRef,
} from "@angular/core";
import { NgTemplateOutlet } from "@angular/common";
import { NgIcon, provideIcons } from "@ng-icons/core";
import { lucideGripVertical } from "@ng-icons/lucide";

/** Marks the caller's row template: `<ng-template appSortableRow let-item let-i="index">`. */
@Directive({ selector: "[appSortableRow]" })
export class SortableRowDirective {}

/**
 * Drag-and-drop ordering over `@angular/cdk/drag-drop`, which is already a
 * direct dependency (spartan pulls it in too), so this costs no new package.
 *
 * `cdkDrag` alone is mouse-only, so Alt+↑/↓ is wired up as well — reordering
 * must not require a pointing device.
 */
@Component({
  selector: "app-sortable-list",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CdkDrag, CdkDragHandle, CdkDropList, NgIcon, NgTemplateOutlet],
  viewProviders: [provideIcons({ lucideGripVertical })],
  host: { class: "block" },
  template: `
    <ul
      cdkDropList
      (cdkDropListDropped)="onDrop($event)"
      class="m-0 flex list-none flex-col gap-2 p-0"
      role="list"
    >
      @for (item of items(); track trackBy()(item); let i = $index) {
        <li
          cdkDrag
          class="flex items-start gap-2 rounded-lg border border-border bg-card/50 p-3"
          [attr.aria-label]="label() + ' ' + (i + 1) + ' of ' + items().length"
        >
          <button
            cdkDragHandle
            type="button"
            class="mt-0.5 cursor-grab rounded p-1 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-accent-indigo active:cursor-grabbing"
            [attr.aria-label]="'Reorder ' + label() + ' ' + (i + 1) + '. Use Alt with arrow keys.'"
            (keydown)="onHandleKey($event, i)"
          >
            <ng-icon name="lucideGripVertical" size="16" aria-hidden="true" />
          </button>

          <div class="min-w-0 flex-1">
            <ng-container
              [ngTemplateOutlet]="row() ?? null"
              [ngTemplateOutletContext]="{ $implicit: item, index: i }"
            />
          </div>
        </li>
      } @empty {
        <li
          class="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground"
        >
          {{ emptyText() }}
        </li>
      }
    </ul>
  `,
})
export class SortableListComponent<T> {
  readonly items = input.required<T[]>();
  readonly trackBy = input.required<(item: T) => string>();
  readonly label = input("item");
  readonly emptyText = input("Nothing here yet.");

  /** Emits the reordered array; the caller persists it. */
  readonly reordered = output<T[]>();

  protected readonly row = contentChild(SortableRowDirective, { read: TemplateRef });

  protected onDrop(event: CdkDragDrop<unknown>): void {
    if (event.previousIndex === event.currentIndex) return;

    const next = [...this.items()];
    moveItemInArray(next, event.previousIndex, event.currentIndex);
    this.reordered.emit(next);
  }

  protected onHandleKey(event: KeyboardEvent, index: number): void {
    if (!event.altKey) return;
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;

    const delta = event.key === "ArrowUp" ? -1 : 1;
    const target = index + delta;
    if (target < 0 || target >= this.items().length) return;

    event.preventDefault();
    const next = [...this.items()];
    moveItemInArray(next, index, target);
    this.reordered.emit(next);
  }
}
