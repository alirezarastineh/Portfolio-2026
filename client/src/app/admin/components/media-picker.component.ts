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
import { lucideCheck, lucideImage, lucideUpload, lucideX } from "@ng-icons/lucide";
import { HlmAspectRatio } from "@spartan-ng/helm/aspect-ratio";
import { HlmButton } from "@spartan-ng/helm/button";
import { HlmEmptyImports } from "@spartan-ng/helm/empty";
import { HlmProgressImports } from "@spartan-ng/helm/progress";
import { HlmSpinner } from "@spartan-ng/helm/spinner";

import { AdminApiService, type MediaAsset } from "../admin-api.service";
import { ConfirmService } from "./confirm-dialog.component";

const MAX_BYTES = 4 * 1024 * 1024;
const ACCEPTED = "image/png,image/jpeg,image/webp,image/avif,image/gif";

export const UPLOAD_ERRORS: Record<string, string> = {
  file_too_large: "That file is over 4 MB. Compress it and try again.",
  unsupported_media_type: "Only PNG, JPEG, WebP, AVIF and GIF are accepted.",
  missing_file: "No file was received.",
  invalid_upload: "The upload could not be read.",
  media_in_use: "Still used by a project — change that first.",
};

/**
 * Grid of uploaded images with drag-and-drop upload. Used standalone on the
 * media page and inside the project editor as a picker.
 */
@Component({
  selector: "app-media-picker",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    HlmAspectRatio,
    HlmButton,
    HlmEmptyImports,
    HlmProgressImports,
    HlmSpinner,
    NgIcon,
  ],
  viewProviders: [provideIcons({ lucideCheck, lucideImage, lucideUpload, lucideX })],
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
          <p class="m-0 text-sm text-muted-foreground">Drop an image here, or</p>
          <button hlmBtn variant="outline" size="sm" type="button" (click)="fileInput.click()">
            Choose a file
          </button>
          <p class="m-0 font-mono text-[0.7rem] text-muted-foreground">
            PNG · JPEG · WebP · AVIF · GIF — max 4 MB
          </p>
        }
        <input
          #fileInput
          type="file"
          class="hidden"
          [accept]="accepted"
          (change)="onFileInput($event)"
          aria-label="Upload an image"
        />
      </div>

      @if (loading()) {
        <hlm-spinner class="size-5 self-center" />
      } @else if (!assets().length) {
        <div hlmEmpty class="border border-dashed border-border">
          <div hlmEmptyHeader>
            <div hlmEmptyMedia variant="icon">
              <ng-icon name="lucideImage" size="20" aria-hidden="true" />
            </div>
            <h3 hlmEmptyTitle>No images yet</h3>
            <p hlmEmptyDescription>Upload a screenshot above to use it on a project.</p>
          </div>
        </div>
      } @else {
        <ul
          class="m-0 grid list-none grid-cols-2 gap-3 p-0 sm:grid-cols-3 lg:grid-cols-4"
          role="list"
        >
          @for (asset of assets(); track asset.id) {
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
                  <img
                    [src]="asset.url"
                    [alt]="asset.altEn || asset.originalName"
                    loading="lazy"
                    decoding="async"
                    class="size-full object-cover"
                  />
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
                  {{ asset.width && asset.height ? asset.width + "×" + asset.height : "—" }} ·
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
  readonly chosen = output<MediaAsset>();

  protected readonly accepted = ACCEPTED;
  protected readonly assets = signal<MediaAsset[]>([]);
  protected readonly loading = signal(true);
  protected readonly uploading = signal(false);
  protected readonly progress = signal(0);
  protected readonly dragging = signal(false);

  protected readonly selectedPath = computed(() => this.selected());

  ngOnInit(): void {
    void this.load();
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
      description: "This removes the file from disk. It cannot be undone.",
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!go) return;

    const result = await this.api.deleteMedia(asset.id);

    if (!result.ok) {
      // 409 means a project still points at it — deleting would blank that image.
      toast.error("Not deleted", {
        description: UPLOAD_ERRORS[result.error] ?? result.error,
      });
      return;
    }

    this.assets.update((list) => list.filter((a) => a.id !== asset.id));
    toast.success("Deleted");
  }
}
