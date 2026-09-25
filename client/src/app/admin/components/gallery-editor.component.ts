import {
  ChangeDetectionStrategy,
  Component,
  inject,
  input,
  model,
  OnInit,
  signal,
} from "@angular/core";
import { FormsModule } from "@angular/forms";
import { NgIcon, provideIcons } from "@ng-icons/core";
import { lucidePlus, lucideTrash2 } from "@ng-icons/lucide";
import { toast } from "@spartan-ng/brain/sonner";
import { HlmButton } from "@spartan-ng/helm/button";
import { HlmInput } from "@spartan-ng/helm/input";
import { HlmSheetImports } from "@spartan-ng/helm/sheet";

import type { MediaAsset } from "../admin-api.service";
import { MediaLibraryService } from "../media-library.service";
import { MediaPickerComponent } from "./media-picker.component";
import { SortableListComponent, SortableRowDirective } from "./sortable-list.component";

export interface GalleryItem {
  mediaId: string;
  caption: { en: string; de: string };
  /** `/media/<file>`, for the preview only. */
  path: string;
}

const MAX = 30;

/** A case study's screenshots: add from the library, drag to order, caption in both languages. */
@Component({
  selector: "app-gallery-editor",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    HlmButton,
    HlmInput,
    HlmSheetImports,
    MediaPickerComponent,
    NgIcon,
    SortableListComponent,
    SortableRowDirective,
  ],
  viewProviders: [provideIcons({ lucidePlus, lucideTrash2 })],
  host: { class: "block" },
  template: `
    <div class="flex flex-col gap-3">
      <div class="flex items-baseline justify-between">
        <span class="font-mono text-[0.8rem]">{{ label() }}</span>
        <span class="font-mono text-[0.7rem] text-muted-foreground"
          >{{ value().length }} / {{ max }}</span
        >
      </div>

      <app-sortable-list
        [items]="value()"
        [trackBy]="track"
        label="image"
        emptyText="No gallery images yet."
        (reordered)="value.set($event)"
      >
        <ng-template appSortableRow let-item let-i="index">
          <div class="flex items-start gap-3">
            <img
              [src]="preview(item.path)"
              alt=""
              class="h-14 w-24 shrink-0 rounded border border-border object-cover"
            />
            <div class="grid min-w-0 flex-1 gap-2 sm:grid-cols-2">
              <input
                hlmInput
                class="h-8"
                placeholder="Caption (EN)"
                [ngModel]="item.caption.en"
                (ngModelChange)="caption(i, 'en', $event)"
                [attr.aria-label]="'Caption in English for image ' + (i + 1)"
              />
              <input
                hlmInput
                class="h-8"
                placeholder="Bildunterschrift (DE)"
                [ngModel]="item.caption.de"
                (ngModelChange)="caption(i, 'de', $event)"
                [attr.aria-label]="'Caption in German for image ' + (i + 1)"
              />
            </div>
            <button
              hlmBtn
              variant="ghost"
              size="sm"
              type="button"
              class="h-8 px-2 text-muted-foreground hover:text-destructive"
              (click)="remove(i)"
              [attr.aria-label]="'Remove image ' + (i + 1)"
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
        [disabled]="value().length >= max"
        (click)="open.set(true)"
      >
        <ng-icon name="lucidePlus" size="14" aria-hidden="true" />
        <span class="ml-1.5">Add image</span>
      </button>
    </div>

    <hlm-sheet
      side="right"
      [state]="open() ? 'open' : 'closed'"
      (stateChanged)="open.set($event === 'open')"
    >
      <hlm-sheet-content *hlmSheetPortal="let ctx" class="w-full overflow-y-auto sm:max-w-2xl">
        <hlm-sheet-header>
          <h2 hlmSheetTitle>Add to the gallery</h2>
          <p hlmSheetDescription>Pick an image; it goes to the end of the gallery.</p>
        </hlm-sheet-header>
        <div class="px-4 pb-6">
          <app-media-picker (chosen)="add($event)" />
        </div>
      </hlm-sheet-content>
    </hlm-sheet>
  `,
})
export class GalleryEditorComponent implements OnInit {
  private readonly library = inject(MediaLibraryService);

  readonly value = model.required<GalleryItem[]>();
  readonly label = input("Gallery");
  protected readonly max = MAX;
  protected readonly open = signal(false);

  protected readonly track = (item: GalleryItem): string => item.mediaId;

  ngOnInit(): void {
    void this.library.load();
  }

  /** A small resized copy, not the full screenshot. */
  protected preview(path: string): string {
    return this.library.thumbnail(path);
  }

  protected add(asset: MediaAsset): void {
    if (asset.kind !== "image") {
      toast.error("Choose an image");
      return;
    }
    if (this.value().some((item) => item.mediaId === asset.id)) {
      toast.info("Already in the gallery");
      return;
    }
    this.open.set(false);
    this.value.update((list) => [
      ...list,
      { mediaId: asset.id, caption: { en: "", de: "" }, path: asset.path },
    ]);
  }

  protected caption(index: number, locale: "en" | "de", text: string): void {
    this.value.update((list) =>
      list.map((item, i) =>
        i === index ? { ...item, caption: { ...item.caption, [locale]: text } } : item,
      ),
    );
  }

  protected remove(index: number): void {
    this.value.update((list) => list.filter((_, i) => i !== index));
  }
}
