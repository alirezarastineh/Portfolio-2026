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
import { HlmSheetImports } from "@spartan-ng/helm/sheet";
import { HlmSkeleton } from "@spartan-ng/helm/skeleton";
import { HlmTextarea } from "@spartan-ng/helm/textarea";

import {
  AdminApiService,
  type MediaAsset,
  type ProjectRow,
  type ProjectTranslation,
} from "../../../admin/admin-api.service";
import {
  LocaleToggleComponent,
  SaveBarComponent,
} from "../../../admin/components/editor-chrome.component";
import type { LocaleView } from "../../../admin/components/field-pair.component";
import { MediaPickerComponent } from "../../../admin/components/media-picker.component";
import { RichTextComponent } from "../../../admin/components/rich-text.component";
import { StringListComponent } from "../../../admin/components/string-list.component";
import {
  UnsavedChangesService,
  unsavedChangesGuard,
} from "../../../admin/unsaved-changes.service";
import type { Locale } from "../../../content/schema";

interface TextFieldDef {
  key: keyof Omit<ProjectTranslation, "outcomes">;
  label: string;
  multiline?: boolean;
  /** Rendered with the Tiptap editor and stored as sanitized HTML. */
  rich?: boolean;
  rows?: number;
  hint?: string;
}

const TEXT_FIELDS: TextFieldDef[] = [
  { key: "name", label: "Name" },
  { key: "descriptor", label: "Descriptor", hint: "Short uppercase eyebrow above the title." },
  { key: "hook", label: "Hook", multiline: true, rows: 2, hint: "One sentence: what it does, for whom." },
  { key: "problem", label: "Problem", rich: true },
  { key: "aiArchitecture", label: "AI architecture", rich: true },
  { key: "fullStackInfra", label: "Full-stack & infrastructure", rich: true },
];

export const routeMeta: RouteMeta = { canDeactivate: [unsavedChangesGuard] };

