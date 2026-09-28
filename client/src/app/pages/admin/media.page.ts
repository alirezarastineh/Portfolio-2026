import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  OnInit,
  signal,
} from "@angular/core";
import { FormsModule } from "@angular/forms";
import { RouterLink } from "@angular/router";
import { NgIcon, provideIcons } from "@ng-icons/core";
import {
  lucideCopy,
  lucideExternalLink,
  lucideFileText,
  lucideImage,
  lucideSparkles,
  lucideTrash2,
  lucideUpload,
} from "@ng-icons/lucide";
import { toast } from "@spartan-ng/brain/sonner";
import { HlmAlert, HlmAlertDescription, HlmAlertTitle } from "@spartan-ng/helm/alert";
import { HlmButton } from "@spartan-ng/helm/button";
import { HlmEmptyImports } from "@spartan-ng/helm/empty";
import { HlmInput } from "@spartan-ng/helm/input";
import { HlmProgressImports } from "@spartan-ng/helm/progress";
import { HlmSheetImports } from "@spartan-ng/helm/sheet";
import { HlmSpinner } from "@spartan-ng/helm/spinner";
import { HlmToggleGroupImports } from "@spartan-ng/helm/toggle-group";

import {
  AdminApiService,
  type MediaAsset,
  type MediaReconcile,
} from "../../admin/admin-api.service";
import { ConfirmService } from "../../admin/components/confirm-dialog.component";
import { MediaTileComponent } from "../../admin/components/media-tile.component";
import { AdminPageHeaderComponent } from "../../admin/components/page-header.component";
import {
  formatBytes,
  isUnused,
  MediaLibraryService,
  UPLOAD_ACCEPT,
} from "../../admin/media-library.service";
import { deleteBlocker, missingAlt, usagePlace } from "../../admin/media-usage";
import { absoluteTime } from "../../admin/relative-time";
import type { Locale } from "../../content/schema";

type Filter = "all" | "images" | "documents" | "unused" | "alt";

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "images", label: "Images" },
  { id: "documents", label: "PDFs" },
  { id: "unused", label: "Unused" },
  { id: "alt", label: "Missing alt" },
];

const MATCHES: Record<Filter, (asset: MediaAsset) => boolean> = {
  all: () => true,
  images: (a) => a.kind === "image",
  documents: (a) => a.kind === "document",
  unused: isUnused,
  alt: (a) => missingAlt(a).length > 0,
};

/**
 * The media library: every upload at its own shape, what needs a look (no alt
 * text, nothing uses it), and each file's details in a side sheet: a large
 * preview, where it is used (with the way there), its alt text in both
 * languages with an AI suggestion drawn from the picture, and delete.
 *
 * Files dropped anywhere on the page upload, several at a time. Files nothing
 * uses can be selected and deleted together.
 */
