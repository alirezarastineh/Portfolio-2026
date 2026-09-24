import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject,
  OnInit,
  signal,
} from "@angular/core";
import type { RouteMeta } from "@analogjs/router";
import { FormBuilder, FormControl, ReactiveFormsModule } from "@angular/forms";
import { toast } from "@spartan-ng/brain/sonner";
import { HlmSeparator } from "@spartan-ng/helm/separator";
import { HlmSkeleton } from "@spartan-ng/helm/skeleton";

import { AdminApiService } from "../../admin/admin-api.service";
import { UnsavedChangesService, unsavedChangesGuard } from "../../admin/unsaved-changes.service";
import {
  LocaleToggleComponent,
  SaveBarComponent,
} from "../../admin/components/editor-chrome.component";
import { FieldPairComponent, type LocaleView } from "../../admin/components/field-pair.component";
import { seoSchema, type Locale, type Seo } from "../../content/schema";

interface FieldDef {
  key: keyof Seo;
  label: string;
  multiline?: boolean;
  hint?: string;
  /** Offer the AI copilot; off for URLs, names and codes. */
  ai?: boolean;
}

const FIELDS: FieldDef[] = [
  { key: "title", label: "Page title", hint: "Shown in the browser tab and search results." },
  {
    key: "description",
    label: "Meta description",
    multiline: true,
    hint: "Roughly 150–160 characters.",
  },
  { key: "author", label: "Author", ai: false },
  { key: "siteName", label: "Site name", ai: false },
  {
    key: "canonical",
    label: "Canonical URL",
    hint: "Absolute URL, including the trailing slash.",
    ai: false,
  },
  {
    key: "themeColor",
    label: "Theme colour",
    hint: "Hex value used by mobile browser chrome.",
    ai: false,
  },
  { key: "ogTitle", label: "OG title" },
  { key: "ogDescription", label: "OG description", multiline: true },
  { key: "ogImage", label: "OG image URL", ai: false },
  { key: "ogUrl", label: "OG URL", ai: false },
  { key: "ogLocale", label: "OG locale", hint: "e.g. en_US / de_DE.", ai: false },
  { key: "twitterCard", label: "Twitter card type", ai: false },
  { key: "twitterTitle", label: "Twitter title" },
  { key: "twitterDescription", label: "Twitter description", multiline: true },
  { key: "twitterImage", label: "Twitter image URL", ai: false },
];

type SeoGroup = Record<keyof Seo, FormControl<string>>;

export const routeMeta: RouteMeta = { canDeactivate: [unsavedChangesGuard] };

@Component({
  selector: "app-admin-seo",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FieldPairComponent,
    HlmSeparator,
    HlmSkeleton,
    LocaleToggleComponent,
    ReactiveFormsModule,
    SaveBarComponent,
  ],
  host: { class: "block" },
  template: `
    <div class="mx-auto flex max-w-4xl flex-col gap-6 pb-24">
      <header class="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 class="m-0 font-mono text-2xl tracking-tight">SEO &amp; meta</h1>
          <p class="mt-1 text-sm text-muted-foreground">
            Title, description and social cards, per language.
          </p>
        </div>

        <app-locale-toggle [(view)]="view" />
      </header>

      @if (loading()) {
        <hlm-skeleton class="h-96 w-full" />
      } @else if (!loaded()) {
        <p class="text-sm text-muted-foreground">Could not load this section.</p>
      } @else {
        <form [formGroup]="form" class="flex flex-col gap-6">
          @for (field of fields; track field.key) {
            <app-field-pair
              [id]="'seo-' + field.key"
              [label]="field.label"
              [hint]="field.hint ?? ''"
              [multiline]="field.multiline ?? false"
              [rows]="2"
              [view]="view()"
              [ai]="field.ai ?? true"
              [controlEn]="controlFor('en', field.key)"
              [controlDe]="controlFor('de', field.key)"
            />
            <hlm-separator />
          }
        </form>

        <app-save-bar [dirty]="dirty()" [saving]="saving()" (save)="save()" (discard)="reset()" />
      }
    </div>
  `,
})
export default class AdminSeoPage implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly api = inject(AdminApiService);
  private readonly unsaved = inject(UnsavedChangesService);

  protected readonly fields = FIELDS;
  protected readonly view = signal<LocaleView>("both");

  protected readonly loading = signal(true);
  protected readonly loaded = signal(false);
  protected readonly saving = signal(false);
  private readonly formVersion = signal(0);

  /** The concurrency token echoed back on save. */
  private updatedAt: string | null = null;
  private pristine: Record<Locale, Seo> | null = null;

  protected readonly form = this.fb.nonNullable.group({
    en: this.fb.nonNullable.group(this.emptyGroup()),
    de: this.fb.nonNullable.group(this.emptyGroup()),
  });

  protected readonly dirty = computed(() => {
    this.formVersion();
    return this.form.dirty;
  });

  constructor() {
    this.form.valueChanges.subscribe(() => {
      this.formVersion.update((v) => v + 1);
      this.unsaved.set("seo", this.form.dirty);
    });
    inject(DestroyRef).onDestroy(() => this.unsaved.clear("seo"));
  }

  ngOnInit(): void {
    void this.load();
  }

  private emptyGroup(): Record<string, string> {
    return Object.fromEntries(FIELDS.map((f) => [f.key, ""]));
  }

  protected controlFor(locale: Locale, key: keyof Seo): FormControl<string> {
    return (this.form.controls[locale].controls as SeoGroup)[key];
  }

  private async load(): Promise<void> {
    const result = await this.api.getSection<Seo>("seo");
    this.loading.set(false);

    if (!result.ok) {
      toast.error("Could not load SEO", { description: result.error });
      return;
    }

    this.updatedAt = result.data.updatedAt;
    this.pristine = result.data.data;
    this.form.reset({ en: result.data.data.en, de: result.data.data.de });
    this.form.markAsPristine();
    this.formVersion.update((v) => v + 1);
    this.unsaved.clear("seo");
    this.loaded.set(true);
  }

  protected reset(): void {
    if (!this.pristine) return;
    this.form.reset({ en: this.pristine.en, de: this.pristine.de });
    this.form.markAsPristine();
    this.formVersion.update((v) => v + 1);
    this.unsaved.clear("seo");
  }

  protected async save(): Promise<void> {
    if (this.saving()) return;

    const raw = this.form.getRawValue();
    // Validate with the shared schema before the round trip, so a missing
    // field is reported inline rather than as a 400 from the API.
    const parsed = seoSchema.safeParse(raw.en);
    const parsedDe = seoSchema.safeParse(raw.de);

    if (!parsed.success || !parsedDe.success) {
      const issue = (parsed.success ? parsedDe : parsed).error?.issues[0];
      toast.error("Check the form", {
        description: issue ? `${issue.path.join(".")}: ${issue.message}` : "Invalid values.",
      });
      return;
    }

    this.saving.set(true);
    const result = await this.api.putSection<Seo>(
      "seo",
      { en: parsed.data, de: parsedDe.data },
      this.updatedAt,
    );
    this.saving.set(false);

    if (!result.ok) {
      if (result.status === 409) {
        toast.error("Saved elsewhere", {
          description: "This section changed in another tab. Reload before saving.",
        });
        return;
      }
      toast.error("Save failed", { description: result.error });
      return;
    }

    this.updatedAt = result.data.updatedAt;
    this.pristine = { en: parsed.data, de: parsedDe.data };
    this.form.markAsPristine();
    this.formVersion.update((v) => v + 1);
    this.unsaved.clear("seo");
    toast.success("Draft saved", { description: "Publish from the dashboard to go live." });
  }
}