@Component({
  selector: "app-admin-project-editor",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    HlmButton,
    HlmField,
    HlmFieldLabel,
    HlmInput,
    HlmSeparator,
    HlmSheetImports,
    HlmSkeleton,
    HlmTextarea,
    LocaleToggleComponent,
    MediaPickerComponent,
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
            <input hlmInput id="slug" [ngModel]="p.slug" (ngModelChange)="patch({ slug: $event })" />
          </div>
          <div hlmField>
            <label hlmFieldLabel for="imagePath">Image</label>
            <div class="flex items-center gap-3">
              @if (p.imagePath) {
                <img
                  [src]="previewUrl(p.imagePath)"
                  alt=""
                  class="h-12 w-20 shrink-0 rounded border border-border object-cover"
                />
              }
              <input
                hlmInput
                id="imagePath"
                class="flex-1"
                [ngModel]="p.imagePath"
                (ngModelChange)="patch({ imagePath: $event, imageId: null })"
                placeholder="/projects/example.svg"
              />
              <button hlmBtn variant="outline" size="sm" type="button" (click)="togglePicker()">
                Browse
              </button>
            </div>
          </div>
          <div hlmField>
            <label hlmFieldLabel for="linkLive">Live URL</label>
            <input hlmInput id="linkLive" [ngModel]="p.linkLive" (ngModelChange)="patch({ linkLive: $event })" />
          </div>
          <div hlmField>
            <label hlmFieldLabel for="linkRepo">Repository URL</label>
            <input hlmInput id="linkRepo" [ngModel]="p.linkRepo" (ngModelChange)="patch({ linkRepo: $event })" />
          </div>
          <div hlmField>
            <label hlmFieldLabel for="linkCaseStudy">Case study URL</label>
            <input
              hlmInput
              id="linkCaseStudy"
              [ngModel]="p.linkCaseStudy"
              (ngModelChange)="patch({ linkCaseStudy: $event })"
            />
          </div>
        </section>

        <!-- A side sheet keeps the form in view while choosing, instead of
             pushing every field below the fold with an inline panel. -->
        <hlm-sheet
          side="right"
          [state]="pickerOpen() ? 'open' : 'closed'"
          (stateChanged)="pickerOpen.set($event === 'open')"
        >
          <hlm-sheet-content *hlmSheetPortal="let ctx" class="w-full overflow-y-auto sm:max-w-2xl">
            <hlm-sheet-header>
              <h2 hlmSheetTitle>Choose an image</h2>
              <p hlmSheetDescription>Upload a new one or pick from the library.</p>
            </hlm-sheet-header>
            <div class="px-4 pb-6">
              <app-media-picker [selected]="p.imagePath" (chosen)="chooseImage($event)" />
            </div>
          </hlm-sheet-content>
        </hlm-sheet>

        <app-string-list
          label="Tech stack"
          singular="technology"
          emptyText="No stack entries yet."
          [max]="40"
          [value]="p.stack"
          (valueChange)="patch({ stack: $event })"
        />

        <hlm-separator />

        @for (field of textFields; track field.key) {
          <div class="flex flex-col gap-2">
            <span class="font-mono text-[0.8rem]">{{ field.label }}</span>
            @if (field.hint) {
              <p class="m-0 text-[0.75rem] text-muted-foreground">{{ field.hint }}</p>
            }
            <div [class]="view() === 'both' ? 'grid gap-3 lg:grid-cols-2' : 'grid gap-3'">
              @for (locale of visibleLocales(); track locale) {
                <div class="flex flex-col gap-1">
                  @if (view() === "both") {
                    <span class="font-mono text-[0.65rem] uppercase tracking-[0.2em] text-muted-foreground">
                      {{ locale }}
                    </span>
                  }
                  @if (field.rich) {
                    <app-rich-text
                      [ngModel]="p.translations[locale][field.key]"
                      (ngModelChange)="patchTranslationField(locale, field.key, $event)"
                      [label]="field.label + ' (' + locale + ')'"
                    />
                  } @else if (field.multiline) {
                    <textarea
                      hlmTextarea
                      [rows]="field.rows ?? 3"
                      [ngModel]="p.translations[locale][field.key]"
                      (ngModelChange)="patchTranslationField(locale, field.key, $event)"
                      [attr.aria-label]="field.label + ' (' + locale + ')'"
                    ></textarea>
                  } @else {
                    <input
                      hlmInput
                      [ngModel]="p.translations[locale][field.key]"
                      (ngModelChange)="patchTranslationField(locale, field.key, $event)"
                      [attr.aria-label]="field.label + ' (' + locale + ')'"
                    />
                  }
                </div>
              }
            </div>
          </div>
          <hlm-separator />
        }

        <div [class]="view() === 'both' ? 'grid gap-4 lg:grid-cols-2' : 'grid gap-4'">
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

  protected readonly textFields = TEXT_FIELDS;
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
    const result = await this.api.listProjects();
    this.loading.set(false);

    if (!result.ok) {
      toast.error("Could not load project", { description: result.error });
      return;
    }

    const found = result.data.projects.find((p) => p.slug === slug) ?? null;
    this.project.set(found ? structuredClone(found) : null);
    this.pristine = found ? structuredClone(found) : null;
    this.revision.update((v) => v + 1);
  }

  protected readonly pickerOpen = signal(false);

  protected togglePicker(): void {
    this.pickerOpen.set(true);
  }

  /** Uploaded paths are relative; prefix them so the admin can preview them. */
  protected previewUrl(path: string): string {
    return path.startsWith("/media/") ? this.api.baseUrl + path : path;
  }

  protected chooseImage(asset: MediaAsset): void {
    this.patch({ imageId: asset.id, imagePath: asset.path });
    this.pickerOpen.set(false);
  }

  protected patch(change: Partial<ProjectRow>): void {
    this.project.update((p) => (p ? { ...p, ...change } : p));
    this.revision.update((v) => v + 1);
  }

  /** Angular templates cannot express a computed property key, so the field
   * name arrives as its own argument. */
  protected patchTranslationField(
    locale: Locale,
    key: TextFieldDef["key"],
    value: string,
  ): void {
    this.patchTranslation(locale, { [key]: value } as Partial<ProjectTranslation>);
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
      imageId: current.imageId ?? null,
      imagePath: current.imagePath,
      stack: current.stack,
      linkLive: current.linkLive,
      linkRepo: current.linkRepo,
      linkCaseStudy: current.linkCaseStudy,
      isVisible: current.isVisible,
      translations: current.translations,
    });
    this.saving.set(false);

    if (!result.ok) {
      const description =
        result.error === "duplicate_slug"
          ? "Another project already uses that slug."
          : result.error;
      toast.error("Save failed", { description });
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