@Component({
  selector: "app-admin-media",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    AdminPageHeaderComponent,
    FormsModule,
    HlmAlert,
    HlmAlertDescription,
    HlmAlertTitle,
    HlmButton,
    HlmEmptyImports,
    HlmInput,
    HlmProgressImports,
    HlmSheetImports,
    HlmSpinner,
    HlmToggleGroupImports,
    MediaTileComponent,
    NgIcon,
    RouterLink,
  ],
  viewProviders: [
    provideIcons({
      lucideCopy,
      lucideExternalLink,
      lucideFileText,
      lucideImage,
      lucideSparkles,
      lucideTrash2,
      lucideUpload,
    }),
  ],
  host: {
    class: "block",
    "(document:dragenter)": "onDragEnter($event)",
    "(document:dragover)": "onDragOver($event)",
    "(document:dragleave)": "onDragLeave($event)",
    "(document:drop)": "onDrop($event)",
  },
  template: `
    <div class="mx-auto flex max-w-6xl flex-col gap-6 pb-12">
      <app-page-header
        title="Media"
        description="Images for projects, posts and your photo, and PDFs such as your CV. Uploaded photos are straightened, stripped of location data and resized automatically. Drop files anywhere on this page to upload them."
      >
        <button
          headerActions
          hlmBtn
          size="sm"
          type="button"
          [disabled]="uploading() !== null"
          (click)="fileInput.click()"
        >
          <ng-icon name="lucideUpload" size="14" aria-hidden="true" />
          <span class="ml-1.5">Upload</span>
        </button>
      </app-page-header>
      <input
        #fileInput
        type="file"
        multiple
        class="hidden"
        [accept]="accept"
        aria-label="Upload images or PDFs"
        (change)="onFileInput($event)"
      />

      @if (reconcile(); as r) {
        @if (r.missingFiles.length || r.orphanFiles.length) {
          <div hlmAlert variant="destructive">
            <h2 hlmAlertTitle>Media and database are out of step</h2>
            <div hlmAlertDescription>
              @if (r.missingFiles.length) {
                <p class="m-0">
                  {{ r.missingFiles.length }} record(s) point at a file that is not on disk —
                  usually a database restore without a matching media restore.
                </p>
              }
              @if (r.orphanFiles.length) {
                <p class="m-0">{{ r.orphanFiles.length }} file(s) on disk have no record.</p>
              }
            </div>
          </div>
        }
        <p class="m-0 -mt-3 font-mono text-meta text-muted-foreground">
          {{ r.totalAssets }} file(s) · {{ size(r.totalBytes) }} in originals
        </p>
      }

      @if (uploading(); as u) {
        <div class="flex flex-col gap-2 rounded-lg border border-border p-3" role="status">
          <p class="m-0 font-mono text-xs text-muted-foreground">
            uploading {{ u.name }} ({{ u.index }} of {{ u.total }})… {{ u.percent }}%
          </p>
          <hlm-progress [value]="u.percent" aria-label="Upload progress">
            <hlm-progress-indicator />
          </hlm-progress>
        </div>
      }

      <div class="flex flex-wrap items-center justify-between gap-3">
        <div
          hlmToggleGroup
          type="single"
          variant="outline"
          size="sm"
          aria-label="Show"
          [nullable]="false"
          [value]="filter()"
          (valueChange)="onFilter($event)"
        >
          @for (option of filters; track option.id) {
            <button hlmToggleGroupItem type="button" [value]="option.id">
              {{ option.label }}
              <span class="ml-1 font-mono text-xs text-muted-foreground">{{
                counts()[option.id]
              }}</span>
            </button>
          }
        </div>
        <div class="flex flex-wrap items-center gap-2">
          @if (selected().size) {
            <span class="font-mono text-xs text-muted-foreground" role="status">
              {{ selected().size }} selected · {{ size(selectedBytes()) }}
            </span>
            <button hlmBtn variant="ghost" size="sm" type="button" (click)="clearSelection()">
              Clear
            </button>
            <button
              hlmBtn
              variant="destructive"
              size="sm"
              type="button"
              [disabled]="deleting()"
              (click)="deleteSelected()"
            >
              @if (deleting()) {
                <hlm-spinner class="size-4" />
              } @else {
                <ng-icon name="lucideTrash2" size="14" aria-hidden="true" />
                <span class="ml-1.5">Delete {{ selected().size }}</span>
              }
            </button>
          } @else {
            <button
              hlmBtn
              variant="outline"
              size="sm"
              type="button"
              [disabled]="!unused().length"
              (click)="selectUnused()"
            >
              Select unused ({{ unused().length }})
            </button>
          }
        </div>
      </div>

      @if (!library.loaded()) {
        <hlm-spinner class="size-5 self-center" />
      } @else if (!visible().length) {
        <div hlmEmpty class="border border-dashed border-border">
          <div hlmEmptyHeader>
            <div hlmEmptyMedia variant="icon">
              <ng-icon name="lucideImage" size="20" aria-hidden="true" />
            </div>
            <h2 hlmEmptyTitle>{{ empty().title }}</h2>
            <p hlmEmptyDescription>{{ empty().text }}</p>
          </div>
        </div>
      } @else {
        <ul
          class="m-0 grid list-none grid-cols-2 gap-3 p-0 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5"
          role="list"
        >
          @for (asset of visible(); track asset.id) {
            @let picked = selected().has(asset.id);
            <li class="relative">
              <button
                type="button"
                class="block w-full overflow-hidden rounded-lg border text-left transition-colors hover:border-border-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                [class]="picked ? 'border-destructive' : 'border-border'"
                [attr.aria-label]="'Details of ' + asset.originalName"
                (click)="open(asset)"
              >
                <app-media-tile [asset]="asset" [showUsage]="true" />
              </button>
              @if (isUnused(asset)) {
                <label
                  class="absolute left-1.5 top-1.5 flex size-7 cursor-pointer items-center justify-center rounded-md bg-card/90 backdrop-blur"
                >
                  <input
                    type="checkbox"
                    class="size-4 accent-destructive"
                    [checked]="picked"
                    [attr.aria-label]="'Select ' + asset.originalName"
                    (change)="toggle(asset)"
                  />
                </label>
              }
            </li>
          }
        </ul>
      }
    </div>

    <!-- Files dragged over the page: anywhere drops them in. -->
    @if (dragging()) {
      <div
        class="pointer-events-none fixed inset-4 z-50 flex items-center justify-center rounded-2xl border-2 border-dashed border-accent-indigo bg-background/85 backdrop-blur-sm"
        aria-hidden="true"
      >
        <p class="m-0 flex items-center gap-2 text-h4 text-foreground">
          <ng-icon name="lucideUpload" size="20" />
          Drop to upload
        </p>
      </div>
    }

    <hlm-sheet side="right" [state]="active() ? 'open' : 'closed'" (stateChanged)="onSheet($event)">
      <hlm-sheet-content *hlmSheetPortal="let ctx" class="w-full overflow-y-auto sm:max-w-xl">
        @if (active(); as asset) {
          <hlm-sheet-header>
            <h2 hlmSheetTitle class="wrap-anywhere">{{ asset.originalName }}</h2>
            <p hlmSheetDescription>
              {{ asset.kind === "document" ? "PDF" : "Image" }} · {{ size(asset.byteSize) }} ·
              uploaded {{ when(asset.createdAt) }}
            </p>
          </hlm-sheet-header>

          <div class="flex flex-col gap-6 px-4 pb-6">
            <div
              class="flex max-h-[50svh] min-h-40 items-center justify-center overflow-hidden rounded-lg border border-border bg-muted p-2"
            >
              @if (asset.kind === "document") {
                <ng-icon
                  name="lucideFileText"
                  size="40"
                  class="text-muted-foreground"
                  aria-hidden="true"
                />
              } @else {
                <img
                  [src]="asset.url"
                  alt=""
                  class="max-h-[calc(50svh-1rem)] max-w-full object-contain"
                  [attr.width]="asset.width"
                  [attr.height]="asset.height"
                />
              }
            </div>

            <dl class="m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
              @if (asset.width && asset.height) {
                <dt class="eyebrow text-muted-foreground">Size</dt>
                <dd class="m-0 font-mono text-xs">
                  {{ asset.width }}×{{ asset.height }} · {{ asset.variants.length }} resized
                  {{ asset.variants.length === 1 ? "copy" : "copies" }}
                </dd>
              }
              <dt class="eyebrow text-muted-foreground">Type</dt>
              <dd class="m-0 font-mono text-xs">{{ asset.mime }}</dd>
              <dt class="eyebrow text-muted-foreground">Path</dt>
              <dd class="m-0 flex min-w-0 items-center gap-1">
                <code class="min-w-0 truncate font-mono text-xs">{{ asset.path }}</code>
                <button
                  hlmBtn
                  variant="ghost"
                  size="icon-xs"
                  type="button"
                  aria-label="Copy the path"
                  (click)="copyPath(asset)"
                >
                  <ng-icon name="lucideCopy" size="12" aria-hidden="true" />
                </button>
              </dd>
            </dl>

            <section class="flex flex-col gap-2" aria-labelledby="usage-title">
              <h3 id="usage-title" class="m-0 text-sm font-medium">Used by</h3>
              @if (places().length) {
                <ul class="m-0 flex list-none flex-col gap-1 p-0 text-sm" role="list">
                  @for (place of places(); track place.label) {
                    <li>
                      @if (place.link) {
                        <a
                          class="underline underline-offset-4 hover:text-foreground"
                          [routerLink]="place.link"
                          (click)="close()"
                          >{{ place.label }}</a
                        >
                      } @else {
                        {{ place.label }}
                      }
                    </li>
                  }
                </ul>
              } @else {
                <p class="m-0 text-sm text-muted-foreground">Nothing uses it: safe to delete.</p>
              }
              @if (asset.usage && asset.usage.recent && !asset.usage.live) {
                <p class="m-0 text-xs text-muted-foreground">
                  One of the last 20 publications shows it: a rollback to that one needs it.
                </p>
              }
            </section>

            @if (asset.kind === "image") {
              <section class="flex flex-col gap-3" aria-labelledby="alt-title">
                <div>
                  <h3 id="alt-title" class="m-0 text-sm font-medium">Alt text</h3>
                  <p class="m-0 mt-1 text-xs text-muted-foreground">
                    What the picture shows, for screen readers and for when it does not load.
                    Suggestions are drawn from the picture; nothing is saved until you save.
                  </p>
                </div>
                @for (locale of locales; track locale) {
                  <div class="flex flex-col gap-1">
                    <div class="flex items-center justify-between gap-2">
                      <label [for]="'alt-' + locale" class="eyebrow text-muted-foreground">{{
                        locale
                      }}</label>
                      <button
                        hlmBtn
                        variant="ghost"
                        size="sm"
                        type="button"
                        class="h-6 px-2 font-mono text-xs text-muted-foreground"
                        [disabled]="suggesting() !== null"
                        [attr.aria-label]="
                          'Suggest alt text in ' +
                          (locale === 'en' ? 'English' : 'German') +
                          ' with AI'
                        "
                        (click)="suggest(asset, locale)"
                      >
                        <ng-icon name="lucideSparkles" size="12" aria-hidden="true" />
                        <span class="ml-1">{{ suggesting() === locale ? "…" : "suggest" }}</span>
                      </button>
                    </div>
                    <input
                      hlmInput
                      maxlength="300"
                      [id]="'alt-' + locale"
                      [ngModel]="alt()[locale]"
                      (ngModelChange)="setAlt(locale, $event)"
                    />
                  </div>
                }
                <div class="flex justify-end">
                  <button
                    hlmBtn
                    size="sm"
                    type="button"
                    [disabled]="!altChanged() || savingAlt()"
                    (click)="saveAlt(asset)"
                  >
                    Save alt text
                  </button>
                </div>
              </section>
            }

            <div class="flex flex-wrap items-center gap-2 border-t border-border pt-4">
              <a
                hlmBtn
                variant="outline"
                size="sm"
                [href]="asset.url"
                target="_blank"
                rel="noopener"
              >
                <ng-icon name="lucideExternalLink" size="14" aria-hidden="true" />
                <span class="ml-1.5">Open the original</span>
                <span class="sr-only">(opens in a new tab)</span>
              </a>
              <button
                hlmBtn
                variant="ghost"
                size="sm"
                type="button"
                class="ml-auto text-destructive"
                [disabled]="!!blocker()"
                [attr.aria-describedby]="blocker() ? 'delete-blocker' : null"
                (click)="remove(asset)"
              >
                <ng-icon name="lucideTrash2" size="14" aria-hidden="true" />
                <span class="ml-1.5">Delete</span>
              </button>
              @if (blocker(); as reason) {
                <p id="delete-blocker" class="m-0 w-full text-right text-xs text-muted-foreground">
                  {{ reason }}
                </p>
              }
            </div>
          </div>
        }
      </hlm-sheet-content>
    </hlm-sheet>
  `,
})
export default class AdminMediaPage implements OnInit {
  private readonly api = inject(AdminApiService);
  private readonly confirm = inject(ConfirmService);
  protected readonly library = inject(MediaLibraryService);

