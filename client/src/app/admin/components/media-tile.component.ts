import { ChangeDetectionStrategy, Component, computed, inject, input } from "@angular/core";
import { NgIcon, provideIcons } from "@ng-icons/core";
import { lucideFileText } from "@ng-icons/lucide";

import type { MediaAsset } from "../admin-api.service";
import { formatBytes, MediaLibraryService } from "../media-library.service";
import { missingAltLabel, usageState } from "../media-usage";

const USAGE: Record<string, { label: string; tone: string }> = {
  live: { label: "live", tone: "text-available" },
  draft: { label: "in draft", tone: "text-foreground" },
  unused: { label: "unused", tone: "text-muted-foreground" },
};

/**
 * One file as the library and the pickers show it: the whole picture at its
 * own shape (letterboxed, never cropped), its name and size, and what needs a
 * look: no alt text in a language, and where it is used (in the library).
 * The parent makes it a button.
 */
@Component({
  selector: "app-media-tile",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgIcon],
  viewProviders: [provideIcons({ lucideFileText })],
  host: { class: "flex min-w-0 flex-col" },
  template: `
    <span class="flex aspect-4/3 items-center justify-center overflow-hidden bg-muted p-1.5">
      @if (asset().kind === "document") {
        <span class="flex flex-col items-center gap-1">
          <ng-icon
            name="lucideFileText"
            size="28"
            class="text-muted-foreground"
            aria-hidden="true"
          />
          <span class="font-mono text-xs text-muted-foreground">PDF</span>
        </span>
      } @else {
        <img
          [src]="library.thumbnailOf(asset())"
          alt=""
          loading="lazy"
          decoding="async"
          class="block max-h-full max-w-full rounded-sm object-contain"
          [attr.width]="asset().width"
          [attr.height]="asset().height"
        />
      }
    </span>
    <span class="flex min-w-0 flex-col gap-1 px-2 py-1.5">
      <span class="truncate font-mono text-xs text-foreground">{{ asset().originalName }}</span>
      <span
        class="flex flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-xs text-muted-foreground"
      >
        <span>{{ facts() }}</span>
        @if (usage(); as u) {
          <span [class]="u.tone">{{ u.label }}</span>
        }
        @if (noAlt(); as label) {
          <span class="text-accent-orange">{{ label }}</span>
        }
      </span>
    </span>
  `,
})
export class MediaTileComponent {
  readonly asset = input.required<MediaAsset>();
  /** Where it is used: the library says, a picker need not. */
  readonly showUsage = input(false);

  protected readonly library = inject(MediaLibraryService);

  protected readonly facts = computed(() => {
    const a = this.asset();
    let shape = a.kind === "document" ? "PDF" : "—";
    if (a.width && a.height) shape = `${a.width}×${a.height}`;
    return `${shape} · ${formatBytes(a.byteSize)}`;
  });

  protected readonly usage = computed(() =>
    this.showUsage() ? (USAGE[usageState(this.asset())] ?? null) : null,
  );

  protected readonly noAlt = computed(() => missingAltLabel(this.asset()));
}
