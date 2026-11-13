import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  ElementRef,
  inject,
  Injector,
  OnInit,
  signal,
} from "@angular/core";
import type { RouteMeta } from "@analogjs/router";
import { FormBuilder, FormControl, ReactiveFormsModule } from "@angular/forms";
import { toast } from "@spartan-ng/brain/sonner";
import { HlmButton } from "@spartan-ng/helm/button";

import { AdminApiService, type ApiIssue } from "../../admin/admin-api.service";
import { countChangedFields } from "../../admin/changed-fields";
import { liveText, rollUp, traceOf, type TraceState } from "../../admin/change-trace";
import { BilingualFieldComponent } from "../../admin/components/bilingual-field.component";
import { ConfirmService } from "../../admin/components/confirm-dialog.component";
import { LocaleToggleComponent } from "../../admin/components/editor-chrome.component";
import { EditorHeaderComponent } from "../../admin/components/editor-header.component";
import { EditorLayoutComponent } from "../../admin/components/editor-layout.component";
import type { LocaleView } from "../../admin/components/field-pair.component";
import {
  FormSkeletonComponent,
  LoadErrorComponent,
} from "../../admin/components/load-state.component";
import type { OutlineItem } from "../../admin/editor-outline";
import { isHidden } from "../../admin/hidden-fields";
import { applyIssues, countServerErrors, focusFirstInvalid } from "../../admin/issues";
import { storedView, storeView } from "../../admin/language-view";
import { LivePreviewService } from "../../admin/preview/live-preview.service";
import { AdminPulseService } from "../../admin/pulse.service";
import { RecoveryService } from "../../admin/recovery.service";
import { askStale, toastDiscarded, toastIssues, toastNotSaved } from "../../admin/save-feedback";
import { UnsavedChangesService, unsavedChangesGuard } from "../../admin/unsaved-changes.service";
import { isLocale } from "../../content/locale";
import type { Locale, Seo } from "../../content/schema";

interface FieldDef {
  key: keyof Seo;
  label: string;
  /** Where its value appears. */
  hint: string;
  multiline?: boolean;
  /** Offer the AI copilot; off for URLs, names and codes. */
  ai?: boolean;
  /** Where search results and cards start cutting it off. */
  softMax?: number;
}

interface Section {
  id: string;
  title: string;
  note?: string;
  /** Shown as text, each opened for editing by its Change. */
  setOnce?: boolean;
  fields: FieldDef[];
}

/** In the page's order. The OG URL is the page's own address now: hidden, its value kept. */
const SECTIONS: Section[] = [
  {
    id: "seo-search",
    title: "Search",
    fields: [
      {
        key: "title",
        label: "Page title",
        hint: "The home page's title: its tab, search results and the structured data.",
        softMax: 60,
      },
      {
        key: "description",
        label: "Meta description",
        multiline: true,
        hint: "The home page's description in search results and the structured data; also for case studies and posts without their own, the agent card and llms.txt.",
        softMax: 160,
      },
      {
        key: "canonical",
        label: "Canonical URL",
        hint: "The site's address while Profile's Site address is empty; visits are counted on its host only. Absolute, with the trailing slash.",
        ai: false,
      },
    ],
  },
  {
    id: "seo-cards",
    title: "Social cards",
    fields: [
      {
        key: "ogTitle",
        label: "OG title",
        hint: "The title on the home page's card where a link to it is shared.",
        softMax: 60,
      },
      {
        key: "ogDescription",
        label: "OG description",
        multiline: true,
        hint: "The description on the home page's card.",
        softMax: 200,
      },
      {
        key: "ogImage",
        label: "OG image URL",
        hint: "The image on every page's card, unless a case study or post has its own.",
        ai: false,
      },
      { key: "ogUrl", label: "OG URL", hint: "", ai: false },
      {
        key: "twitterCard",
        label: "Twitter card type",
        hint: "How X (Twitter) shows a shared link, on every page: summary_large_image or summary.",
        ai: false,
      },
      {
        key: "twitterTitle",
        label: "Twitter title",
        hint: "The title on the home page's card on X.",
        softMax: 70,
      },
      {
        key: "twitterDescription",
        label: "Twitter description",
        multiline: true,
        hint: "The description on the home page's card on X.",
        softMax: 200,
      },
      {
        key: "twitterImage",
        label: "Twitter image URL",
        hint: "The image on every page's card on X, unless a case study or post has its own.",
        ai: false,
      },
    ],
  },
  {
    id: "seo-set-once",
    title: "Set once",
    note: "Kept with these settings, not taken from Profile. Change opens one for editing.",
    setOnce: true,
    fields: [
      { key: "author", label: "Author", hint: "The author tag of every page.", ai: false },
      {
        key: "siteName",
        label: "Site name",
        hint: "The site's name on every page's card, the structured data's site name, and the legal pages' descriptions.",
        ai: false,
      },
      {
        key: "ogLocale",
        label: "Locale",
        hint: "The card's locale on every page in that language, as en_US.",
        ai: false,
      },
    ],
  },
];

