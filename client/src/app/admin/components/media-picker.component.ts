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
import { isUnused, MediaLibraryService } from "../media-library.service";
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

      @if (deletable() && !loading()) {
        <!-- The library's own tools: which files nothing uses, and removing them. -->
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div class="flex items-center gap-1" role="group" aria-label="Show">
            @for (option of filters; track option.id) {
              <button
                hlmBtn
                size="sm"
                type="button"
                [variant]="filter() === option.id ? 'secondary' : 'ghost'"
                [attr.aria-pressed]="filter() === option.id"
                (click)="filter.set(option.id)"
              >
                {{ option.label }}
                <span class="ml-1.5 font-mono text-[0.68rem] text-muted-foreground">{{
                  option.id === "unused" ? unused().length : offeredCount()
                }}</span>
              </button>
            }
          </div>
          <button
            hlmBtn
            variant="outline"
            size="sm"
            type="button"
            [disabled]="!unused().length || cleaning()"
            (click)="cleanup()"
          >
            @if (cleaning()) {
              <hlm-spinner class="size-4" />
            } @else {
              Clean up unused ({{ formatSize(unusedBytes()) }})
            }
          </button>
        </div>
      }

      @if (loading()) {
        <hlm-spinner class="size-5 self-center" />
      } @else if (!visible().length) {
        <div hlmEmpty class="border border-dashed border-border">
          <div hlmEmptyHeader>
            <div hlmEmptyMedia variant="icon">
              <ng-icon name="lucideImage" size="20" aria-hidden="true" />
            </div>
            @if (filter() === "unused") {
              <h3 hlmEmptyTitle>Nothing unused</h3>
              <p hlmEmptyDescription>Every file is used by the draft or the live site.</p>
            } @else {
              <h3 hlmEmptyTitle>{{ documentsOnly() ? "No PDFs yet" : "No images yet" }}</h3>
              <p hlmEmptyDescription>Upload {{ accepts() }} above to use it here.</p>
            }
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
                      [src]="library.thumbnailOf(asset)"
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
                <span
                  class="flex items-center justify-between gap-2 px-2 pb-1.5 font-mono text-[0.62rem] text-muted-foreground"
                >
                  <span>
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
                  @if (deletable() && asset.usage) {
                    <span [class]="usageClass(asset)" [title]="usageTitle(asset)">{{
                      usageLabel(asset)
                    }}</span>
                  }
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
  protected readonly library = inject(MediaLibraryService);

  /** The currently chosen `/media/<file>` path, when used as a picker. */
  readonly selected = input<string | null>(null);
  /** The media library itself: delete buttons, usage, the unused filter and cleanup. */
  readonly deletable = input(false);
  /** PDFs too (the media library); off where only an image makes sense. */
  readonly allowDocuments = input(false);
  /** Only PDFs — for choosing a CV. */
  readonly documentsOnly = input(false);
  readonly chosen = output<MediaAsset>();
  /** After files were added or deleted (the page's totals are then out of date). */
  readonly changed = output<void>();

  protected readonly filters: { id: MediaFilter; label: string }[] = [
    { id: "all", label: "All" },
    { id: "unused", label: "Unused" },
  ];
  protected readonly filter = signal<MediaFilter>("all");

  protected readonly accepted = computed(() => {
    if (this.documentsOnly()) return "application/pdf";
    return this.allowDocuments() ? `${IMAGE_TYPES},application/pdf` : IMAGE_TYPES;
  });
  /** The kinds this picker offers, before the unused filter. */
  private readonly offered = computed(() => {
    const assets = this.library.assets();
    if (this.documentsOnly()) return assets.filter((a) => a.kind === "document");
    return this.allowDocuments() ? assets : assets.filter((a) => a.kind !== "document");
  });
  protected readonly offeredCount = computed(() => this.offered().length);
  protected readonly unused = computed(() => this.offered().filter(isUnused));
  protected readonly unusedBytes = computed(() =>
    this.unused().reduce((sum, a) => sum + a.byteSize, 0),
  );
  protected readonly visible = computed(() =>
    this.filter() === "unused" ? this.unused() : this.offered(),
  );
  protected readonly accepts = computed(() => {
    if (this.documentsOnly()) return "a PDF";
    return this.allowDocuments() ? "an image or a PDF" : "an image";
  });
  protected readonly loading = computed(() => !this.library.loaded());
  protected readonly uploading = signal(false);
  protected readonly cleaning = signal(false);
  protected readonly progress = signal(0);
  protected readonly dragging = signal(false);

  protected readonly selectedPath = computed(() => this.selected());

  ngOnInit(): void {
    // The library page always wants current usage; a picker can reuse the list.
    void this.library.load(this.deletable());
  }

  protected usageLabel(asset: MediaAsset): string {
    if (asset.usage?.live) return "live";
    if (asset.usage?.draft.length) return "in draft";
    return "unused";
  }

  protected usageClass(asset: MediaAsset): string {
    return isUnused(asset) ? "text-muted-foreground/70" : "text-accent-indigo";
  }

  protected usageTitle(asset: MediaAsset): string {
    const usage = asset.usage;
    if (!usage) return "";
    const parts = [
      ...usage.draft,
      ...(usage.live ? ["the live site"] : []),
      ...(usage.recent ? ["a recent publication"] : []),
    ];
    return parts.length ? `Used by ${parts.join(", ")}` : "Not used anywhere";
  }

  protected formatSize(bytes: number): string {
    return formatBytes(bytes);
  }

  async load(): Promise<void> {
    await this.library.load(true);
  }

  /**
   * Deletes what nothing uses. Files that only recent publications show are
   * asked about separately: deleting them makes a rollback to those refuse.
   */
  protected async cleanup(): Promise<void> {
    const unused = this.unused();
    const safe = unused.filter((a) => !a.usage?.recent);
    const inHistory = unused.filter((a) => a.usage?.recent);
    const ids: string[] = [];

    if (safe.length > 0) {
      const go = await this.confirm.ask({
        title: `Delete ${safe.length} unused ${safe.length === 1 ? "file" : "files"}?`,
        description: `Neither the draft nor the live site uses them. ${formatBytes(
          safe.reduce((sum, a) => sum + a.byteSize, 0),
        )} of originals, plus their resized copies. This cannot be undone.`,
        confirmLabel: "Delete",
        destructive: true,
      });
      if (!go) return;
      ids.push(...safe.map((a) => a.id));
    }
    let includeHistory = false;
    if (inHistory.length > 0) {
      includeHistory = await this.confirm.ask({
        title: `Also delete ${inHistory.length} kept for rollbacks?`,
        description:
          "One of the last 20 publications still shows them. Once deleted, rolling back to those publications will be refused.",
        confirmLabel: "Delete them too",
        cancelLabel: "Keep them",
        destructive: true,
      });
      if (includeHistory) ids.push(...inHistory.map((a) => a.id));
    }
    if (ids.length === 0) return;

    this.cleaning.set(true);
    const result = await this.api.cleanupMedia(ids, includeHistory);
    this.cleaning.set(false);
    if (!result.ok) {
      toast.error("Cleanup failed", { description: result.error });
      return;
    }

    await this.library.load(true);
    this.changed.emit();
    const { deleted, skipped, freedBytes } = result.data;
    toast.success(`Deleted ${deleted.length} ${deleted.length === 1 ? "file" : "files"}`, {
      description:
        `${formatBytes(freedBytes)} freed.` +
        (skipped.length ? ` ${skipped.length} became used meanwhile and were kept.` : ""),
    });
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
    this.changed.emit();
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

    await this.library.load(true);
    this.changed.emit();
    toast.success("Deleted");
  }
}

type MediaFilter = "all" | "unused";

function formatBytes(bytes: number): string {
  return bytes < 1024 * 1024
    ? `${Math.round(bytes / 1024)} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
