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
import { toast } from "@spartan-ng/brain/sonner";
import { NgIcon, provideIcons } from "@ng-icons/core";
import { lucideCheck, lucideImage, lucideUpload } from "@ng-icons/lucide";
import { HlmButton } from "@spartan-ng/helm/button";
import { HlmEmptyImports } from "@spartan-ng/helm/empty";
import { HlmProgressImports } from "@spartan-ng/helm/progress";
import { HlmSpinner } from "@spartan-ng/helm/spinner";

import type { MediaAsset } from "../admin-api.service";
import { MediaLibraryService } from "../media-library.service";
import { MediaTileComponent } from "./media-tile.component";

const IMAGE_TYPES = "image/png,image/jpeg,image/webp,image/avif,image/gif";

/**
 * Choosing a file for a field (a cover, a logo, a CV, a gallery image, an
 * image in a text): the library's images (or PDFs) as tiles, and a drop zone
 * for a new one, which is chosen once uploaded. The library itself, with its
 * details, cleanup and deletion, is the Media page.
 */
@Component({
  selector: "app-media-picker",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [HlmButton, HlmEmptyImports, HlmProgressImports, HlmSpinner, MediaTileComponent, NgIcon],
  viewProviders: [provideIcons({ lucideCheck, lucideImage, lucideUpload })],
  host: { class: "block" },
  template: `
    <div class="flex flex-col gap-4">
      <div
        class="flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-6 text-center transition-colors"
        [class.border-accent-indigo]="dragging()"
        [class.border-border]="!dragging()"
        (dragover)="onDragOver($event)"
        (dragleave)="dragging.set(false)"
        (drop)="onDrop($event)"
      >
        @if (uploading()) {
          <div class="flex w-full max-w-xs flex-col gap-2">
            <hlm-progress [value]="progress()" aria-label="Upload progress">
              <hlm-progress-indicator />
            </hlm-progress>
            <p class="m-0 font-mono text-xs text-muted-foreground">uploading… {{ progress() }}%</p>
          </div>
        } @else {
          <ng-icon name="lucideUpload" size="20" class="text-muted-foreground" aria-hidden="true" />
          <p class="m-0 text-sm text-muted-foreground">Drop {{ accepts() }} here, or</p>
          <button hlmBtn variant="outline" size="sm" type="button" (click)="fileInput.click()">
            Choose a file
          </button>
          <p class="m-0 font-mono text-xs text-muted-foreground">
            {{ documentsOnly() ? "PDF" : "PNG · JPEG · WebP · AVIF · GIF" }} — max 10 MB
          </p>
        }
        <input
          #fileInput
          type="file"
          class="hidden"
          [accept]="documentsOnly() ? 'application/pdf' : imageTypes"
          (change)="onFileInput($event)"
          [attr.aria-label]="'Upload ' + accepts()"
        />
      </div>

      @if (loading()) {
        <hlm-spinner class="size-5 self-center" />
      } @else if (!offered().length) {
        <div hlmEmpty class="border border-dashed border-border">
          <div hlmEmptyHeader>
            <div hlmEmptyMedia variant="icon">
              <ng-icon name="lucideImage" size="20" aria-hidden="true" />
            </div>
            <h3 hlmEmptyTitle>{{ documentsOnly() ? "No PDFs yet" : "No images yet" }}</h3>
            <p hlmEmptyDescription>Upload {{ accepts() }} above to use it here.</p>
          </div>
        </div>
      } @else {
        <ul
          class="m-0 grid list-none grid-cols-2 gap-3 p-0 sm:grid-cols-3 lg:grid-cols-4"
          role="list"
        >
          @for (asset of offered(); track asset.id) {
            @let isSelected = selected() === asset.path;
            <li>
              <button
                type="button"
                class="relative block w-full overflow-hidden rounded-lg border-2 text-left transition-colors hover:border-border-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                [class]="isSelected ? 'border-accent-indigo' : 'border-border'"
                [attr.aria-pressed]="isSelected"
                (click)="chosen.emit(asset)"
              >
                <app-media-tile [asset]="asset" />
                @if (isSelected) {
                  <span
                    class="absolute right-1.5 top-1.5 flex size-5 items-center justify-center rounded-full bg-accent-indigo text-background"
                    aria-hidden="true"
                  >
                    <ng-icon name="lucideCheck" size="12" />
                  </span>
                }
              </button>
            </li>
          }
        </ul>
      }
    </div>
  `,
})
export class MediaPickerComponent implements OnInit {
  protected readonly library = inject(MediaLibraryService);

  /** The currently chosen `/media/<file>` path. */
  readonly selected = input<string | null>(null);
  /** Only PDFs — for choosing a CV. */
  readonly documentsOnly = input(false);
  readonly chosen = output<MediaAsset>();

  protected readonly imageTypes = IMAGE_TYPES;
  protected readonly offered = computed(() =>
    this.library
      .assets()
      .filter((a) => (this.documentsOnly() ? a.kind === "document" : a.kind === "image")),
  );
  protected readonly accepts = computed(() => (this.documentsOnly() ? "a PDF" : "an image"));
  protected readonly loading = computed(() => !this.library.loaded());
  protected readonly uploading = signal(false);
  protected readonly progress = signal(0);
  protected readonly dragging = signal(false);

  ngOnInit(): void {
    void this.library.load();
  }

  protected onDragOver(event: DragEvent): void {
    event.preventDefault();
    this.dragging.set(true);
  }

  protected onDrop(event: DragEvent): void {
    event.preventDefault();
    this.dragging.set(false);
    const file = event.dataTransfer?.files?.[0];
    if (file) void this.upload(file);
  }

  protected onFileInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) void this.upload(file);
    // Reset so re-picking the same file fires change again.
    input.value = "";
  }

  /** Uploads, then chooses what was uploaded. */
  private async upload(file: File): Promise<void> {
    this.progress.set(0);
    this.uploading.set(true);
    const result = await this.library.upload(file, (percent) => this.progress.set(percent));
    this.uploading.set(false);
    if (!result.ok) {
      toast.error("Upload failed", { description: result.message });
      return;
    }
    if (result.deduped)
      toast.info("Already uploaded", { description: "Reusing the existing copy." });
    else toast.success("Uploaded");
    this.chosen.emit(result.asset);
  }
}
