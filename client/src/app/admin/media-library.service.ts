import { computed, inject, Injectable, signal } from "@angular/core";

import { AdminApiService, type MediaAsset } from "./admin-api.service";

/** Matches the API's MEDIA_MAX_BYTES (10 MiB). */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

/** What the library takes: the images the API processes, and PDFs. */
export const UPLOAD_ACCEPT = "image/png,image/jpeg,image/webp,image/avif,image/gif,application/pdf";

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

export type Uploaded =
  { ok: true; asset: MediaAsset; deduped: boolean } | { ok: false; message: string };

/** Not used by the draft, not shown live — safe to delete, bar rollbacks. */
export function isUnused(asset: MediaAsset): boolean {
  return !!asset.usage && asset.usage.draft.length === 0 && !asset.usage.live;
}

export function formatBytes(bytes: number): string {
  return bytes < 1024 * 1024
    ? `${Math.round(bytes / 1024)} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * The media library, loaded once per admin visit and shared: the grid, every
 * cover/logo/photo field and the gallery editor read it, so a preview can use
 * a small resized copy instead of downloading the original.
 *
 * Provided by the admin route, alongside the `AdminApiService` it calls.
 */
@Injectable()
export class MediaLibraryService {
  private readonly api = inject(AdminApiService);

  readonly assets = signal<MediaAsset[]>([]);
  readonly loaded = signal(false);
  private inFlight: Promise<void> | null = null;

  private readonly byPath = computed(() => new Map(this.assets().map((a) => [a.path, a])));

  /** Loads once; `force` fetches again (after an upload, a delete or a cleanup). */
  load(force = false): Promise<void> {
    if (this.loaded() && !force) return Promise.resolve();
    if (this.inFlight && !force) return this.inFlight;
    this.inFlight = this.fetch().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  private async fetch(): Promise<void> {
    const result = await this.api.listMedia();
    if (result.ok) this.assets.set(result.data.media);
    this.loaded.set(true);
  }

  /**
   * Uploads one file and reloads the library. Checked for size here first, so
   * an obvious mistake costs no round trip; the server checks again.
   */
  async upload(file: File, onProgress?: (percent: number) => void): Promise<Uploaded> {
    if (file.size > MAX_UPLOAD_BYTES) {
      return { ok: false, message: UPLOAD_ERRORS["file_too_large"]! };
    }
    const result = await this.api.uploadMedia(file, onProgress);
    if (!result.ok) return { ok: false, message: UPLOAD_ERRORS[result.error] ?? result.error };
    await this.load(true);
    return { ok: true, asset: result.data.media, deduped: result.data.deduped ?? false };
  }

  /**
   * The smallest WebP copy when there is one — a grid of originals is tens of
   * MB. Absolute: the admin loads media from the API host.
   */
  thumbnailOf(asset: MediaAsset): string {
    const small = asset.variants.find((v) => v.format === "webp");
    if (!small) return asset.url;
    const file = small.path.slice(small.path.lastIndexOf("/") + 1);
    return asset.url.slice(0, asset.url.lastIndexOf("/") + 1) + file;
  }

  /** A preview for a stored `/media/<file>` path: its thumbnail once the library has loaded. */
  thumbnail(path: string | null): string {
    if (!path) return "";
    const asset = this.byPath().get(path);
    if (asset) return this.thumbnailOf(asset);
    return path.startsWith("/media/") ? this.api.baseUrl + path : path;
  }
}
