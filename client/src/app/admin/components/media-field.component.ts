import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  OnInit,
  output,
  signal,
} from "@angular/core";
import { NgIcon, provideIcons } from "@ng-icons/core";
import { lucideFileText, lucideImage, lucideX } from "@ng-icons/lucide";
import { toast } from "@spartan-ng/brain/sonner";
import { HlmButton } from "@spartan-ng/helm/button";
import { HlmSheetImports } from "@spartan-ng/helm/sheet";

import type { MediaAsset } from "../admin-api.service";
import { MediaLibraryService } from "../media-library.service";
import { MediaPickerComponent } from "./media-picker.component";

/**
 * One media slot — a cover, an avatar, a logo, a CV: a preview, "Choose…"
 * (the library in a side sheet, so the form stays in view) and "Remove".
 * Emits the chosen asset, or null when cleared.
 */
@Component({
  selector: "app-media-field",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [HlmButton, HlmSheetImports, MediaPickerComponent, NgIcon],
  viewProviders: [provideIcons({ lucideFileText, lucideImage, lucideX })],
  host: { class: "block" },
  template: `
    <div class="flex flex-col gap-2">
      <span class="font-mono text-[0.8rem]" [id]="id() + '-label'">{{ label() }}</span>
      @if (hint()) {
        <p class="m-0 text-[0.75rem] text-muted-foreground">{{ hint() }}</p>
      }
      <div class="flex items-center gap-3" role="group" [attr.aria-labelledby]="id() + '-label'">
        <div
          class="flex h-16 w-24 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-muted"
        >
          @if (path() && kind() === "image") {
            <img [src]="preview()" alt="" class="size-full object-cover" />
          } @else if (path()) {
            <ng-icon
              name="lucideFileText"
              size="22"
              class="text-muted-foreground"
              aria-hidden="true"
            />
          } @else {
            <ng-icon
              name="lucideImage"
              size="18"
              class="text-muted-foreground/60"
              aria-hidden="true"
            />
          }
        </div>
        <div class="flex min-w-0 flex-col gap-1.5">
          <span class="truncate font-mono text-[0.7rem] text-muted-foreground">
            {{ caption() || path() || "none" }}
          </span>
          <div class="flex gap-2">
            <button hlmBtn variant="outline" size="sm" type="button" (click)="open.set(true)">
              {{ path() ? "Replace…" : "Choose…" }}
            </button>
            @if (path()) {
              <button
                hlmBtn
                variant="ghost"
                size="sm"
                type="button"
                class="text-muted-foreground hover:text-destructive"
                (click)="chosen.emit(null)"
                [attr.aria-label]="'Remove ' + label()"
              >
                <ng-icon name="lucideX" size="14" aria-hidden="true" />
              </button>
            }
          </div>
        </div>
      </div>
    </div>

    <hlm-sheet
      side="right"
      [state]="open() ? 'open' : 'closed'"
      (stateChanged)="open.set($event === 'open')"
    >
      <hlm-sheet-content *hlmSheetPortal="let ctx" class="w-full overflow-y-auto sm:max-w-2xl">
        <hlm-sheet-header>
          <h2 hlmSheetTitle>{{ label() }}</h2>
          <p hlmSheetDescription>Upload a new file or pick one from the library.</p>
        </hlm-sheet-header>
        <div class="px-4 pb-6">
          <app-media-picker
            [selected]="path()"
            [documentsOnly]="kind() === 'document'"
            (chosen)="pick($event)"
          />
        </div>
      </hlm-sheet-content>
    </hlm-sheet>
  `,
})
export class MediaFieldComponent implements OnInit {
  private readonly library = inject(MediaLibraryService);

  readonly id = input.required<string>();
  readonly label = input.required<string>();
  readonly hint = input("");
  /** The current `/media/<file>`, or null. */
  readonly path = input<string | null>(null);
  readonly kind = input<"image" | "document">("image");
  /** Shown next to the preview, e.g. the original filename. */
  readonly caption = input("");
  readonly chosen = output<MediaAsset | null>();

  protected readonly open = signal(false);
  /** A small resized copy once the library is loaded; the original (from the API host) before. */
  protected readonly preview = computed(() => this.library.thumbnail(this.path()));

  ngOnInit(): void {
    void this.library.load();
  }

  protected pick(asset: MediaAsset): void {
    if (asset.kind !== this.kind()) {
      toast.error(this.kind() === "image" ? "Choose an image" : "Choose a PDF");
      return;
    }
    this.open.set(false);
    this.chosen.emit(asset);
  }
}