const ALL_FIELDS = SECTIONS.flatMap((section) => section.fields);

type SeoGroup = Record<keyof Seo, FormControl<string>>;

export const routeMeta: RouteMeta = { canDeactivate: [unsavedChangesGuard] };

/**
 * SEO & sharing (plan 5, U11): what a search result and a shared link's card say about the
 * site, per language, with the limits where they are cut; the values set once (author, site
 * name, locale) read as text until Change opens one. On the editor header and the bilingual field.
 */
@Component({
  selector: "app-admin-seo",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    BilingualFieldComponent,
    EditorHeaderComponent,
    EditorLayoutComponent,
    FormSkeletonComponent,
    HlmButton,
    LoadErrorComponent,
    LocaleToggleComponent,
    ReactiveFormsModule,
  ],
  host: { class: "block" },
  template: `
    <app-editor-layout [outline]="outline()" [view]="shownView()">
      <div class="flex flex-col gap-6">
        <app-editor-header
          title="SEO & sharing"
          [changes]="changes()"
          [saving]="saving()"
          [problems]="problems()"
          [notLive]="notLive()"
          (save)="save()"
          (discard)="reset()"
        >
          <app-locale-toggle
            class="max-md:order-first"
            [view]="shownView()"
            [both]="wide()"
            (viewChange)="choose($event)"
          />
        </app-editor-header>

        @if (loading()) {
          <app-form-skeleton [rows]="6" />
        } @else if (loadError() !== null) {
          <app-load-error [reason]="loadError() ?? ''" (retry)="reload()" />
        } @else if (loaded()) {
          <div class="flex flex-col gap-10">
            @for (section of sections; track section.id) {
              <section
                class="flex flex-col gap-6"
                [id]="section.id"
                [attr.aria-labelledby]="section.id + '-title'"
              >
                <div class="flex flex-col gap-1">
                  <h2 class="m-0 text-section-title" [id]="section.id + '-title'">
                    {{ section.title }}
                  </h2>
                  @if (section.note) {
                    <p class="m-0 text-hint text-muted-foreground">{{ section.note }}</p>
                  }
                </div>
                @if (shownView() === "both") {
                  <div
                    class="-mb-4 grid grid-cols-2 gap-3 text-hint text-muted-foreground"
                    aria-hidden="true"
                  >
                    <span>English</span><span>German</span>
                  </div>
                }
                @for (field of section.fields; track field.key) {
                  @if (!section.setOnce || opened().has(field.key)) {
                    <app-bilingual-field
                      [id]="'seo-' + field.key"
                      [label]="field.label"
                      [hint]="field.hint"
                      [multiline]="field.multiline ?? false"
                      [rows]="2"
                      [view]="shownView()"
                      [ai]="field.ai ?? true"
                      [softMax]="field.softMax ?? 0"
                      [state]="trace()[field.key] ?? 'live'"
                      [live]="liveTexts()[field.key] ?? null"
                      [controlEn]="controlFor('en', field.key)"
                      [controlDe]="controlFor('de', field.key)"
                    />
                  } @else {
                    <!-- The field's anatomy, its value as text, and Change where ⋯ would be. -->
                    <div class="flex flex-col gap-1.5">
                      <div class="flex min-h-6 items-center justify-between gap-3">
                        <span class="text-sm font-medium">{{ field.label }}</span>
                        <button
                          hlmBtn
                          variant="ghost"
                          size="sm"
                          type="button"
                          class="-my-1 text-muted-foreground"
                          (click)="change(field.key)"
                        >
                          Change<span class="sr-only"> {{ field.label }}</span>
                        </button>
                      </div>
                      <p class="m-0 text-hint text-muted-foreground">{{ field.hint }}</p>
                      <div [class]="shownView() === 'both' ? 'grid gap-3 lg:grid-cols-2' : 'grid'">
                        @for (locale of shownLocales(); track locale) {
                          <p
                            class="m-0 min-w-0 wrap-anywhere"
                            [class.text-data]="field.key === 'ogLocale'"
                          >
                            <span class="sr-only">{{
                              locale === "en" ? "English: " : "German: "
                            }}</span
                            ><span translate="no" [attr.lang]="locale">{{
                              controlFor(locale, field.key).value
                            }}</span>
                          </p>
                        }
                      </div>
                    </div>
                  }
                }
              </section>
            }
          </div>
        }
      </div>
    </app-editor-layout>
  `,
})
export default class AdminSeoPage implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly api = inject(AdminApiService);
  private readonly unsaved = inject(UnsavedChangesService);
  private readonly confirm = inject(ConfirmService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  /** Destroyed: a save that answers after that focuses nothing. */
  private gone = false;
  /** The review, for the trace's draft state; absent in unit tests. */
  private readonly pulse = inject(AdminPulseService, { optional: true });
  private readonly previewPanel = inject(LivePreviewService, { optional: true });

  protected readonly sections = SECTIONS.map((section) => ({
    ...section,
    fields: section.fields.filter((field) => !isHidden("section", "seo", field.key)),
  }));
  private readonly shown = this.sections.flatMap((section) => section.fields);
  private readonly setOnce = new Set(
    this.sections.filter((s) => s.setOnce).flatMap((s) => s.fields.map((f) => f.key)),
  );

  protected readonly view = signal<LocaleView>("both");
  /** English and German side by side from 1024 px; one language below it. */
  protected readonly wide = computed(() => this.previewPanel?.wide() ?? true);
  protected readonly shownView = computed<LocaleView>(() =>
    this.view() === "both" && !this.wide() ? "en" : this.view(),
  );
  protected readonly shownLocales = computed<Locale[]>(() => {
    const view = this.shownView();
    return view === "both" ? ["en", "de"] : [view];
  });

  protected readonly loading = signal(true);
  protected readonly loaded = signal(false);
  /** The API's reason when the first load failed. */
  protected readonly loadError = signal<string | null>(null);
  protected readonly saving = signal(false);
  private readonly formVersion = signal(0);
  /** Set-once values opened by their Change. */
  private readonly changing = signal<ReadonlySet<keyof Seo>>(new Set());
  /** Per field, when this page saved it: in the draft until a review asked after that arrives. */
  private readonly savedHere = signal<ReadonlyMap<string, number>>(new Map());

  /** The concurrency token echoed back on save. */
  private updatedAt: string | null = null;
  private pristine: Record<Locale, Seo> | null = null;

  protected readonly form = this.fb.nonNullable.group({
    en: this.fb.nonNullable.group(this.emptyGroup()),
    de: this.fb.nonNullable.group(this.emptyGroup()),
  });

  /** The form as loaded or last saved: what "changed" compares with. */
  private baseline: Record<Locale, Record<string, string>> | null = null;

  /** Fields that differ from the saved ones: typing a value back is no change. */
  protected readonly changes = computed(() => {
    this.formVersion();
    return this.baseline ? countChangedFields(this.baseline, this.form.getRawValue()) : 0;
  });

  protected readonly problems = computed(() => {
    this.formVersion();
    return countServerErrors(this.form);
  });

  /** Each shown field's trace: unsaved over the saved form, else the review's draft against live. */
  protected readonly trace = computed<Record<string, TraceState>>(() => {
    this.formVersion();
    const marks = this.pulse?.marks() ?? null;
    const saved = this.savedHere();
    const raw = this.form.getRawValue() as Record<Locale, Record<string, string>>;
    const base = this.baseline;
    return Object.fromEntries(
      this.shown.map(({ key }) => {
        const unsaved = !!base && (raw.en[key] !== base.en[key] || raw.de[key] !== base.de[key]);
        return [key, traceOf(unsaved, marks, `seo.${key}`, saved.get(key))];
      }),
    );
  });

  /** The live site's text per field, for the German's notes. */
  protected readonly liveTexts = computed(() => {
    const marks = this.pulse?.marks() ?? null;
    return Object.fromEntries(this.shown.map((f) => [f.key, liveText(marks, `seo.${f.key}`)]));
  });

  /** A set-once value shows as its field once opened, and while it is unsaved or flagged. */
  protected readonly opened = computed(() => {
    const trace = this.trace();
    const flagged = (key: keyof Seo) =>
      this.form.controls.en.controls[key].hasError("server") ||
      this.form.controls.de.controls[key].hasError("server");
    return new Set(
      [...this.setOnce].filter(
        (key) => this.changing().has(key) || trace[key] === "unsaved" || flagged(key),
      ),
    );
  });

  /** Fields saved to the draft and not live; null until the review or a save here says. */
  protected readonly notLive = computed(() => {
    if (!this.pulse?.marks() && this.savedHere().size === 0) return null;
    return Object.values(this.trace()).filter((state) => state === "draft").length;
  });

  /** A section per entry, its dot the trace rolled up, its count the save's problems. */
  protected readonly outline = computed<OutlineItem[]>(() => {
    this.formVersion();
    if (!this.loaded()) return [];
    const trace = this.trace();
    const flagged = (key: keyof Seo) =>
      (["en", "de"] as const).filter((l) => this.form.controls[l].controls[key].hasError("server"))
        .length;
    return this.sections.map((section) => ({
      id: section.id,
      label: section.title,
      problems: section.fields.reduce((sum, f) => sum + flagged(f.key), 0),
      change: rollUp(section.fields.map((f) => trace[f.key] ?? "live")),
    }));
  });

  constructor() {
    this.form.valueChanges.subscribe(() => {
      this.formVersion.update((v) => v + 1);
      this.unsaved.set("seo", this.changes() > 0);
    });
    inject(DestroyRef).onDestroy(() => {
      this.gone = true;
      this.unsaved.clear("seo");
    });
    inject(RecoveryService).track<Record<Locale, Seo>>({
      editor: "seo",
      saved: () => {
        this.formVersion();
        return this.baseline as Record<Locale, Seo> | null;
      },
      current: () => {
        this.formVersion();
        return this.loaded() ? (this.form.getRawValue() as Record<Locale, Seo>) : null;
      },
      restore: (value) => {
        this.form.patchValue(value);
        this.form.markAsDirty();
      },
    });
  }

  ngOnInit(): void {
    const stored = storedView("seo");
    if (stored) this.view.set(stored);
    void this.load();
  }

  private emptyGroup(): Record<string, string> {
    return Object.fromEntries(ALL_FIELDS.map((f) => [f.key, ""]));
  }

  protected controlFor(locale: Locale, key: keyof Seo): FormControl<string> {
    return (this.form.controls[locale].controls as SeoGroup)[key];
  }

  /** SEO's language view, remembered in this browser. */
  protected choose(view: LocaleView): void {
    this.view.set(view);
    storeView("seo", view);
  }

  /** A set-once value as its field, with the focus in it: the button that opened it is gone. */
  protected change(key: keyof Seo): void {
    this.changing.update((keys) => new Set(keys).add(key));
    const locale = this.shownView() === "de" ? "de" : "en";
    setTimeout(() =>
      this.host.nativeElement.querySelector<HTMLElement>(`#seo-${key}-${locale}`)?.focus(),
    );
  }

  protected reload(): void {
    this.loading.set(true);
    void this.load();
  }

  /** (Re)loads from the server, dropping local edits. */
  private async load(): Promise<void> {
    const result = await this.api.getSection<Seo>("seo");
    this.loading.set(false);
    // A failed reload after "Saved elsewhere" keeps the form: only a first load shows the error.
    if (!this.loaded()) this.loadError.set(result.ok ? null : result.error);

    if (!result.ok) {
      if (this.loaded()) toast.error("Could not load SEO", { description: result.error });
      return;
    }

    this.updatedAt = result.data.updatedAt;
    this.pristine = result.data.data;
    this.form.reset({ en: result.data.data.en, de: result.data.data.de });
    this.form.markAsPristine();
    this.baseline = this.form.getRawValue();
    this.formVersion.update((v) => v + 1);
    this.unsaved.clear("seo");
    this.loaded.set(true);
  }

  protected reset(): void {
    if (!this.pristine) return;
    const edits = this.form.getRawValue();
    this.form.reset({ en: this.pristine.en, de: this.pristine.de });
    this.form.markAsPristine();
    this.formVersion.update((v) => v + 1);
    this.unsaved.clear("seo");
    toastDiscarded(() => {
      this.form.setValue(edits);
      this.form.markAsDirty();
    });
  }

  protected async save(): Promise<void> {
    if (this.saving()) return;

    const raw = this.form.getRawValue() as Record<Locale, Seo>;
    const changed = Object.entries(this.trace())
      .filter(([, state]) => state === "unsaved")
      .map(([key]) => key);
    this.saving.set(true);
    const result = await this.api.putSection<Seo>("seo", raw, this.updatedAt);
    this.saving.set(false);

    if (!result.ok) {
      if (result.status === 409) {
        await this.handleStale();
      } else if (result.issues?.length) {
        this.handleIssues(result.issues);
      } else {
        toastNotSaved(result.error, "Save failed");
      }
      return;
    }

    this.updatedAt = result.data.updatedAt;
    this.pristine = raw;
    this.form.markAsPristine();
    this.baseline = raw;
    const now = Date.now();
    this.savedHere.update(
      (saved) => new Map([...saved, ...changed.map((key) => [key, now] as const)]),
    );
    this.formVersion.update((v) => v + 1);
    this.unsaved.clear("seo");
  }

  private async handleStale(): Promise<void> {
    const fresh = await this.api.getSection<Seo>("seo");
    if (await askStale(this.confirm)) {
      await this.load();
    } else if (fresh.ok) {
      this.updatedAt = fresh.data.updatedAt;
    }
  }

  private handleIssues(issues: readonly ApiIssue[]): void {
    // A refused set-once value turns into its field first: helm's input marks a field invalid from
    // the status changes it sees, so the problems go on once the field exists.
    const closed = issues
      .map(({ path: [, key] }) => key as keyof Seo)
      .filter((key) => this.setOnce.has(key) && !this.opened().has(key));
    if (closed.length) {
      this.changing.update((keys) => new Set([...keys, ...closed]));
      if (!this.gone) afterNextRender(() => this.handleIssues(issues), { injector: this.injector });
      return;
    }
    // `[locale, field]`, straight onto the pair's control.
    const unplaced = applyIssues(issues, ([locale, key]) =>
      isLocale(locale) && typeof key === "string"
        ? ((this.form.controls[locale].controls as Record<string, FormControl>)[key] ?? null)
        : null,
    );
    this.formVersion.update((v) => v + 1);
    // One language at a time on a narrow editor: the one with the problem.
    const shown = this.shownView();
    const hidden = issues
      .map((i) => i.path[0])
      .find((l): l is Locale => isLocale(l) && shown !== "both" && l !== shown);
    if (hidden) this.view.set(this.wide() ? "both" : hidden);
    toastIssues(unplaced.length ? unplaced : issues);
    focusFirstInvalid(this.host.nativeElement);
  }
}
