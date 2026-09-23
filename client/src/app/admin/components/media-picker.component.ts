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
import { lucideCheck, lucideFileText, lucideImage, lucideUpload, lucideX } from "@ng-icons/lucide";
import { HlmAspectRatio } from "@spartan-ng/helm/aspect-ratio";
import { HlmButton } from "@spartan-ng/helm/button";
import { HlmEmptyImports } from "@spartan-ng/helm/empty";
import { HlmProgressImports } from "@spartan-ng/helm/progress";
import { HlmSpinner } from "@spartan-ng/helm/spinner";

import { AdminApiService, type MediaAsset } from "../admin-api.service";
import { ConfirmService } from "./confirm-dialog.component";

/** Matches the API's MEDIA_MAX_BYTES (10 MiB). */
const MAX_BYTES = 10 * 1024 * 1024;
const IMAGE_TYPES = "image/png,image/jpeg,image/webp,image/avif,image/gif";

export const UPLOAD_ERRORS: Record<string, string> = {
  file_too_large: "That file is over 10 MB. Compress it and try again.",
  image_too_large: "That image is over 50 megapixels. Scale it down and try again.",
  unsupported_media_type: "Only PNG, JPEG, WebP, AVIF, GIF and PDF are accepted.",
  missing_file: "No file was received.",
  invalid_upload: "The upload could not be read.",
  media_in_use:
    "Still used by the draft (a project, gallery, post, experience, CV, photo or a text) — change that first.",
  media_in_use_live: "Shown on the live site right now — publish without it first.",
};

/**
 * Grid of uploaded media with drag-and-drop upload. Used standalone on the
 * media page (images and PDFs) and inside the project editor as an image picker.
 */
