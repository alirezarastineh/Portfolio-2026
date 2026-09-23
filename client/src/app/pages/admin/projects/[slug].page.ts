import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  OnInit,
  signal,
} from "@angular/core";
import type { RouteMeta } from "@analogjs/router";
import { FormsModule } from "@angular/forms";
import { ActivatedRoute, Router, RouterLink } from "@angular/router";
import { toast } from "@spartan-ng/brain/sonner";
import { NgIcon, provideIcons } from "@ng-icons/core";
import { lucideArrowLeft } from "@ng-icons/lucide";
import { HlmButton } from "@spartan-ng/helm/button";
import { HlmField, HlmFieldLabel } from "@spartan-ng/helm/field";
import { HlmInput } from "@spartan-ng/helm/input";
import { HlmSeparator } from "@spartan-ng/helm/separator";
import { HlmSkeleton } from "@spartan-ng/helm/skeleton";
import { HlmSwitch } from "@spartan-ng/helm/switch";
import { HlmTextarea } from "@spartan-ng/helm/textarea";

import {
  AdminApiService,
  type MediaAsset,
  type ProjectRow,
  type ProjectTranslation,
} from "../../../admin/admin-api.service";
import type { MetricInput } from "../../../admin/admin-schema";
import {
  LocaleToggleComponent,
  SaveBarComponent,
} from "../../../admin/components/editor-chrome.component";
import type { LocaleView } from "../../../admin/components/field-pair.component";
import {
  GalleryEditorComponent,
  type GalleryItem,
} from "../../../admin/components/gallery-editor.component";
import { MediaFieldComponent } from "../../../admin/components/media-field.component";
import { MetricsEditorComponent } from "../../../admin/components/metrics-editor.component";
import { RichTextComponent } from "../../../admin/components/rich-text.component";
import { StringListComponent } from "../../../admin/components/string-list.component";
import { UnsavedChangesService, unsavedChangesGuard } from "../../../admin/unsaved-changes.service";
import type { Locale } from "../../../content/schema";

type TextKey =
  | "name"
  | "descriptor"
  | "hook"
  | "role"
  | "categoryLabel"
  | "seoDescription"
  | "problem"
  | "aiArchitecture"
  | "fullStackInfra";

interface TextFieldDef {
  key: TextKey;
  label: string;
  multiline?: boolean;
  /** Rendered with the Tiptap editor and stored as sanitized HTML. */
  rich?: boolean;
  rows?: number;
  hint?: string;
  maxLength?: number;
}

const CARD_FIELDS: TextFieldDef[] = [
  { key: "name", label: "Name", maxLength: 160 },
  {
    key: "descriptor",
    label: "Descriptor",
    hint: "Short uppercase eyebrow above the title.",
    maxLength: 200,
  },
  {
    key: "hook",
    label: "Hook",
    multiline: true,
    rows: 2,
    hint: "One sentence: what it does, for whom.",
    maxLength: 600,
  },
  { key: "role", label: "Your role", hint: "e.g. Lead engineer · team of 4", maxLength: 160 },
  {
    key: "categoryLabel",
    label: "Category label",
    hint: "How the category key reads in this language.",
    maxLength: 80,
  },
  { key: "problem", label: "Problem", rich: true },
  { key: "aiArchitecture", label: "AI architecture", rich: true },
  { key: "fullStackInfra", label: "Full-stack & infrastructure", rich: true },
  {
    key: "seoDescription",
    label: "Search description",
    multiline: true,
    rows: 2,
    hint: "For the case-study page; the hook is used when empty. About 150 characters.",
    maxLength: 300,
  },
];

function filledMetrics(metrics: MetricInput[]): MetricInput[] {
  return metrics.filter((m) => m.value.trim() !== "" && m.label.trim() !== "");
}

export const routeMeta: RouteMeta = { canDeactivate: [unsavedChangesGuard] };