  protected readonly filters = FILTERS;
  protected readonly locales: Locale[] = ["en", "de"];
  protected readonly accept = UPLOAD_ACCEPT;
  protected readonly isUnused = isUnused;

  protected readonly filter = signal<Filter>("all");
  protected readonly reconcile = signal<MediaReconcile | null>(null);
  protected readonly selected = signal<ReadonlySet<string>>(new Set());
  protected readonly deleting = signal(false);
  protected readonly dragging = signal(false);
  protected readonly uploading = signal<{
    name: string;
    index: number;
    total: number;
    percent: number;
  } | null>(null);

  /** The file whose details are open, by id: it follows the library as it reloads. */
  private readonly activeId = signal<string | null>(null);
  protected readonly active = computed(
    () => this.library.assets().find((a) => a.id === this.activeId()) ?? null,
  );
  protected readonly alt = signal<Record<Locale, string>>({ en: "", de: "" });
  protected readonly suggesting = signal<Locale | null>(null);
  protected readonly savingAlt = signal(false);

  protected readonly counts = computed(() => {
    const assets = this.library.assets();
    return Object.fromEntries(
      FILTERS.map((f) => [f.id, assets.filter(MATCHES[f.id]).length]),
    ) as Record<Filter, number>;
  });
  protected readonly visible = computed(() => this.library.assets().filter(MATCHES[this.filter()]));
  protected readonly unused = computed(() => this.library.assets().filter(isUnused));
  protected readonly selectedBytes = computed(() =>
    this.library
      .assets()
      .filter((a) => this.selected().has(a.id))
      .reduce((sum, a) => sum + a.byteSize, 0),
  );

