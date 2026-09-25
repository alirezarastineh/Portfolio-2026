import { computed, inject, Injectable, signal } from "@angular/core";

import { AdminApiService, type MediaAsset } from "./admin-api.service";

/** Not used by the draft, not shown live — safe to delete, bar rollbacks. */
export function isUnused(asset: MediaAsset): boolean {
  return !!asset.usage && asset.usage.draft.length === 0 && !asset.usage.live;
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