@Component({
  selector: "app-media-picker",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [HlmAspectRatio, HlmButton, HlmEmptyImports, HlmProgressImports, HlmSpinner, NgIcon],
  viewProviders: [
    provideIcons({ lucideCheck, lucideFileText, lucideImage, lucideUpload, lucideX }),
  ],
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
            <p class="m-0 font-mono text-[0.72rem] text-muted-foreground">
              uploading… {{ progress() }}%
            </p>
          </div>
        } @else {
          <ng-icon name="lucideUpload" size="20" class="text-muted-foreground" aria-hidden="true" />
          <p class="m-0 text-sm text-muted-foreground">Drop {{ accepts() }} here, or</p>
          <button hlmBtn variant="outline" size="sm" type="button" (click)="fileInput.click()">
            Choose a file
          </button>
          <p class="m-0 font-mono text-[0.7rem] text-muted-foreground">
            {{
              documentsOnly()
                ? "PDF"
                : "PNG · JPEG · WebP · AVIF · GIF" + (allowDocuments() ? " · PDF" : "")
            }}
            — max 10 MB
          </p>
        }
        <input
          #fileInput
          type="file"
          class="hidden"
          [accept]="accepted()"
          (change)="onFileInput($event)"
          [attr.aria-label]="'Upload ' + accepts()"
        />
      </div>

      @if (loading()) {
        <hlm-spinner class="size-5 self-center" />
      } @else if (!visible().length) {
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
          @for (asset of visible(); track asset.id) {
            <li class="relative">
              <button
                type="button"
                class="group block w-full overflow-hidden rounded-lg border-2 text-left transition-colors"
                [class.border-accent-indigo]="selectedPath() === asset.path"
                [class.border-border]="selectedPath() !== asset.path"
                (click)="pick(asset)"
                [attr.aria-pressed]="selectedPath() === asset.path"
              >
                <div [hlmAspectRatio]="16 / 10" class="overflow-hidden bg-muted">
                  @if (asset.kind === "document") {
                    <span class="flex size-full flex-col items-center justify-center gap-1">
                      <ng-icon
                        name="lucideFileText"
                        size="28"
                        class="text-muted-foreground"
                        aria-hidden="true"
                      />
                      <span class="font-mono text-[0.62rem] text-muted-foreground">PDF</span>
                    </span>
                  } @else {
                    <img
                      [src]="thumbnail(asset)"
                      [alt]="asset.altEn || asset.originalName"
                      loading="lazy"
                      decoding="async"
                      class="size-full bg-cover bg-center object-cover"
                      [style.background-image]="
                        asset.blurDataUri ? 'url(' + asset.blurDataUri + ')' : null
                      "
                    />
                  }
                </div>
                <span class="flex items-center justify-between gap-2 px-2 py-1.5">
                  <span
                    class="min-w-0 flex-1 truncate font-mono text-[0.68rem] text-muted-foreground"
                  >
                    {{ asset.originalName }}
                  </span>
                  @if (selectedPath() === asset.path) {
                    <ng-icon
                      name="lucideCheck"
                      size="12"
                      class="text-accent-indigo"
                      aria-hidden="true"
                    />
                  }
                </span>
                <span class="block px-2 pb-1.5 font-mono text-[0.62rem] text-muted-foreground">
                  {{
                    asset.width && asset.height
                      ? asset.width + "×" + asset.height
                      : asset.kind === "document"
                        ? "PDF"
                        : "—"
                  }}
                  ·
                  {{ formatSize(asset.byteSize) }}
                </span>
              </button>

              @if (deletable()) {
                <button
                  hlmBtn
                  variant="ghost"
                  size="sm"
                  type="button"
                  class="absolute right-1 top-1 size-7 bg-card/80 p-0 text-muted-foreground backdrop-blur hover:text-destructive"
                  [attr.aria-label]="'Delete ' + asset.originalName"
                  (click)="remove(asset)"
                >
                  <ng-icon name="lucideX" size="13" aria-hidden="true" />
                </button>
              }
            </li>
          }
        </ul>
      }
    </div>
  `,
})
export class MediaPickerComponent implements OnInit {
  private readonly api = inject(AdminApiService);
  private readonly confirm = inject(ConfirmService);

  /** The currently chosen `/media/<file>` path, when used as a picker. */
  readonly selected = input<string | null>(null);
  readonly deletable = input(false);
  /** PDFs too (the media library); off where only an image makes sense. */
  readonly allowDocuments = input(false);
  /** Only PDFs — for choosing a CV. */
  readonly documentsOnly = input(false);
  readonly chosen = output<MediaAsset>();

  protected readonly accepted = computed(() => {
    if (this.documentsOnly()) return "application/pdf";
    return this.allowDocuments() ? `${IMAGE_TYPES},application/pdf` : IMAGE_TYPES;
  });
  protected readonly assets = signal<MediaAsset[]>([]);
  protected readonly visible = computed(() => {
    if (this.documentsOnly()) return this.assets().filter((a) => a.kind === "document");
    return this.allowDocuments()
      ? this.assets()
      : this.assets().filter((a) => a.kind !== "document");
  });
  protected readonly accepts = computed(() => {
    if (this.documentsOnly()) return "a PDF";
    return this.allowDocuments() ? "an image or a PDF" : "an image";
  });
  protected readonly loading = signal(true);
  protected readonly uploading = signal(false);
  protected readonly progress = signal(0);
  protected readonly dragging = signal(false);

  protected readonly selectedPath = computed(() => this.selected());

  ngOnInit(): void {
    void this.load();
  }

  /**
   * The smallest WebP copy when there is one: a grid of full-size originals is
   * tens of MB. Resolved against the original's absolute URL, so it loads from
   * the same host as the original does.
   */
  protected thumbnail(asset: MediaAsset): string {
    const small = asset.variants.find((v) => v.format === "webp");
    if (!small) return asset.url;
    const file = small.path.slice(small.path.lastIndexOf("/") + 1);
    return asset.url.slice(0, asset.url.lastIndexOf("/") + 1) + file;
  }

  protected formatSize(bytes: number): string {
    return bytes < 1024 * 1024
      ? `${Math.round(bytes / 1024)} KB`
      : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }

  async load(): Promise<void> {
    const result = await this.api.listMedia();
    this.loading.set(false);
    if (result.ok) this.assets.set(result.data.media);
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

  private async upload(file: File): Promise<void> {
    // Check client-side first so an obvious mistake costs no round trip; the
    // server checks again because this one is trivially bypassed.
    if (file.size > MAX_BYTES) {
      toast.error("Too large", { description: UPLOAD_ERRORS["file_too_large"] });
      return;
    }

    this.progress.set(0);
    this.uploading.set(true);
    const result = await this.api.uploadMedia(file, (percent) => this.progress.set(percent));
    this.uploading.set(false);

    if (!result.ok) {
      toast.error("Upload failed", {
        description: UPLOAD_ERRORS[result.error] ?? result.error,
      });
      return;
    }

    await this.load();
    if (result.data.deduped) {
      toast.info("Already uploaded", { description: "Reusing the existing copy." });
    } else {
      toast.success("Uploaded");
    }
    this.chosen.emit(result.data.media);
  }

  protected pick(asset: MediaAsset): void {
    this.chosen.emit(asset);
  }

  protected async remove(asset: MediaAsset): Promise<void> {
    const go = await this.confirm.ask({
      title: `Delete ${asset.originalName}?`,
      description: "This removes the file and its resized copies from disk. It cannot be undone.",
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!go) return;

    let result = await this.api.deleteMedia(asset.id);

    // Only older publications use it: allowed, but a rollback to one of them
    // would then be refused, so that is worth a second question.
    if (!result.ok && result.error === "media_in_history") {
      const anyway = await this.confirm.ask({
        title: "Used by a recent publication",
        description:
          "One of the last 20 publications shows this file. Once it is deleted, rolling back to that publication will be refused. Delete anyway?",
        confirmLabel: "Delete anyway",
        destructive: true,
      });
      if (!anyway) return;
      result = await this.api.deleteMedia(asset.id, true);
    }

    if (!result.ok) {
      // 409: the draft or the live site still uses it — deleting would blank that image.
      toast.error("Not deleted", {
        description: UPLOAD_ERRORS[result.error] ?? result.error,
      });
      return;
    }

    this.assets.update((list) => list.filter((a) => a.id !== asset.id));
    toast.success("Deleted");
  }
}
