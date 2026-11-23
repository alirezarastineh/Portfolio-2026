import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  OnInit,
  signal,
  untracked,
} from "@angular/core";
import { takeUntilDestroyed } from "@angular/core/rxjs-interop";
import { FormControl } from "@angular/forms";
import { ActivatedRoute, Router, RouterLink, type Params } from "@angular/router";
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
import { HlmProgressImports } from "@spartan-ng/helm/progress";
import { HlmSheetImports } from "@spartan-ng/helm/sheet";
import { HlmSpinner } from "@spartan-ng/helm/spinner";
import { HlmToggleGroupImports } from "@spartan-ng/helm/toggle-group";

import {
  AdminApiService,
  type MediaAsset,
  type MediaReconcile,
} from "../../admin/admin-api.service";
import { apiWords } from "../../admin/api-words";
import type { RouteMeta } from "@analogjs/router";

import { ChangedElsewhere } from "../../admin/changed-elsewhere";
import { BilingualFieldComponent } from "../../admin/components/bilingual-field.component";
import { ConfirmService } from "../../admin/components/confirm-dialog.component";
import { isSaveShortcut } from "../../admin/components/editor-chrome.component";
import { MediaTileComponent } from "../../admin/components/media-tile.component";
import { DraftOfferComponent } from "../../admin/components/draft-offer.component";
import { CopilotLedger } from "../../admin/copilot-ledger";
import { draftOffer, type CopilotDraft, type DraftOffer } from "../../admin/copilot-skills";
import { AdminPageHeaderComponent } from "../../admin/components/page-header.component";
import {
  formatBytes,
  isUnused,
  MediaLibraryService,
  UPLOAD_ACCEPT,
} from "../../admin/media-library.service";
import type { TraceState } from "../../admin/change-trace";
import { altInDraft, deleteBlocker, usagePlace, missingAlt } from "../../admin/media-usage";
import { AdminPulseService } from "../../admin/pulse.service";
import { absoluteTime } from "../../admin/relative-time";
import { toastNotSaved } from "../../admin/save-feedback";
import { LoadErrorComponent } from "../../admin/components/load-state.component";
import { RecoveryBannerComponent } from "../../admin/components/recovery-banner.component";
import { RecoveryService, typedAt, type RecoveryHandle } from "../../admin/recovery.service";
import { UnsavedChangesService, unsavedChangesGuard } from "../../admin/unsaved-changes.service";
import type { Locale } from "../../content/schema";

export const routeMeta: RouteMeta = { canDeactivate: [unsavedChangesGuard] };

type Filter = "all" | "images" | "documents" | "unused" | "alt";
type Text = "alt" | "description";

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

const LOCALES: readonly Locale[] = ["en", "de"];

function filterFrom(value: string | null): Filter {
  return FILTERS.find((f) => f.id === value)?.id ?? "all";
}

/** The server keeps no version for a file: its four texts stand in for one (`ChangedElsewhere`). */
function textsOf(asset: MediaAsset): { id: string; updatedAt: string } {
  const texts = [asset.altEn, asset.altDe, asset.descriptionEn, asset.descriptionDe];
  return { id: asset.id, updatedAt: JSON.stringify(texts.map((t) => t ?? "")) };
}

/**
 * The media library: every upload as a tile, what needs a look (no alt text, nothing uses it),
 * and each file's panel: its alt text and the assistant's description in both languages, where
 * it is used, and delete. The filter and the open file live in the address (`?filter=`,
 * `?file=<id>`), replaced in place as the Inbox's, so Back leaves the page.
 *
 * Files dropped anywhere on the page upload, several at a time. Files nothing uses can be selected
 * and deleted together.
 */