@Component({
  selector: "app-admin-project-editor",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    GalleryEditorComponent,
    HlmButton,
    HlmField,
    HlmFieldLabel,
    HlmInput,
    HlmSeparator,
    HlmSkeleton,
    HlmSwitch,
    HlmTextarea,
    LocaleToggleComponent,
    MediaFieldComponent,
    MetricsEditorComponent,
    NgIcon,
    RichTextComponent,
    RouterLink,
    SaveBarComponent,
    StringListComponent,
  ],
  viewProviders: [provideIcons({ lucideArrowLeft })],
  host: { class: "block" },
  template: `
    <div class="mx-auto flex max-w-4xl flex-col gap-6 pb-28">
      <a hlmBtn variant="ghost" size="sm" class="self-start" routerLink="/admin/projects">
        <ng-icon name="lucideArrowLeft" size="14" aria-hidden="true" />
        <span class="ml-1.5">All projects</span>
      </a>

      @if (loading()) {
        <hlm-skeleton class="h-96 w-full" />
      } @else if (!project()) {
        <p class="text-sm text-muted-foreground">Project not found.</p>
      } @else if (project(); as p) {
        <header class="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 class="m-0 font-mono text-2xl tracking-tight">
              {{ p.translations.en.name || p.slug }}
            </h1>
            <p class="mt-1 font-mono text-sm text-muted-foreground">/{{ p.slug }}</p>
          </div>
          <app-locale-toggle [(view)]="view" />
        </header>

        <section class="grid gap-4 sm:grid-cols-2">
          <div hlmField>
            <label hlmFieldLabel for="slug">Slug</label>
            <input
              hlmInput
              id="slug"
              [ngModel]="p.slug"
              (ngModelChange)="patch({ slug: $event })"
            />
          </div>
          <div hlmField>
            <label hlmFieldLabel for="category">Category key</label>
            <input
              hlmInput
              id="category"
              placeholder="ai-platform"
              [ngModel]="p.category"
              (ngModelChange)="patch({ category: $event })"
            />
          </div>
          <div hlmField>
            <label hlmFieldLabel for="periodStart">Started</label>
            <input
              hlmInput
              id="periodStart"
              type="date"
              [ngModel]="p.periodStart ?? ''"
              (ngModelChange)="patch({ periodStart: $event || null })"
            />
          </div>
          <div hlmField>
            <label hlmFieldLabel for="periodEnd">Ended</label>
            <input
              hlmInput
              id="periodEnd"
              type="date"
              [ngModel]="p.periodEnd ?? ''"
              (ngModelChange)="patch({ periodEnd: $event || null })"
              aria-describedby="periodEnd-hint"
            />
            <span id="periodEnd-hint" class="text-[0.72rem] text-muted-foreground"
              >Empty = ongoing.</span
            >
          </div>
          <div hlmField>
            <label hlmFieldLabel for="linkLive">Live URL</label>
            <input
              hlmInput
              id="linkLive"
              [ngModel]="p.linkLive"
              (ngModelChange)="patch({ linkLive: $event })"
            />
          </div>
          <div hlmField>
            <label hlmFieldLabel for="linkRepo">Repository URL</label>
            <input
              hlmInput
              id="linkRepo"
              [ngModel]="p.linkRepo"
              (ngModelChange)="patch({ linkRepo: $event })"
            />
          </div>
          <div hlmField>
            <label hlmFieldLabel for="linkCaseStudy">External case study URL</label>
            <input
              hlmInput
              id="linkCaseStudy"
              [ngModel]="p.linkCaseStudy"
              (ngModelChange)="patch({ linkCaseStudy: $event })"
            />
          </div>
          <label class="flex items-center gap-3 self-end pb-2 font-mono text-[0.8rem]">
            <hlm-switch [checked]="p.featured" (checkedChange)="patch({ featured: $event })" />
            <span>Featured on the home page</span>
          </label>
        </section>

        <app-media-field
          id="cover"
          label="Cover image"
          hint="Shown on the card and at the top of the case study."
          [path]="p.coverPath"
          (chosen)="chooseCover($event)"
        />
        @if (!p.coverId) {
          <div hlmField>
            <label hlmFieldLabel for="imagePath">Placeholder path (legacy)</label>
            <input
              hlmInput
              id="imagePath"
              placeholder="/projects/example.svg"
              [ngModel]="p.imagePath"
              (ngModelChange)="patch({ imagePath: $event })"
            />
          </div>
        }

        <div class="grid gap-6 sm:grid-cols-2">
          <app-string-list
            label="Tech stack"
            singular="technology"
            emptyText="No stack entries yet."
            [max]="40"
            [value]="p.stack"
            (valueChange)="patch({ stack: $event })"
          />
          <app-string-list
            label="Tags"
            singular="tag"
            emptyText="No tags yet."
            [max]="20"
            [value]="p.tags"
            (valueChange)="patch({ tags: $event })"
          />
        </div>

        <hlm-separator />

        @for (field of cardFields; track field.key) {
          <div class="flex flex-col gap-2">
            <span class="font-mono text-[0.8rem]">{{ field.label }}</span>
            @if (field.hint) {
              <p class="m-0 text-[0.75rem] text-muted-foreground">{{ field.hint }}</p>
            }
            <div [class]="columns()">
              @for (locale of visibleLocales(); track locale) {
                <div class="flex flex-col gap-1">
                  @if (view() === "both") {
                    <span
                      class="font-mono text-[0.65rem] uppercase tracking-[0.2em] text-muted-foreground"
                    >
                      {{ locale }}
                    </span>
                  }
                  @if (field.rich) {
                    <app-rich-text
                      [ngModel]="p.translations[locale][field.key]"
                      (ngModelChange)="patchText(locale, field.key, $event)"
                      [label]="field.label + ' (' + locale + ')'"
                    />
                  } @else if (field.multiline) {
                    <textarea
                      hlmTextarea
                      [rows]="field.rows ?? 3"
                      [attr.maxlength]="field.maxLength ?? null"
                      [ngModel]="p.translations[locale][field.key]"
                      (ngModelChange)="patchText(locale, field.key, $event)"
                      [attr.aria-label]="field.label + ' (' + locale + ')'"
                    ></textarea>
                  } @else {
                    <input
                      hlmInput
                      [attr.maxlength]="field.maxLength ?? null"
                      [ngModel]="p.translations[locale][field.key]"
                      (ngModelChange)="patchText(locale, field.key, $event)"
                      [attr.aria-label]="field.label + ' (' + locale + ')'"
                    />
                  }
                </div>
              }
            </div>
          </div>
          <hlm-separator />
        }

        <div [class]="columns()">
          @for (locale of visibleLocales(); track locale) {
            <app-string-list
              [label]="'Outcomes (' + locale + ')'"
              singular="outcome"
              emptyText="No outcomes yet."
              [max]="20"
              [value]="p.translations[locale].outcomes"
              (valueChange)="patchTranslation(locale, { outcomes: $event })"
            />
          }
        </div>

        <hlm-separator />

        <div [class]="columns()">
          @for (locale of visibleLocales(); track locale) {
            <app-metrics-editor
              [label]="'Metrics (' + locale + ')'"
              [value]="p.translations[locale].metrics"
              (valueChange)="patchMetrics(locale, $event)"
            />
          }
        </div>

        <hlm-separator />

        <section class="flex flex-col gap-3">
          <div>
            <h2 class="m-0 font-mono text-sm uppercase tracking-[0.2em] text-muted-foreground">
              Case study
            </h2>
            <p class="m-0 mt-1 text-[0.78rem] text-muted-foreground">
              The long read at /work/{{ p.slug }}. Empty in a language = no case-study page in that
              language.
            </p>
          </div>
          @for (locale of visibleLocales(); track locale) {
            <div class="flex flex-col gap-1">
              @if (view() === "both") {
                <span
                  class="font-mono text-[0.65rem] uppercase tracking-[0.2em] text-muted-foreground"
                >
                  {{ locale }}
                </span>
              }
              <app-rich-text
                mode="long"
                [ngModel]="p.translations[locale].body"
                (ngModelChange)="patchText(locale, 'body', $event)"
                [label]="'Case study (' + locale + ')'"
              />
            </div>
          }
        </section>

        <hlm-separator />

        <app-gallery-editor [value]="gallery()" (valueChange)="patchGallery($event)" />

        <app-save-bar [dirty]="dirty()" [saving]="saving()" (save)="save()" (discard)="discard()" />
      }
    </div>
  `,
})
export default class AdminProjectEditorPage implements OnInit {
  private readonly api = inject(AdminApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly unsaved = inject(UnsavedChangesService);

  protected readonly cardFields = CARD_FIELDS;
  protected readonly view = signal<LocaleView>("both");
  protected readonly loading = signal(true);
  protected readonly saving = signal(false);

  protected readonly project = signal<ProjectRow | null>(null);
  private pristine: ProjectRow | null = null;
  private readonly revision = signal(0);

  protected readonly dirty = computed(() => {
    this.revision();
    const current = this.project();
    return current !== null && JSON.stringify(current) !== JSON.stringify(this.pristine);
  });

  protected readonly gallery = computed<GalleryItem[]>(() => this.project()?.gallery ?? []);
  protected readonly columns = computed(() =>
    this.view() === "both" ? "grid gap-3 lg:grid-cols-2" : "grid gap-3",
  );

  constructor() {
    effect(() => this.unsaved.set("project", this.dirty()));
    inject(DestroyRef).onDestroy(() => this.unsaved.clear("project"));
  }

  ngOnInit(): void {
    void this.load();
  }

  protected visibleLocales(): Locale[] {
    return this.view() === "both" ? ["en", "de"] : [this.view() as Locale];
  }

  private async load(): Promise<void> {
    const slug = this.route.snapshot.paramMap.get("slug");
    const list = await this.api.listProjects();
    const id = list.ok ? list.data.projects.find((p) => p.slug === slug)?.id : undefined;
    const result = id ? await this.api.getProject(id) : null;
    this.loading.set(false);

    if (!list.ok || (result && !result.ok)) {
      toast.error("Could not load project", { description: list.ok ? "" : list.error });
      return;
    }

    const found = result?.ok ? result.data.project : null;
    this.project.set(found ? structuredClone(found) : null);
    this.pristine = found ? structuredClone(found) : null;
    this.revision.update((v) => v + 1);
  }

  protected chooseCover(asset: MediaAsset | null): void {
    this.patch({ coverId: asset?.id ?? null, coverPath: asset?.path ?? null });
  }

  protected patch(change: Partial<ProjectRow>): void {
    this.project.update((p) => (p ? { ...p, ...change } : p));
    this.revision.update((v) => v + 1);
  }

  protected patchGallery(gallery: GalleryItem[]): void {
    this.patch({ gallery });
  }

  /** Angular templates cannot express a computed property key, so the field
   * name arrives as its own argument. */
  protected patchText(locale: Locale, key: TextKey | "body", value: string): void {
    this.patchTranslation(locale, { [key]: value } as Partial<ProjectTranslation>);
  }

  protected patchMetrics(locale: Locale, metrics: MetricInput[]): void {
    this.patchTranslation(locale, { metrics });
  }

  protected patchTranslation(locale: Locale, change: Partial<ProjectTranslation>): void {
    this.project.update((p) =>
      p
        ? {
            ...p,
            translations: {
              ...p.translations,
              [locale]: { ...p.translations[locale], ...change },
            },
          }
        : p,
    );
    this.revision.update((v) => v + 1);
  }

  protected discard(): void {
    this.project.set(this.pristine ? structuredClone(this.pristine) : null);
    this.revision.update((v) => v + 1);
  }

  protected async save(): Promise<void> {
    const current = this.project();
    if (!current || this.saving()) return;

    this.saving.set(true);
    const result = await this.api.updateProject(current.id, {
      slug: current.slug,
      coverId: current.coverId,
      imagePath: current.coverId ? "" : current.imagePath,
      stack: current.stack.filter((s) => s.trim() !== ""),
      linkLive: current.linkLive,
      linkRepo: current.linkRepo,
      linkCaseStudy: current.linkCaseStudy,
      isVisible: current.isVisible,
      featured: current.featured,
      periodStart: current.periodStart,
      periodEnd: current.periodEnd,
      category: current.category.trim(),
      tags: current.tags.filter((t) => t.trim() !== ""),
      gallery: current.gallery.map(({ mediaId, caption }) => ({ mediaId, caption })),
      // A metric row left blank is not an error, just not a metric.
      translations: {
        en: { ...current.translations.en, metrics: filledMetrics(current.translations.en.metrics) },
        de: { ...current.translations.de, metrics: filledMetrics(current.translations.de.metrics) },
      },
    });
    this.saving.set(false);

    if (!result.ok) {
      const descriptions: Record<string, string> = {
        duplicate_slug: "Another project already uses that slug.",
        invalid_input:
          "Check the dates (the end cannot come before the start), metrics and field lengths.",
      };
      toast.error("Save failed", { description: descriptions[result.error] ?? result.error });
      return;
    }

    const slugChanged = this.pristine?.slug !== current.slug;
    this.pristine = structuredClone(current);
    this.revision.update((v) => v + 1);
    toast.success("Draft saved");

    // The route is keyed by slug, so keep the URL in step after a rename.
    if (slugChanged) {
      void this.router.navigate(["/admin/projects", current.slug], { replaceUrl: true });
    }
  }
}
