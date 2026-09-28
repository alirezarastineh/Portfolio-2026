import { ChangeDetectionStrategy, Component, computed, inject, input } from "@angular/core";
import { HlmResizableImports } from "@spartan-ng/helm/resizable";

import type { OutlineItem } from "../editor-outline";
import type { LiveCompose } from "../preview/live-content";
import { LivePreviewComponent, type PreviewFocus } from "../preview/live-preview.component";
import { clampSize, LivePreviewService, PREVIEW_SIZE } from "../preview/live-preview.service";
import { EditorOutlineComponent } from "./editor-outline.component";
import type { LocaleView } from "./field-pair.component";

/**
 * An editor page's frame: its column, and on the right either the live
 * preview (from `lg`, when switched on: the two share the width, with a handle
 * between them) or the outline rail (from `xl`, when the editor has one).
 *
 * The page puts its one `flex flex-col gap-6` column inside, page header
 * first, as before: the column stays one block, so the header sticks for its
 * whole length. The editor's panel does not clip (Spartan's panels do), for
 * the same reason; the preview's panel sticks to the top of the window, so it
 * stays in view down a long form.
 */
@Component({
  selector: "app-editor-layout",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [EditorOutlineComponent, HlmResizableImports, LivePreviewComponent],
  host: { class: "block" },
  template: `
    <div class="mx-auto flex items-stretch gap-8" [class]="width()">
      <div hlmResizableGroup class="min-w-0 flex-1" (layoutChange)="onLayout($event)">
        <div
          hlmResizablePanel
          id="editor-panel"
          [defaultSize]="100"
          [collapsible]="false"
          class="min-w-0 overflow-visible!"
          [class.pr-6]="split()"
        >
          <ng-content />
        </div>
        @if (split()) {
          <hlm-resizable-handle
            withHandle
            aria-label="Width of the editor beside the preview"
            aria-controls="editor-panel preview-panel"
            [attr.aria-valuenow]="editorShare()"
            [attr.aria-valuemin]="100 - sizes.max"
            [attr.aria-valuemax]="100 - sizes.min"
          />
          <div
            hlmResizablePanel
            id="preview-panel"
            [defaultSize]="preview.size()"
            [minSize]="sizes.min"
            [maxSize]="sizes.max"
            [collapsible]="false"
            class="sticky top-0 z-40 h-svh min-w-0 self-start border-l border-border"
          >
            <app-live-preview
              [compose]="compose()!"
              [anchor]="anchor()"
              [focus]="focus()"
              [focusKey]="focusKey()"
              [note]="note()"
              [view]="view()"
            />
          </div>
        }
      </div>
      @if (!split() && outline().length) {
        <app-editor-outline class="hidden w-48 shrink-0 xl:block" [items]="outline()" />
      }
    </div>
  `,
})
export class EditorLayoutComponent {
  /** The editor's sections, for the rail; none, no rail. */
  readonly outline = input<OutlineItem[]>([]);
  /** The editor's unsaved state over the draft; null, no preview. */
  readonly compose = input<LiveCompose | null>(null);
  /** The home page section the editor fills. */
  readonly anchor = input("hero");
  readonly focus = input<PreviewFocus>(null);
  readonly focusKey = input<string | null>(null);
  readonly note = input<string | null>(null);
  readonly view = input<LocaleView>("both");

  protected readonly preview = inject(LivePreviewService);
  protected readonly sizes = PREVIEW_SIZE;

  /** Editor and preview side by side. */
  protected readonly split = computed(
    () => this.compose() !== null && this.preview.open() && this.preview.wide(),
  );

  protected readonly width = computed(() => {
    if (this.split()) return "max-w-none";
    return this.outline().length ? "max-w-4xl xl:max-w-6xl" : "max-w-4xl";
  });

  protected readonly editorShare = computed(() => Math.round(100 - this.preview.size()));

  protected onLayout(sizes: number[]): void {
    const size = sizes[1];
    if (sizes.length === 2 && size !== undefined) this.preview.size.set(clampSize(size));
  }
}