  protected readonly empty = computed(() => {
    switch (this.filter()) {
      case "unused":
        return {
          title: "Nothing unused",
          text: "Every file is used by the draft or the live site.",
        };
      case "alt":
        return { title: "Every image is described", text: "Each has alt text in both languages." };
      case "documents":
        return { title: "No PDFs yet", text: "Upload your CV as a PDF, then set it under Hero." };
      default:
        return { title: "Nothing uploaded yet", text: "Upload a file, or drop some on this page." };
    }
  });

  protected readonly places = computed(() =>
    (this.active()?.usage?.draft ?? [])
      .map(usagePlace)
      .concat(this.active()?.usage?.live ? [{ label: "The live site", link: null }] : []),
  );
  protected readonly blocker = computed(() => {
    const asset = this.active();
    return asset ? deleteBlocker(asset) : null;
  });
  protected readonly altChanged = computed(() => {
    const asset = this.active();
    if (!asset) return false;
    const now = this.alt();
    return now.en !== (asset.altEn ?? "") || now.de !== (asset.altDe ?? "");
  });

  ngOnInit(): void {
    void this.library.load(true);
    void this.loadReconcile();
  }

  protected size(bytes: number): string {
    return formatBytes(bytes);
  }

  protected when(iso: string): string {
    return absoluteTime(iso);
  }