@Component({
  selector: "app-admin-media",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    AdminPageHeaderComponent,
    BilingualFieldComponent,
    DraftOfferComponent,
    HlmAlert,
    HlmAlertDescription,
    HlmAlertTitle,
    HlmButton,
    HlmEmptyImports,
    HlmProgressImports,
    HlmSheetImports,
    HlmSpinner,
    HlmToggleGroupImports,
    LoadErrorComponent,
    MediaTileComponent,
    NgIcon,
    RecoveryBannerComponent,
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
        description="Images and PDFs for the site. Photos are straightened, stripped of location data and resized as they upload. Drop files anywhere on this page to upload them."
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
                  {{ r.missingFiles.length }}
                  {{ r.missingFiles.length === 1 ? "record" : "records" }} without a file: usually a
                  database restored without its media.
                </p>
              }
              @if (r.orphanFiles.length) {
                <p class="m-0">{{ files(r.orphanFiles.length) }} without a record.</p>
              }
            </div>
          </div>
        }
        <p class="m-0 -mt-3 text-hint text-muted-foreground">
          {{ files(r.totalAssets) }}, {{ size(r.totalBytes) }} of originals
        </p>
      }

      <!-- Said once when files start up; the file, the count and the percent show, never spoken. -->
      <p class="sr-only" role="status">{{ uploadSaid() }}</p>
      @if (uploading(); as u) {
        <div class="flex flex-col gap-2 rounded-lg border border-border p-3">
          <p class="m-0 text-hint text-muted-foreground" aria-hidden="true">
            Uploading <span class="wrap-anywhere">{{ u.name }}</span>,
            <span class="font-data">{{ u.index }}</span> of
            <span class="font-data">{{ u.total }}</span>:
            <span class="font-data">{{ u.percent }}%</span>
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
              <span class="ml-1 font-data text-xs">{{ counts()[option.id] }}</span>
            </button>
          }
        </div>
        <div class="flex flex-wrap items-center gap-2">
          @if (selected().size) {
            <span class="text-hint text-muted-foreground" role="status">
              {{ selected().size }} selected, {{ size(selectedBytes()) }}
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
      } @else if (library.error() && !library.assets().length) {
        <app-load-error
          title="Could not load the media library"
          description="Nothing was lost: the files are still on the server."
          [reason]="library.error() ?? ''"
          (retry)="retry()"
        />
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
                class="block w-full overflow-hidden rounded-lg border text-left transition-colors hover:border-border-strong"
                [class]="picked ? 'border-destructive' : 'border-border'"
                [attr.data-file]="asset.id"
                (click)="choose(asset)"
              >
                <!-- Named by its content, the tile's text included (axe's label-in-name). -->
                <span class="sr-only">Details of </span>
                <app-media-tile [asset]="asset" [showUsage]="true" />
              </button>
              @if (isUnused(asset)) {
                <label
                  class="absolute left-1.5 top-1.5 flex size-7 cursor-pointer items-center justify-center rounded-md bg-card/90 backdrop-blur-sm"
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
        class="pointer-events-none fixed inset-4 z-50 flex items-center justify-center rounded-overlay border-2 border-dashed border-foreground bg-background/85 backdrop-blur-sm"
        aria-hidden="true"
      >
        <p class="m-0 flex items-center gap-2 text-section-title text-foreground">
          <ng-icon name="lucideUpload" size="20" />
          Drop to upload
        </p>
      </div>
    }

    <!-- With a mouse the panel opens on the alt text; on touch, no keyboard jumps up over it. -->
    <hlm-sheet
      side="right"
      [autoFocus]="active()?.kind === 'image' && !coarse ? '#alt-en' : 'first-tabbable'"
      [state]="active() ? 'open' : 'closed'"
      (stateChanged)="onSheet($event)"
    >
      <hlm-sheet-content
        *hlmSheetPortal="let ctx"
        class="w-full gap-0 sm:max-w-xl lg:max-w-2xl"
        (keydown)="onPanelKey($event)"
      >
        @if (active(); as asset) {
          <!-- The head stays while the rest scrolls: the name, the state in words, and Save. -->
          <div class="flex shrink-0 flex-col gap-1 border-b border-border py-4 pl-4 pr-14">
            <h2 hlmSheetTitle class="m-0 wrap-anywhere text-section-title" translate="no">
              {{ asset.originalName }}
            </h2>
            <p hlmSheetDescription class="m-0 text-hint text-muted-foreground">
              {{ asset.kind === "document" ? "PDF" : "Image" }}, {{ size(asset.byteSize) }},
              uploaded {{ when(asset.createdAt) }}
            </p>
            @if (asset.kind === "image") {
              <div class="mt-2 flex min-h-8 items-center justify-between gap-3">
                <p
                  id="media-state"
                  role="status"
                  class="m-0 text-hint"
                  [class]="changed().length ? 'text-accent-orange' : 'text-muted-foreground'"
                  [textContent]="stateText()"
                ></p>
                <button
                  hlmBtn
                  size="sm"
                  type="button"
                  [disabled]="!changed().length || saving()"
                  (click)="save()"
                >
                  Save
                </button>
              </div>
            }
          </div>

          <div
            class="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto overscroll-contain px-4 pt-4 pb-6"
          >
            <!-- The page's own banner sits under this sheet, out of reach. -->
            <app-recovery-banner />
            <div
              class="flex max-h-[40svh] min-h-32 items-center justify-center overflow-hidden rounded-lg border border-border bg-muted p-2"
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
                  class="max-h-[calc(40svh-1rem)] max-w-full object-contain"
                  [attr.width]="asset.width"
                  [attr.height]="asset.height"
                />
              }
            </div>

            @if (asset.kind === "image") {
              <app-bilingual-field
                [id]="'alt'"
                label="Alt text"
                hint="What the picture shows, for screen readers and when it does not load. Goes live with the next publish."
                [maxLength]="300"
                [ai]="false"
                [state]="altTrace()"
                [controlEn]="control.alt.en"
                [controlDe]="control.alt.de"
                [below]="suggestAlt"
              />
              <ng-template #suggestAlt let-locale>
                <div class="flex flex-col items-end gap-1">
                  <button
                    hlmBtn
                    variant="ghost"
                    size="sm"
                    type="button"
                    class="h-6 px-2 text-xs text-muted-foreground"
                    [disabled]="suggesting() !== null"
                    (click)="suggest(asset, locale)"
                  >
                    <!-- Named by its words: "suggest alt text in English with AI (paid)". -->
                    <ng-icon name="lucideSparkles" size="12" aria-hidden="true" />
                    <span class="ml-1">{{ suggesting() === locale ? "…" : "suggest" }}</span><span
                      class="sr-only"
                    >
                      alt text in {{ locale === "en" ? "English" : "German" }} with AI</span
                    >
                    (paid)
                  </button>
                  <app-draft-offer
                    class="self-stretch"
                    [offer]="offerFor('alt', asset.id, locale)"
                    [field]="'Alt text ' + locale.toUpperCase()"
                    [fieldId]="'alt-' + locale"
                  />
                </div>
              </ng-template>

              <app-bilingual-field
                [id]="'description'"
                label="Description for the assistant"
                hint="What a diagram or screenshot shows: its parts and how they connect. Only the assistant reads it, from the next question on; no page shows it."
                [multiline]="true"
                [rows]="4"
                [maxLength]="2000"
                [ai]="false"
                [state]="descriptionChanged() ? 'unsaved' : 'live'"
                [controlEn]="control.description.en"
                [controlDe]="control.description.de"
                [below]="describeBelow"
              />
              <ng-template #describeBelow let-locale>
                <div class="flex flex-col items-end gap-1">
                  <button
                    hlmBtn
                    variant="ghost"
                    size="sm"
                    type="button"
                    class="h-6 px-2 text-xs text-muted-foreground"
                    [disabled]="describing() !== null"
                    (click)="describe(asset, locale)"
                  >
                    <!-- Named by its words: "describe the image in English with AI (paid)". -->
                    <ng-icon name="lucideSparkles" size="12" aria-hidden="true" />
                    <span class="ml-1">{{ describing() === locale ? "…" : "describe" }}</span><span
                      class="sr-only"
                    >
                      the image in {{ locale === "en" ? "English" : "German" }} with AI</span
                    >
                    (paid)
                  </button>
                  <app-draft-offer
                    class="self-stretch"
                    [offer]="offerFor('describe', asset.id, locale)"
                    [field]="'Assistant description ' + locale.toUpperCase()"
                    [fieldId]="'description-' + locale"
                  />
                </div>
              </ng-template>
            }

            <section class="flex flex-col gap-2" aria-labelledby="usage-title">
              <h3 id="usage-title" class="m-0 text-sm font-medium">Used by</h3>
              @if (places().length) {
                <ul class="m-0 flex list-none flex-col gap-1 p-0 text-sm" role="list">
                  @for (place of places(); track place.label) {
                    <li>
                      @if (place.link) {
                        <a
                          class="underline underline-offset-4 hover:text-foreground pointer-coarse:block pointer-coarse:py-3"
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
                <p class="m-0 text-hint text-muted-foreground">
                  One of the last 20 publications shows it: a rollback to that one needs it.
                </p>
              }
            </section>

            <dl class="m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
              @if (asset.width && asset.height) {
                <dt class="text-hint text-muted-foreground">Size</dt>
                <dd class="m-0 font-data text-xs">
                  {{ asset.width }} × {{ asset.height }}, {{ asset.variants.length }} resized
                  {{ asset.variants.length === 1 ? "copy" : "copies" }}
                </dd>
              }
              <dt class="text-hint text-muted-foreground">Type</dt>
              <dd class="m-0 font-data text-xs">{{ asset.mime }}</dd>
              <dt class="text-hint text-muted-foreground">Path</dt>
              <dd class="m-0 flex min-w-0 items-center gap-1">
                <code class="min-w-0 truncate font-data text-xs" translate="no">{{
                  asset.path
                }}</code>
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
              </a>
              <!-- Blocked, it stays a stop: the reason is heard, not only seen. -->
              <button
                hlmBtn
                variant="outline"
                size="sm"
                type="button"
                class="ml-auto text-destructive aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
                [attr.aria-disabled]="blocker() ? 'true' : null"
                [attr.aria-describedby]="blocker() ? 'delete-blocker' : null"
                (click)="remove(asset)"
              >
                <ng-icon name="lucideTrash2" size="14" aria-hidden="true" />
                <span class="ml-1.5">Delete</span>
              </button>
              @if (blocker(); as reason) {
                <p
                  id="delete-blocker"
                  class="m-0 w-full text-right text-hint text-muted-foreground"
                >
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
  private readonly unsaved = inject(UnsavedChangesService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  protected readonly library = inject(MediaLibraryService);
  /** The copilot's drafts (alt text, descriptions), judged when saved (plan phase 27). */
  private readonly ledger = inject(CopilotLedger);
  private readonly recovery = inject(RecoveryService);
  private readonly pulse = inject(AdminPulseService);
  /** Before a save: the file's texts read again, against what the panel opened with. */
  private readonly elsewhere = new ChangedElsewhere(this.confirm, async () => {
    const result = await this.api.listMedia();
    return result.ok ? result.data.media.map((asset) => textsOf(asset)) : null;
  });

  protected readonly filters = FILTERS;
  protected readonly accept = UPLOAD_ACCEPT;
  protected readonly isUnused = isUnused;
  protected readonly coarse =
    typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;

  protected readonly filter = signal<Filter>(
    filterFrom(this.route.snapshot.queryParamMap.get("filter")),
  );
  /** The file the address names (`?file=<id>`), opened once the library is in. */
  private readonly wanted = signal<string | null>(this.route.snapshot.queryParamMap.get("file"));
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
  /** The upload's one line for screen readers: set as the files start, emptied when they end. */
  protected readonly uploadSaid = signal("");

  /** The file whose panel is open, by id: it follows the library as it reloads. */
  private readonly activeId = signal<string | null>(null);
  protected readonly active = computed(
    () => this.library.assets().find((a) => a.id === this.activeId()) ?? null,
  );
  protected readonly alt = signal<Record<Locale, string>>({ en: "", de: "" });
  /** The description for the assistant (plan phase 17), as being edited. */
  protected readonly description = signal<Record<Locale, string>>({ en: "", de: "" });
  /** The bilingual fields' controls; the signals above follow them and are the truth. */
  protected readonly control: Record<Text, Record<Locale, FormControl<string>>> = {
    alt: { en: this.text(), de: this.text() },
    description: { en: this.text(), de: this.text() },
  };
  protected readonly suggesting = signal<Locale | null>(null);
  protected readonly describing = signal<Locale | null>(null);
  protected readonly saving = signal(false);
  /** When this panel last saved, for "Saved 14:02"; a new file starts without. */
  private readonly savedAt = signal<number | null>(null);

  protected readonly counts = computed(() => {
    const assets = this.library.assets();
    return Object.fromEntries(
      FILTERS.map((f) => [f.id, assets.filter((asset) => MATCHES[f.id](asset)).length]),
    ) as Record<Filter, number>;
  });
  protected readonly visible = computed(() =>
    this.library.assets().filter((asset) => MATCHES[this.filter()](asset)),
  );
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
        return { title: "No PDFs yet", text: "Upload your CV as a PDF, then set it on Profile." };
      case "images":
        return { title: "No images yet", text: "Upload one, or drop some on this page." };
      default:
        return { title: "Nothing uploaded yet", text: "Upload a file, or drop some on this page." };
    }
  });

  protected readonly places = computed(() =>
    (this.active()?.usage?.draft ?? [])
      .map((place) => usagePlace(place))
      .concat(this.active()?.usage?.live ? [{ label: "The live site", link: null }] : []),
  );
  protected readonly blocker = computed(() => {
    const asset = this.active();
    return asset ? deleteBlocker(asset) : null;
  });
  /** The texts that differ from what is saved, by field: the head's count and the traces. */
  protected readonly changed = computed(() => {
    const asset = this.active();
    const alt = this.alt();
    const description = this.description();
    if (!asset) {
      return [];
    }
    const fields: [string, boolean][] = [
      ["alt.en", alt.en !== (asset.altEn ?? "")],
      ["alt.de", alt.de !== (asset.altDe ?? "")],
      ["description.en", description.en.trim() !== (asset.descriptionEn ?? "")],
      ["description.de", description.de.trim() !== (asset.descriptionDe ?? "")],
    ];
    return fields.filter(([, differs]) => differs).map(([field]) => field);
  });
  protected readonly altChanged = computed(() => this.changed().some((f) => f.startsWith("alt")));
  /** Saved and not on the site yet: grey, as every field in the draft (plan 5, U16). */
  protected readonly altTrace = computed<TraceState>(() => {
    if (this.altChanged()) {
      return "unsaved";
    }
    const asset = this.active();
    return asset && altInDraft(asset, this.pulse.marks()) ? "draft" : "live";
  });
  protected readonly descriptionChanged = computed(() =>
    this.changed().some((f) => f.startsWith("description")),
  );
  protected readonly stateText = computed(() => {
    if (this.saving()) {
      return "Saving…";
    }
    const n = this.changed().length;
    if (n) {
      return n === 1 ? "1 unsaved change" : `${n} unsaved changes`;
    }
    const at = this.savedAt();
    return at ? `Saved ${typedAt(at)}` : "";
  });

  /** Destroyed: a draft that comes back after that never lands. */
  private gone = false;
  /** Each draft's notes (plan phase 28), by its field, while it waits for a save. */
  private readonly offers = signal<Record<string, { value: DraftOffer; tracked: boolean }>>({});

  protected offerFor(kind: "alt" | "describe", id: string, locale: Locale): DraftOffer | null {
    const target = `media:${kind}:${id}:${locale}`;
    const offer = this.offers()[target];
    if (!offer) {
      return null;
    }
    return !offer.tracked || this.ledger.waits(target) ? offer.value : null;
  }

  private offerDraft(target: string, draft: CopilotDraft): void {
    const value = draftOffer(draft);
    this.offers.update((all) => {
      const next = { ...all };
      if (value) {
        next[target] = { value, tracked: Boolean(draft.suggestionId) };
      } else {
        delete next[target];
      }
      return next;
    });
  }

  private readonly backup: RecoveryHandle;

  constructor() {
    for (const text of ["alt", "description"] as const) {
      for (const locale of LOCALES) {
        this.control[text][locale].valueChanges
          .pipe(takeUntilDestroyed())
          .subscribe((value) => this.texts(text).update((all) => ({ ...all, [locale]: value })));
      }
    }
    effect(() => this.unsaved.set("media", this.changed().length > 0));
    this.backup = this.recovery.track({
      editor: "media",
      item: this.activeId,
      saved: () => {
        const asset = this.active();
        if (!asset) {
          return null;
        }
        return {
          alt: { en: asset.altEn ?? "", de: asset.altDe ?? "" },
          description: { en: asset.descriptionEn ?? "", de: asset.descriptionDe ?? "" },
        };
      },
      current: () => ({ alt: this.alt(), description: this.description() }),
      restore: ({ alt, description }) => {
        this.alt.set(alt);
        this.description.set(description);
        this.fill();
      },
    });
    // The address is the truth: Find, a reload or a link can change it under the page.
    this.route.queryParamMap.pipe(takeUntilDestroyed()).subscribe((params) => {
      this.filter.set(filterFrom(params.get("filter")));
      this.wanted.set(params.get("file"));
    });
    effect(() => {
      const wanted = this.wanted();
      if (this.library.loaded()) {
        untracked(() => this.follow(wanted));
      }
    });
    // Leaving the page: a draft not saved was not kept.
    inject(DestroyRef).onDestroy(() => {
      this.gone = true;
      this.unsaved.clear("media");
      this.ledger.abandonPrefix("media:");
    });
  }

  private text(): FormControl<string> {
    return new FormControl("", { nonNullable: true });
  }

  private texts(text: Text) {
    return text === "alt" ? this.alt : this.description;
  }

  /** The fields from the signals: after an open, a copy, a draft or a save. */
  private fill(): void {
    for (const locale of LOCALES) {
      this.control.alt[locale].setValue(this.alt()[locale], { emitEvent: false });
      this.control.description[locale].setValue(this.description()[locale], { emitEvent: false });
    }
  }

  /** The file still open, and the page still here, when a draft comes back. */
  private landsOn(asset: MediaAsset): boolean {
    return !this.gone && this.activeId() === asset.id;
  }

  ngOnInit(): void {
    void this.library.load(true).then(() => this.reopen());
    void this.loadReconcile();
  }

  /** A copy kept in this browser, and no file in the address: its file's panel opens again. */
  private async reopen(): Promise<void> {
    const ids = await this.recovery.items("media");
    const asset = this.library.assets().find((a) => ids.includes(a.id));
    if (asset && !this.activeId() && !this.wanted() && !this.gone) {
      this.choose(asset);
    }
  }

  /** The panel follows the address: opens the file it names, closes when it names none. */
  private follow(wanted: string | null): void {
    if (wanted === this.activeId()) {
      return;
    }
    if (!wanted) {
      this.dropDetails();
      return;
    }
    const asset = this.library.assets().find((a) => a.id === wanted);
    if (asset) {
      this.open(asset);
      return;
    }
    toast.info("That file is no longer in the library.");
    this.wanted.set(null);
    this.go({ file: null });
  }

  /** After a failed load: asks again. */
  protected retry(): void {
    void this.library.load(true);
  }

  protected size(bytes: number): string {
    return formatBytes(bytes);
  }

  protected files(n: number): string {
    return n === 1 ? "1 file" : `${n} files`;
  }

  protected when(iso: string): string {
    return absoluteTime(iso);
  }

  protected onFilter(value: unknown): void {
    const filter = FILTERS.find((f) => f.id === value)?.id;
    if (!filter) {
      return;
    }
    this.filter.set(filter);
    this.go({ filter: filter === "all" ? null : filter });
  }

  /** The filter and the open file into the address, in place: Back leaves Media. */
  private go(params: Params): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: params,
      queryParamsHandling: "merge",
      replaceUrl: true,
    });
  }

  protected async loadReconcile(): Promise<void> {
    const result = await this.api.mediaReconcile();
    if (result.ok) {
      this.reconcile.set(result.data);
    }
  }

  /* ---- the panel ---- */

  /** A tile, or a copy waiting: the file's panel, at its address. */
  protected choose(asset: MediaAsset): void {
    this.open(asset);
    this.wanted.set(asset.id);
    this.go({ file: asset.id });
  }

  private open(asset: MediaAsset): void {
    // The fields start again from what is saved: drafts of another file are gone unsaved.
    this.ledger.abandonPrefix("media:");
    this.offers.set({});
    this.savedAt.set(null);
    this.activeId.set(asset.id);
    this.elsewhere.remember([textsOf(asset)]);
    this.alt.set({ en: asset.altEn ?? "", de: asset.altDe ?? "" });
    this.description.set({ en: asset.descriptionEn ?? "", de: asset.descriptionDe ?? "" });
    this.fill();
  }

  /** Closing with unsaved text asks first; keeping it opens the panel again, with the text. */
  protected async onSheet(state: string): Promise<void> {
    const id = this.activeId();
    // The sheet reports "closed" again once its state input follows: only the
    // first report, while a file is still open here, is a request to close.
    if (state !== "closed" || !id || this.gone) {
      return;
    }
    const unsaved = this.changed().length > 0;
    this.activeId.set(null);
    if (unsaved) {
      const discard = await this.confirm.ask({
        title: "Discard unsaved text?",
        description: "The alt text or description you changed has not been saved.",
        confirmLabel: "Discard",
        cancelLabel: "Keep editing",
        destructive: true,
      });
      if (!discard) {
        this.activeId.set(id);
        return;
      }
    }
    this.backup.drop(id);
    this.dropDetails();
  }

  /** A link out of the panel. With unsaved text the route's guard asks, and it stays open. */
  protected close(): void {
    if (this.changed().length) {
      return;
    }
    // The link's own navigation leaves the page: a second one here, to the address, would cancel it.
    this.ledger.abandonPrefix("media:");
    this.activeId.set(null);
  }

  /** The panel gone, said to the guard at once, and the address without its file. */
  private dropDetails(): void {
    this.ledger.abandonPrefix("media:");
    this.activeId.set(null);
    this.unsaved.clear("media");
    if (this.wanted()) {
      this.wanted.set(null);
      this.go({ file: null });
    }
  }

  protected onPanelKey(event: KeyboardEvent): void {
    if (!isSaveShortcut(event)) {
      return;
    }
    // Never the browser's "Save page as…" in the panel.
    event.preventDefault();
    void this.save();
  }

  /** Alt text and description in one write, only the texts that changed; the panel stays. */
  protected async save(): Promise<void> {
    const asset = this.active();
    if (!asset || this.saving() || !this.changed().length) {
      return;
    }
    const id = asset.id;
    this.saving.set(true);
    const goOn = await this.elsewhere.mayOverwrite([id], "This file's alt text or description");
    if (!goOn || this.activeId() !== id) {
      this.saving.set(false);
      return;
    }
    const sent = {
      alt: { en: this.alt().en.trim(), de: this.alt().de.trim() },
      description: { en: this.description().en.trim(), de: this.description().de.trim() },
    };
    const alt = this.altChanged();
    const description = this.descriptionChanged();
    // The copilot's drafts are judged by what this save sends, even if the panel closes meanwhile.
    const ended = this.ledger.beginSave({
      ...(alt ? { [`media:alt:${id}:en`]: sent.alt.en, [`media:alt:${id}:de`]: sent.alt.de } : {}),
      ...(description
        ? {
            [`media:describe:${id}:en`]: sent.description.en,
            [`media:describe:${id}:de`]: sent.description.de,
          }
        : {}),
    });
    const result = await this.api.updateMediaAlt(id, {
      ...(alt ? { altEn: sent.alt.en || null, altDe: sent.alt.de || null } : {}),
      ...(description
        ? {
            descriptionEn: sent.description.en || null,
            descriptionDe: sent.description.de || null,
          }
        : {}),
    });
    ended(result.ok);
    if (!result.ok) {
      this.saving.set(false);
      toastNotSaved(result.error);
      return;
    }
    await this.library.load(true);
    this.saving.set(false);
    const now = this.library.assets().find((a) => a.id === id);
    if (now) {
      this.elsewhere.remember([textsOf(now)]);
    }
    if (this.activeId() !== id) {
      return;
    }
    this.alt.set(sent.alt);
    this.description.set(sent.description);
    this.fill();
    this.savedAt.set(Date.now());
  }

  protected async suggest(asset: MediaAsset, locale: Locale): Promise<void> {
    this.suggesting.set(locale);
    const result = await this.api.copilot({ task: "alt", mediaId: asset.id, locale });
    this.suggesting.set(null);
    if (!result.ok) {
      toast.error("No suggestion", { description: apiWords(result.error) });
      return;
    }
    // Closed, or another file opened meanwhile: the draft never lands (in either file).
    if (!this.landsOn(asset)) {
      this.ledger.drop(result.data);
      return;
    }
    const before = this.alt()[locale];
    this.control.alt[locale].setValue(result.data.text);
    this.ledger.propose(`media:alt:${asset.id}:${locale}`, result.data, {
      read: () => this.alt()[locale],
      before,
    });
    this.offerDraft(`media:alt:${asset.id}:${locale}`, result.data);
  }

  /** A draft of what the picture shows, from the picture itself (the copilot, paid). */
  protected async describe(asset: MediaAsset, locale: Locale): Promise<void> {
    this.describing.set(locale);
    const result = await this.api.copilot({ task: "describe", mediaId: asset.id, locale });
    this.describing.set(null);
    if (!result.ok) {
      toast.error("No description", { description: apiWords(result.error) });
      return;
    }
    if (!this.landsOn(asset)) {
      this.ledger.drop(result.data);
      return;
    }
    const before = this.description()[locale];
    this.control.description[locale].setValue(result.data.text);
    this.ledger.propose(`media:describe:${asset.id}:${locale}`, result.data, {
      read: () => this.description()[locale],
      before,
    });
    this.offerDraft(`media:describe:${asset.id}:${locale}`, result.data);
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
    // In use: the button stays a stop with its reason, and does nothing.
    if (this.blocker()) {
      return;
    }
    const go = await this.confirm.ask({
      title: `Delete ${asset.originalName}?`,
      description: "This removes the file and its resized copies from disk. It cannot be undone.",
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!go) {
      return;
    }
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
      if (!anyway) {
        return;
      }
      result = await this.api.deleteMedia(asset.id, true);
    }
    if (!result.ok) {
      // The panel and its text stay: the file is still here.
      toast.error("Not deleted", { description: apiWords(result.error) });
      return;
    }
    this.backup.drop(asset.id);
    this.dropDetails();
    await this.afterChange();
    this.focusHeading();
    toast.success("Deleted");
  }

  /** The file's tile, or the bulk Delete, went with what was deleted: the focus goes to the heading. */
  private focusHeading(): void {
    if (!this.gone) {
      this.host.nativeElement.querySelector<HTMLElement>("h1")?.focus();
    }
  }

  /* ---- selection ---- */

  protected toggle(asset: MediaAsset): void {
    this.selected.update((set) => {
      const next = new Set(set);
      if (next.has(asset.id)) {
        next.delete(asset.id);
      } else {
        next.add(asset.id);
      }
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
      if (!go) {
        return;
      }
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
      if (includeHistory) {
        ids.push(...inHistory.map((a) => a.id));
      }
    }
    if (!ids.length) {
      return;
    }

    this.deleting.set(true);
    const result = await this.api.cleanupMedia(ids, includeHistory);
    this.deleting.set(false);
    if (!result.ok) {
      toast.error("Not deleted", { description: apiWords(result.error) });
      return;
    }
    this.selected.set(new Set());
    await this.afterChange();
    this.focusHeading();
    const { deleted, skipped, freedBytes } = result.data;
    for (const id of deleted) {
      this.recovery.forget("media", id);
    }
    toast.success(`Deleted ${deleted.length} ${deleted.length === 1 ? "file" : "files"}`, {
      description: `${formatBytes(freedBytes)} freed.${
        skipped.length ? ` ${skipped.length} became used meanwhile and were kept.` : ""
      }`,
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
    if (this.hasFiles(event) && !this.active()) {
      this.dragging.set(true);
    }
  }

  protected onDragOver(event: DragEvent): void {
    // Without this the browser opens a dropped file instead of handing it over.
    if (this.hasFiles(event) && !this.active()) {
      event.preventDefault();
    }
  }

  protected onDragLeave(event: DragEvent): void {
    // Leaving the window, not moving from one element to the next.
    if (!event.relatedTarget) {
      this.dragging.set(false);
    }
  }

  protected onDrop(event: DragEvent): void {
    if (!this.hasFiles(event) || this.active()) {
      return;
    }
    event.preventDefault();
    this.dragging.set(false);
    void this.uploadAll(Array.from(event.dataTransfer?.files ?? []));
  }

  /** One after the other, so the progress reads as one file's, and a failure names its file. */
  private async uploadAll(files: File[]): Promise<void> {
    if (!files.length || this.uploading()) {
      return;
    }
    this.uploadSaid.set(
      files.length === 1 ? `Uploading ${files[0].name}…` : `Uploading ${files.length} files…`,
    );
    const done = await this.uploadNext(files, 0, 0);
    this.uploading.set(null);
    this.uploadSaid.set("");
    await this.loadReconcile();
    if (done) {
      toast.success(done === 1 ? "Uploaded" : `Uploaded ${done} files`);
    }
  }

  private async uploadNext(files: File[], index: number, done: number): Promise<number> {
    const file = files[index];
    if (!file) {
      return done;
    }
    this.uploading.set({ name: file.name, index: index + 1, total: files.length, percent: 0 });
    const result = await this.library.upload(file, (percent) =>
      this.uploading.update((u) => (u ? { ...u, percent } : u)),
    );
    if (!result.ok) {
      toast.error(`${file.name} was not uploaded`, { description: result.message });
    }
    return this.uploadNext(files, index + 1, done + (result.ok ? 1 : 0));
  }

  private async afterChange(): Promise<void> {
    await this.library.load(true);
    await this.loadReconcile();
  }
}