  protected onFilter(value: unknown): void {
    const filter = FILTERS.find((f) => f.id === value)?.id;
    if (filter) this.filter.set(filter);
  }

  protected async loadReconcile(): Promise<void> {
    const result = await this.api.mediaReconcile();
    if (result.ok) this.reconcile.set(result.data);
  }

  /* ---- details ---- */

  protected open(asset: MediaAsset): void {
    this.activeId.set(asset.id);
    this.alt.set({ en: asset.altEn ?? "", de: asset.altDe ?? "" });
  }

  protected onSheet(state: string): void {
    if (state === "closed") this.activeId.set(null);
  }

  protected close(): void {
    this.activeId.set(null);
  }

  protected setAlt(locale: Locale, text: string): void {
    this.alt.update((alt) => ({ ...alt, [locale]: text }));
  }

  protected async suggest(asset: MediaAsset, locale: Locale): Promise<void> {
    this.suggesting.set(locale);
    const result = await this.api.copilot({ task: "alt", mediaId: asset.id, locale });
    this.suggesting.set(null);
    if (!result.ok) {
      toast.error("No suggestion", { description: result.error });
      return;
    }
    this.setAlt(locale, result.data.text);
  }

  protected async saveAlt(asset: MediaAsset): Promise<void> {
    const alt = this.alt();
    this.savingAlt.set(true);
    const result = await this.api.updateMediaAlt(asset.id, {
      altEn: alt.en.trim() || null,
      altDe: alt.de.trim() || null,
    });
    this.savingAlt.set(false);
    if (!result.ok) {
      toast.error("Not saved", { description: result.error });
      return;
    }
    toast.success("Alt text saved", { description: "Live after the next publish." });
    await this.library.load(true);
    this.alt.set({ en: alt.en.trim(), de: alt.de.trim() });
  }

  protected async copyPath(asset: MediaAsset): Promise<void> {
    try {
      await navigator.clipboard.writeText(asset.path);
      toast.success("Path copied");
    } catch {
      toast.error("Could not copy", { description: asset.path });
    }
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
    // Only older publications use it: allowed, but a rollback to one would then be refused.
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
      toast.error("Not deleted", { description: result.error });
      return;
    }
    this.activeId.set(null);
    await this.afterChange();
    toast.success("Deleted");
  }

  /* ---- selection ---- */

  protected toggle(asset: MediaAsset): void {
    this.selected.update((set) => {
      const next = new Set(set);
      if (next.has(asset.id)) next.delete(asset.id);
      else next.add(asset.id);
      return next;
    });
  }

  protected selectUnused(): void {
    this.selected.set(new Set(this.unused().map((a) => a.id)));
  }

  protected clearSelection(): void {
    this.selected.set(new Set());
  }

  /**
   * Deletes the selected files. Those that only recent publications show are
   * asked about separately: deleting them makes a rollback to those refuse.
   */
  protected async deleteSelected(): Promise<void> {
    const chosen = this.library.assets().filter((a) => this.selected().has(a.id));
    const safe = chosen.filter((a) => !a.usage?.recent);
    const inHistory = chosen.filter((a) => a.usage?.recent);
    const ids: string[] = [];

    if (safe.length) {
      const go = await this.confirm.ask({
        title: `Delete ${safe.length} ${safe.length === 1 ? "file" : "files"}?`,
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
    if (inHistory.length) {
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
    if (!ids.length) return;

    this.deleting.set(true);
    const result = await this.api.cleanupMedia(ids, includeHistory);
    this.deleting.set(false);
    if (!result.ok) {
      toast.error("Not deleted", { description: result.error });
      return;
    }
    this.selected.set(new Set());
    await this.afterChange();
    const { deleted, skipped, freedBytes } = result.data;
    toast.success(`Deleted ${deleted.length} ${deleted.length === 1 ? "file" : "files"}`, {
      description:
        `${formatBytes(freedBytes)} freed.` +
        (skipped.length ? ` ${skipped.length} became used meanwhile and were kept.` : ""),
    });
  }

  /* ---- uploads ---- */

  protected onFileInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    void this.uploadAll(Array.from(input.files ?? []));
    // Reset so choosing the same files again fires change again.
    input.value = "";
  }

  private hasFiles(event: DragEvent): boolean {
    return Array.from(event.dataTransfer?.types ?? []).includes("Files");
  }

  protected onDragEnter(event: DragEvent): void {
    if (this.hasFiles(event) && !this.active()) this.dragging.set(true);
  }

  protected onDragOver(event: DragEvent): void {
    // Without this the browser opens a dropped file instead of handing it over.
    if (this.hasFiles(event) && !this.active()) event.preventDefault();
  }

  protected onDragLeave(event: DragEvent): void {
    // Leaving the window, not moving from one element to the next.
    if (!event.relatedTarget) this.dragging.set(false);
  }

  protected onDrop(event: DragEvent): void {
    if (!this.hasFiles(event) || this.active()) return;
    event.preventDefault();
    this.dragging.set(false);
    void this.uploadAll(Array.from(event.dataTransfer?.files ?? []));
  }

  /** One after the other, so the progress reads as one file's, and a failure names its file. */
  private async uploadAll(files: File[]): Promise<void> {
    if (!files.length || this.uploading()) return;
    let done = 0;
    for (const [i, file] of files.entries()) {
      this.uploading.set({ name: file.name, index: i + 1, total: files.length, percent: 0 });
      const result = await this.library.upload(file, (percent) =>
        this.uploading.update((u) => (u ? { ...u, percent } : u)),
      );
      if (result.ok) done++;
      else toast.error(`${file.name} was not uploaded`, { description: result.message });
    }
    this.uploading.set(null);
    await this.loadReconcile();
    if (done) toast.success(done === 1 ? "Uploaded" : `Uploaded ${done} files`);
  }

  private async afterChange(): Promise<void> {
    await this.library.load(true);
    await this.loadReconcile();
  }
}
