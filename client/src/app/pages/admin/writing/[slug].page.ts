import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  Injector,
  OnInit,
  signal,
} from "@angular/core";
import type { RouteMeta } from "@analogjs/router";
import { NgTemplateOutlet } from "@angular/common";
import { FormControl, FormsModule } from "@angular/forms";
import { ActivatedRoute, Router } from "@angular/router";
import { NgIcon, provideIcons } from "@ng-icons/core";
import { lucideExternalLink } from "@ng-icons/lucide";
import { HlmBadge } from "@spartan-ng/helm/badge";
import { HlmButton } from "@spartan-ng/helm/button";
import { HlmFieldLabel } from "@spartan-ng/helm/field";
import { HlmInput } from "@spartan-ng/helm/input";
import { HlmSwitch } from "@spartan-ng/helm/switch";

import {
  AdminApiService,
  type ApiIssue,
  type MediaAsset,
  type PostRow,
  type PostTranslationInput,
} from "../../../admin/admin-api.service";
import { ChangedElsewhere } from "../../../admin/changed-elsewhere";
import { countChangedFields } from "../../../admin/changed-fields";
import {
  inDraft,
  rollUp,
  stateOf,
  TRACE_WORDS,
  type DraftMarks,
  type TraceState,
} from "../../../admin/change-trace";
import { BilingualFieldComponent } from "../../../admin/components/bilingual-field.component";
import { ConfirmService } from "../../../admin/components/confirm-dialog.component";
import { CopilotSuggestComponent } from "../../../admin/components/copilot-suggest.component";
import {
  FieldIssueComponent,
  LocaleToggleComponent,
} from "../../../admin/components/editor-chrome.component";
import { EditorHeaderComponent } from "../../../admin/components/editor-header.component";
import { EditorLayoutComponent } from "../../../admin/components/editor-layout.component";
import type { LocaleView } from "../../../admin/components/field-pair.component";
import {
  FormSkeletonComponent,
  LoadErrorComponent,
  NotFoundStateComponent,
} from "../../../admin/components/load-state.component";
import { MediaFieldComponent } from "../../../admin/components/media-field.component";
import { RichTextComponent } from "../../../admin/components/rich-text.component";
import { TokenFieldComponent } from "../../../admin/components/token-field.component";
import { CopilotLedger } from "../../../admin/copilot-ledger";
import { postOutline, type OutlineItem } from "../../../admin/editor-outline";
import { FieldIssues, focusFirstInvalid } from "../../../admin/issues";
import { storedView, storeView } from "../../../admin/language-view";
import { LivePreviewService } from "../../../admin/preview/live-preview.service";
import { AdminPulseService } from "../../../admin/pulse.service";
import { RecoveryService } from "../../../admin/recovery.service";
import { toastDiscarded, toastIssues, toastNotSaved } from "../../../admin/save-feedback";
import { UnsavedChangesService, unsavedChangesGuard } from "../../../admin/unsaved-changes.service";
import { isLocale } from "../../../content/locale";
import type { Doc, Locale, PostDoc } from "../../../content/schema";

export const routeMeta: RouteMeta = { canDeactivate: [unsavedChangesGuard] };

const LOCALES: Locale[] = ["en", "de"];
const LANGUAGE: Record<Locale, string> = { en: "English", de: "German" };

const DAY_MONTH = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" });

function blankTranslation(): PostTranslationInput {
  return { title: "", excerpt: "", body: "", seoTitle: "", seoDescription: "" };
}

/** `2026-09-22T10:30` in the browser's time zone, as a `datetime-local` wants it. */
function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** A post on the site: published, its date passed. Only such a post has fields live or in the draft. */
function onSite(p: PostRow): boolean {
  return p.status === "published" && (!p.publishedAt || Date.parse(p.publishedAt) <= Date.now());
}

/** "Draft", "Scheduled for 3 Dec", "Published": the list's words. */
function statusOf(p: PostRow): string {
  if (p.status === "draft") return "Draft";
  return onSite(p) ? "Published" : `Scheduled for ${DAY_MONTH.format(Date.parse(p.publishedAt!))}`;
}

/** The texts edited in the bilingual field, one control per language. */
type PlainKey = "title" | "excerpt" | "seoTitle" | "seoDescription";

interface PlainField {
  key: PlainKey;
  /** The field's id: its inputs are `<id>-en` and `<id>-de`, as the old editor's were. */
  id: string;
  label: string;
  multiline?: boolean;
  rows?: number;
  hint?: string;
  maxLength: number;
  /** A Suggest under each language: the copilot drafts it, so the field's own paid steps stay off. */
  suggest?: boolean;
}

const TEXT_FIELDS: PlainField[] = [
  { key: "title", id: "post-title", label: "Title", maxLength: 200 },
  {
    key: "excerpt",
    id: "post-excerpt",
    label: "Excerpt",
    multiline: true,
    rows: 2,
    hint: "Under the title on the post's page and in the list of posts.",
    maxLength: 600,
  },
];

const SEARCH_FIELDS: PlainField[] = [
  {
    key: "seoTitle",
    id: "post-seo-title",
    label: "Search title",
    hint: "Empty: the title is used.",
    maxLength: 120,
  },
  {
    key: "seoDescription",
    id: "post-seo-description",
    label: "Search description",
    multiline: true,
    rows: 2,
    hint: "Empty: the excerpt is used. About 150 characters.",
    maxLength: 300,
    suggest: true,
  },
];

const PLAIN_FIELDS = [...TEXT_FIELDS, ...SEARCH_FIELDS];

type Section = "post-details" | "post-cover" | "post-tags" | "post-text" | "post-search";

/**
 * Each traced field (plan 5, U14): how to read it, and where the review shows it in the draft: its
 * path under `posts[slug]` in the core content, or its value in the post's doc.
 */
interface Traced {
  key: string;
  section: Section;
  read: (p: PostRow) => unknown;
  path?: string;
  doc?: (d: PostDoc) => unknown;
}

const text =
  (key: keyof PostTranslationInput) =>
  (p: PostRow): unknown =>
    LOCALES.map((locale) => p.translations[locale]?.[key] ?? null);

const TRACED: Traced[] = [
  { key: "slug", section: "post-details", read: (p) => p.slug, path: "slug" },
  { key: "publishedAt", section: "post-details", read: (p) => p.publishedAt, path: "publishedAt" },
  // Draft or published: no field of the site, so never "in draft" on its own.
  { key: "status", section: "post-details", read: (p) => p.status },
  {
    key: "canonicalUrl",
    section: "post-details",
    read: (p) => p.canonicalUrl,
    doc: (d) => d.canonicalUrl,
  },
  { key: "coverId", section: "post-cover", read: (p) => p.coverId, path: "cover" },
  { key: "tags", section: "post-tags", read: (p) => p.tags, path: "tags" },
  {
    key: "versions",
    section: "post-text",
    read: (p) => LOCALES.map((locale) => p.translations[locale] !== null),
  },
  { key: "title", section: "post-text", read: text("title"), path: "title" },
  { key: "excerpt", section: "post-text", read: text("excerpt"), path: "excerpt" },
  { key: "body", section: "post-text", read: text("body"), doc: (d) => d.body },
  { key: "seoTitle", section: "post-search", read: text("seoTitle"), doc: (d) => d.seo.title },
  {
    key: "seoDescription",
    section: "post-search",
    read: text("seoDescription"),
    doc: (d) => d.seo.description,
  },
];

/** A post's field is in the draft when its doc's value differs from the live one, in either language. */
function docInDraft(marks: DraftMarks | null, slug: string, read: (d: PostDoc) => unknown) {
  const pick = (doc: Doc | null) => (doc?.kind === "post" ? read(doc) : undefined);
  return LOCALES.some((locale) => {
    const change = marks?.docs?.[locale]?.find((d) => d.key === `post:${slug}`);
    return !!change && JSON.stringify(pick(change.draft)) !== JSON.stringify(pick(change.live));
  });
}

/**
 * The post editor (plan 5, U14) on Part G's pieces: the sticky header (Save, Ctrl/⌘ S, ⋯ with
 * Discard), the bilingual field with its trace, the outline with a dot per section, the language
 * view remembered per editor. Each language's switch says whether the post exists in it: off keeps
 * the text aside until Save and asks once, on brings it back.
 */
@Component({
  selector: "app-admin-post-editor",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    BilingualFieldComponent,
    CopilotSuggestComponent,
    EditorHeaderComponent,
    EditorLayoutComponent,
    FieldIssueComponent,
    FormSkeletonComponent,
    FormsModule,
    HlmBadge,
    HlmButton,
    HlmFieldLabel,
    HlmInput,
    HlmSwitch,
    LoadErrorComponent,
    LocaleToggleComponent,
    MediaFieldComponent,
    NgIcon,
    NgTemplateOutlet,
    NotFoundStateComponent,
    RichTextComponent,
    TokenFieldComponent,
  ],
  viewProviders: [provideIcons({ lucideExternalLink })],
  host: { class: "block" },
  template: `
    <app-editor-layout [outline]="outline()" [view]="shownView()">
      <div class="flex flex-col gap-6 pb-12">
        <app-editor-header
          [title]="title()"
          [changes]="changes()"
          [saving]="saving()"
          [problems]="issues.count()"
          [notLive]="notLive()"
          [savedAt]="savedAt()"
          (save)="save()"
          (discard)="discard()"
        >
          @if (status(); as words) {
            <span hlmBadge variant="outline">{{ words }}</span>
          }
          @if (bothOn()) {
            <app-locale-toggle
              class="max-md:order-first"
              [view]="shownView()"
              [both]="wide()"
              (viewChange)="choose($event)"
            />
          }
          @if (previewPath(); as href) {
            <a
              hlmBtn
              variant="ghost"
              size="sm"
              class="max-md:hidden"
              target="_blank"
              rel="noopener"
              [href]="href"
              >Post draft
              <ng-icon name="lucideExternalLink" size="14" class="ml-1.5" aria-hidden="true"
            /></a>
          }
        </app-editor-header>

        @if (loading()) {
          <app-form-skeleton [rows]="7" />
        } @else if (loadError(); as reason) {
          <app-load-error title="Could not load the post" [reason]="reason" (retry)="reload()" />
        } @else if (!post()) {
          <app-not-found-state what="post" back="/admin/writing" backLabel="All posts" />
        } @else if (post(); as p) {
          <div class="flex flex-col gap-10">
            <section
              id="post-details"
              aria-labelledby="post-details-title"
              class="flex flex-col gap-6"
            >
              <h2 id="post-details-title" class="m-0 text-section-title">Details</h2>
              <div class="grid gap-x-4 gap-y-6 sm:grid-cols-2">
                <div
                  class="change-trace flex min-w-0 flex-col gap-1.5"
                  [attr.data-change]="mark('slug')"
                >
                  <label hlmFieldLabel for="post-slug">Slug</label>
                  <input
                    hlmInput
                    id="post-slug"
                    autocomplete="off"
                    spellcheck="false"
                    translate="no"
                    maxlength="80"
                    [ngModel]="p.slug"
                    (ngModelChange)="patch({ slug: $event })"
                    [attr.aria-invalid]="issues.get('slug') ? true : null"
                    [aria-describedby]="describedBy('slug', 'post-slug')"
                  />
                  <span id="post-slug-state" class="sr-only">{{ words("slug") }}</span>
                  <app-field-issue id="post-slug-issue" [message]="issues.get('slug')" />
                </div>
                <div
                  class="change-trace flex min-w-0 flex-col gap-1.5"
                  [attr.data-change]="mark('publishedAt')"
                >
                  <label hlmFieldLabel for="post-date">Publish date</label>
                  <p id="post-date-hint" class="m-0 text-hint text-muted-foreground">
                    In the future: on the site with the first publish after it.
                  </p>
                  <input
                    hlmInput
                    id="post-date"
                    type="datetime-local"
                    [ngModel]="localDate()"
                    (ngModelChange)="setDate($event)"
                    [attr.aria-invalid]="issues.get('publishedAt') ? true : null"
                    [aria-describedby]="describedBy('publishedAt', 'post-date', true)"
                  />
                  <span id="post-date-state" class="sr-only">{{ words("publishedAt") }}</span>
                  <app-field-issue id="post-date-issue" [message]="issues.get('publishedAt')" />
                </div>
                <div
                  class="change-trace flex min-w-0 flex-col gap-1.5"
                  [attr.data-change]="mark('status')"
                >
                  <label class="flex min-h-9 items-center gap-3 text-sm font-medium">
                    <hlm-switch
                      [checked]="p.status === 'published'"
                      (checkedChange)="setPublished($event)"
                      [aria-describedby]="
                        mark('status') ? 'post-status-state post-status-hint' : 'post-status-hint'
                      "
                    />
                    <span>Published</span>
                  </label>
                  <p id="post-status-hint" class="m-0 text-hint text-muted-foreground">
                    Off: a draft, not on the site.
                  </p>
                  <span id="post-status-state" class="sr-only">{{ words("status") }}</span>
                </div>
                <div
                  class="change-trace flex min-w-0 flex-col gap-1.5"
                  [attr.data-change]="mark('canonicalUrl')"
                >
                  <label hlmFieldLabel for="post-canonical">Canonical URL</label>
                  <p id="post-canonical-hint" class="m-0 text-hint text-muted-foreground">
                    Where it first appeared, if elsewhere.
                  </p>
                  <input
                    hlmInput
                    id="post-canonical"
                    type="url"
                    autocomplete="off"
                    maxlength="500"
                    [ngModel]="p.canonicalUrl"
                    (ngModelChange)="patch({ canonicalUrl: $event })"
                    [attr.aria-invalid]="issues.get('canonicalUrl') ? true : null"
                    [aria-describedby]="describedBy('canonicalUrl', 'post-canonical', true)"
                  />
                  <span id="post-canonical-state" class="sr-only">{{ words("canonicalUrl") }}</span>
                  <app-field-issue
                    id="post-canonical-issue"
                    [message]="issues.get('canonicalUrl')"
                  />
                </div>
              </div>
            </section>

            <section id="post-cover" aria-labelledby="post-cover-title" class="flex flex-col gap-4">
              <h2 id="post-cover-title" class="m-0 text-section-title">Cover</h2>
              <div class="change-trace" [attr.data-change]="mark('coverId')">
                <app-media-field
                  id="post-cover-image"
                  label="Cover image"
                  [hint]="coverHint()"
                  [path]="p.coverPath"
                  (chosen)="chooseCover($event)"
                />
              </div>
            </section>

            <section id="post-tags" aria-labelledby="post-tags-title" class="flex flex-col gap-4">
              <h2 id="post-tags-title" class="m-0 text-section-title">Tags</h2>
              <app-token-field
                [id]="'tags'"
                label="Tags"
                singular="tag"
                [max]="20"
                [value]="p.tags"
                [issue]="issues.under('tags')"
                [state]="trace()['tags'] ?? 'live'"
                (valueChange)="patch({ tags: $event })"
              />
            </section>

            <section id="post-text" aria-labelledby="post-text-title" class="flex flex-col gap-6">
              <h2 id="post-text-title" class="m-0 text-section-title">Text</h2>
              <div class="change-trace flex flex-col gap-1.5" [attr.data-change]="mark('versions')">
                <div class="flex flex-wrap items-center gap-x-8 gap-y-2">
                  @for (locale of allLocales; track locale) {
                    <label class="flex min-h-9 items-center gap-3 text-sm font-medium">
                      <hlm-switch
                        [checked]="p.translations[locale] !== null"
                        (checkedChange)="setLocale(locale, $event)"
                        [aria-describedby]="versionsDescribedBy(locale)"
                      />
                      <span>{{ language[locale] }} version</span>
                    </label>
                  }
                </div>
                <span id="post-versions-state" class="sr-only">{{ words("versions") }}</span>
                @for (locale of allLocales; track locale) {
                  @if (p.translations[locale] === null) {
                    <p
                      [id]="'post-' + locale + '-off'"
                      class="m-0 text-hint text-muted-foreground"
                      [textContent]="offLine(locale)"
                    ></p>
                  }
                }
                <app-field-issue
                  id="post-translations-issue"
                  [message]="issues.get('translations')"
                />
              </div>

              @if (versions().length) {
                <ng-container *ngTemplateOutlet="heads" />
                @for (field of textFields; track field.key) {
                  <ng-container *ngTemplateOutlet="plain; context: { $implicit: field }" />
                }
                <div class="change-trace flex flex-col gap-1.5" [attr.data-change]="mark('body')">
                  <span class="text-sm font-medium">Body</span>
                  <span id="post-body-state" class="sr-only">{{ words("body") }}</span>
                  <!-- Side by side from 1280 px, each about half the column; one above the other below it. -->
                  <div
                    [class]="shownView() === 'both' ? 'grid gap-4 xl:grid-cols-2' : 'grid gap-4'"
                  >
                    @for (locale of locales(); track locale) {
                      <div class="flex min-w-0 flex-col gap-1">
                        @if (shownView() === "both") {
                          <span class="text-hint text-muted-foreground" aria-hidden="true">{{
                            language[locale]
                          }}</span>
                        }
                        <app-rich-text
                          mode="long"
                          [attr.lang]="locale"
                          [ngModel]="bodyOf(locale)"
                          (ngModelChange)="patchText(locale, { body: $event })"
                          [label]="'Body ' + language[locale]"
                          [describedBy]="bodyDescribedBy(locale)"
                        />
                        <app-field-issue
                          [id]="'post-body-' + locale + '-issue'"
                          [message]="textIssue(locale, 'body')"
                        />
                      </div>
                    }
                  </div>
                </div>
              }
            </section>

            @if (versions().length) {
              <section
                id="post-search"
                aria-labelledby="post-search-title"
                class="flex flex-col gap-6"
              >
                <h2 id="post-search-title" class="m-0 text-section-title">Search</h2>
                <ng-container *ngTemplateOutlet="heads" />
                @for (field of searchFields; track field.key) {
                  <ng-container *ngTemplateOutlet="plain; context: { $implicit: field }" />
                }
              </section>
            }
          </div>
        }
      </div>
    </app-editor-layout>

    <!-- English and German over the two-language fields below them, once a section. -->
    <ng-template #heads>
      @if (shownView() === "both") {
        <div
          class="-mb-4 grid grid-cols-2 gap-3 text-hint text-muted-foreground max-lg:hidden"
          aria-hidden="true"
        >
          <span>English</span><span>German</span>
        </div>
      }
    </ng-template>

    <ng-template #plain let-field>
      <app-bilingual-field
        [id]="field.id"
        [label]="field.label"
        [hint]="field.hint ?? ''"
        [multiline]="field.multiline ?? false"
        [rows]="field.rows ?? 2"
        [maxLength]="field.maxLength"
        [ai]="!field.suggest"
        [notes]="bothOn()"
        [view]="shownView()"
        [state]="trace()[field.key] ?? 'live'"
        [live]="liveCopy()[field.key] ?? null"
        [controlEn]="control(field.key, 'en')"
        [controlDe]="control(field.key, 'de')"
        [below]="field.suggest ? suggest : null"
      />
      <ng-template #suggest let-locale>
        <app-copilot-suggest
          class="self-end"
          [locale]="locale"
          [fieldId]="field.id + '-' + locale"
          [source]="sourceFor(locale)"
          [target]="seoTarget(locale)"
          [current]="seoValueFor(locale)"
          (suggested)="control(field.key, locale).setValue($event)"
        />
      </ng-template>
    </ng-template>
  `,
})
export default class AdminPostEditorPage implements OnInit {
  private readonly api = inject(AdminApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly unsaved = inject(UnsavedChangesService);
  private readonly ledger = inject(CopilotLedger);
  private readonly confirm = inject(ConfirmService);
  private readonly injector = inject(Injector);
  /** The review, for the trace's draft state; absent in unit tests. */
  private readonly pulse = inject(AdminPulseService, { optional: true });
  private readonly previewPanel = inject(LivePreviewService, { optional: true });
  private readonly versionsCheck = new ChangedElsewhere(this.confirm, async () => {
    const id = this.post()?.id;
    const found = id ? await this.api.getPost(id) : null;
    return found?.ok ? [found.data.post] : null;
  });

  private readonly host = inject(ElementRef<HTMLElement>);
  private gone = false;

  protected readonly allLocales = LOCALES;
  protected readonly language = LANGUAGE;
  protected readonly textFields = TEXT_FIELDS;
  protected readonly searchFields = SEARCH_FIELDS;

  protected readonly loading = signal(true);
  /** The API's reason when the post did not arrive. */
  protected readonly loadError = signal<string | null>(null);
  protected readonly saving = signal(false);
  /** When this editor last saved, for the header's "Saved 14:02". */
  protected readonly savedAt = signal<number | null>(null);
  /** Per trace key, when this editor saved it: in the draft until a review asked after that arrives. */
  private readonly savedHere = signal<ReadonlyMap<string, number>>(new Map());
  protected readonly post = signal<PostRow | null>(null);
  private pristine: PostRow | null = null;
  private readonly revision = signal(0);
  /** A language switched off: its text, kept here until Save. */
  private readonly setAside = signal<Partial<Record<Locale, PostTranslationInput>>>({});
  /** Languages whose removal was asked about and agreed, since the last save or discard. */
  private readonly asked = new Set<Locale>();
  /** The last save's problems, by the input's path (`translations.de.title`). */
  protected readonly issues = new FieldIssues();

  protected readonly view = signal<LocaleView>(storedView("post") ?? "both");
  /** English and German side by side from 1024 px; one language below it. */
  protected readonly wide = computed(() => this.previewPanel?.wide() ?? true);
  /** The languages the post exists in now. */
  protected readonly versions = computed<Locale[]>(() =>
    LOCALES.filter((locale) => (this.post()?.translations[locale] ?? null) !== null),
  );
  protected readonly bothOn = computed(() => this.versions().length === 2);
  /** The view, within the languages the post has: one on, that one. */
  protected readonly shownView = computed<LocaleView>(() => {
    const on = this.versions();
    if (on.length < 2) return on[0] ?? "en";
    return this.view() === "both" && !this.wide() ? "en" : this.view();
  });
  protected readonly locales = computed<Locale[]>(() => {
    const view = this.shownView();
    return view === "both" ? LOCALES : [view];
  });

  /** One control per plain text and language, mirroring the post: the bilingual field's. */
  private readonly controls = Object.fromEntries(
    PLAIN_FIELDS.map(({ key }) => [
      key,
      {
        en: new FormControl("", { nonNullable: true }),
        de: new FormControl("", { nonNullable: true }),
      },
    ]),
  ) as Record<PlainKey, Record<Locale, FormControl<string>>>;

  protected readonly title = computed(() => {
    const p = this.post();
    return (
      p?.translations.en?.title ||
      p?.translations.de?.title ||
      p?.slug ||
      this.route.snapshot.paramMap.get("slug") ||
      "Post"
    );
  });

  /** As saved, while it is on no page: a draft, or scheduled. Published, the header's "Live" says it. */
  protected readonly status = computed(() => {
    this.revision();
    return this.pristine && !onSite(this.pristine) ? statusOf(this.pristine) : null;
  });

  /** The saved post's draft page, in English when it has one. */
  protected readonly previewPath = computed(() => {
    this.revision();
    const saved = this.pristine;
    if (!saved) return null;
    const locale = saved.translations.en ? "en" : "de";
    return `/admin/preview/${locale}/writing/${encodeURIComponent(saved.slug)}`;
  });

  /** What the copilot describes when asked for a search description. */
  private readonly seoSources: Record<Locale, () => string> = {
    en: () => this.postText("en"),
    de: () => this.postText("de"),
  };

  /** The search description as it reads now: what a draft is judged by when the post is saved. */
  private readonly seoValues: Record<Locale, () => string> = {
    en: () => this.post()?.translations.en?.seoDescription ?? "",
    de: () => this.post()?.translations.de?.seoDescription ?? "",
  };

  protected readonly dirty = computed(() => {
    this.revision();
    const current = this.post();
    return current !== null && JSON.stringify(current) !== JSON.stringify(this.pristine);
  });

  /** The cover's path follows its id: one field. */
  protected readonly changes = computed(() => {
    this.revision();
    return countChangedFields(this.pristine, this.post(), ["coverPath"]);
  });

  /** Each traced field's state, by its key: unsaved here, in the draft, or live. */
  protected readonly trace = computed<Record<string, TraceState>>(() => {
    this.revision();
    const now = this.post();
    const base = this.pristine;
    if (!now || !base) return {};
    const marks = this.pulse?.marks() ?? null;
    const saved = this.savedHere();
    const live = onSite(base);
    const out: Record<string, TraceState> = {};
    for (const { key, read, path, doc } of TRACED) {
      const unsaved = JSON.stringify(read(now)) !== JSON.stringify(read(base));
      // A draft or a scheduled post is on no page: nothing of it is live, or in the draft against it.
      const inReview = path
        ? inDraft(marks, `posts[${base.slug}].${path}`)
        : !!doc && docInDraft(marks, base.slug, doc);
      const draft = live && (inReview || (saved.get(key) ?? 0) > (marks?.asked ?? 0));
      out[key] = stateOf(unsaved, draft);
    }
    return out;
  });

  /** The live site's title and excerpt in both languages, for "English changed, German not". */
  protected readonly liveCopy = computed(() => {
    const marks = this.pulse?.marks() ?? null;
    this.revision();
    const slug = this.pristine?.slug;
    const at = (locale: Locale, key: "title" | "excerpt") =>
      marks?.live[locale]?.posts?.find((p) => p.slug === slug)?.[key];
    return Object.fromEntries(
      (["title", "excerpt"] as const).map((key) => {
        const [en, de] = [at("en", key), at("de", key)];
        return [key, typeof en === "string" && typeof de === "string" ? { en, de } : null];
      }),
    ) as Record<string, Record<Locale, string> | null>;
  });

  /** Fields saved to the draft and not live; null for a post not on the site, or while unknown. */
  protected readonly notLive = computed(() => {
    this.revision();
    if (!this.pristine || !onSite(this.pristine)) return null;
    if (!this.pulse?.marks() && this.savedHere().size === 0) return null;
    return Object.values(this.trace()).filter((state) => state === "draft").length;
  });

  /** The sections for the rail: how far along each is, its trace, and the last save's problems in it. */
  protected readonly outline = computed<OutlineItem[]>(() => {
    const p = this.post();
    if (!p) return [];
    const trace = this.trace();
    const problems = this.issues.entries().map(([path]) => path);
    return postOutline(p, problems).map((item) => ({
      ...item,
      change: rollUp(
        TRACED.filter((t) => t.section === item.id).map((t) => trace[t.key] ?? "live"),
      ),
    }));
  });

  protected readonly localDate = computed(() => toLocalInput(this.post()?.publishedAt ?? null));

  /** The cover's hint, with its trace's words: a media slot has no description of its own. */
  protected readonly coverHint = computed(() => {
    const words = this.words("coverId");
    return ["Under the title on the post's page.", words && `${words}.`].filter(Boolean).join(" ");
  });

  constructor() {
    effect(() => this.unsaved.set("post", this.dirty()));
    inject(DestroyRef).onDestroy(() => {
      this.gone = true;
      this.unsaved.clear("post");
      // Leaving unsaved: the copilot's drafts were not kept.
      this.ledger.abandonPrefix("post:");
    });
    // A field's text, typed or put there by its ⋯ or its Suggest, goes into the post like any edit.
    for (const { key } of PLAIN_FIELDS) {
      for (const locale of LOCALES) {
        this.controls[key][locale].valueChanges.subscribe((value) => {
          const translation = this.post()?.translations[locale];
          if (translation && value !== translation[key]) this.patchText(locale, { [key]: value });
        });
      }
    }
    // A language switched off keeps its text aside: that goes too.
    inject(RecoveryService).track<
      PostRow & { setAside: Partial<Record<Locale, PostTranslationInput>> }
    >({
      editor: "post",
      item: () => this.post()?.id ?? null,
      saved: () => {
        this.revision();
        return this.pristine ? { ...this.pristine, setAside: {} } : null;
      },
      current: () => {
        const row = this.post();
        return row ? { ...row, setAside: this.setAside() } : null;
      },
      restore: ({ setAside, ...row }) => {
        this.post.set(row);
        this.setAside.set(setAside);
        this.revision.update((v) => v + 1);
        this.fill();
      },
    });
  }

  ngOnInit(): void {
    void this.load();
  }

  protected choose(view: LocaleView): void {
    this.view.set(view);
    storeView("post", view);
  }

  protected control(key: PlainKey, locale: Locale): FormControl<string> {
    return this.controls[key][locale];
  }

  /** For the Suggest's template, whose `let-locale` is untyped. */
  protected sourceFor(locale: Locale): () => string {
    return this.seoSources[locale];
  }

  protected seoValueFor(locale: Locale): () => string {
    return this.seoValues[locale];
  }

  /** A search description's name in the copilot's ledger, with its post. */
  protected seoTarget(locale: Locale, id = this.post()?.id ?? ""): string {
    return `post:${id}:seo:${locale}`;
  }

  private postText(locale: Locale): string {
    const t = this.post()?.translations[locale];
    if (!t) return "";
    return [t.title, t.excerpt, t.body].filter(Boolean).join("\n");
  }

  protected reload(): void {
    this.loading.set(true);
    void this.load();
  }

  private async load(): Promise<void> {
    // A draft left by an earlier editor (a save that failed after it closed) was not kept.
    this.ledger.abandonPrefix("post:");
    const slug = this.route.snapshot.paramMap.get("slug");
    const list = await this.api.listPosts();
    const id = list.ok ? list.data.posts.find((p) => p.slug === slug)?.id : undefined;
    const result = id ? await this.api.getPost(id) : null;
    this.loading.set(false);

    if (!list.ok) {
      this.loadError.set(list.error);
      return;
    }
    if (result && !result.ok) {
      this.loadError.set(result.error);
      return;
    }
    this.loadError.set(null);
    const found = result?.ok ? result.data.post : null;
    this.post.set(found ? structuredClone(found) : null);
    this.pristine = found ? structuredClone(found) : null;
    if (found) this.versionsCheck.remember([found]);
    this.revision.update((v) => v + 1);
    this.fill(true);
  }

  /** The controls take the post's text: after a load, a discard, a language back, or a recovery copy. */
  private fill(fresh = false): void {
    for (const { key } of PLAIN_FIELDS) {
      for (const locale of LOCALES) {
        const control = this.controls[key][locale];
        const value = this.post()?.translations[locale]?.[key] ?? "";
        // A reset abandons the field's own drafts and its Undo: only where the text moved, or on a load.
        if (fresh || control.value !== value) control.reset(value);
      }
    }
  }

  protected mark(key: string): TraceState | null {
    const state = this.trace()[key] ?? "live";
    return state === "live" ? null : state;
  }

  protected words(key: string): string {
    return TRACE_WORDS[this.trace()[key] ?? "live"];
  }

  /** A one-language field's description: its save problem, its trace's words, its hint. */
  protected describedBy(key: string, id: string, hint = false): string | null {
    const ids = [
      this.issues.get(key) ? `${id}-issue` : null,
      this.mark(key) ? `${id}-state` : null,
      hint ? `${id}-hint` : null,
    ].filter(Boolean);
    return ids.length ? ids.join(" ") : null;
  }

  /** A language's switch: its trace's words, and the line under it while it is off. */
  protected versionsDescribedBy(locale: Locale): string | null {
    const ids = [
      this.mark("versions") ? "post-versions-state" : null,
      this.post()?.translations[locale] === null ? `post-${locale}-off` : null,
    ].filter(Boolean);
    return ids.length ? ids.join(" ") : null;
  }

  /** A body's description: its save problem, then its trace's words. */
  protected bodyDescribedBy(locale: Locale): string | null {
    const ids = [
      this.textIssue(locale, "body") ? `post-body-${locale}-issue` : null,
      this.mark("body") ? "post-body-state" : null,
    ].filter(Boolean);
    return ids.length ? ids.join(" ") : null;
  }

  /** What a language switched off means: gone on Save, or never there. */
  protected offLine(locale: Locale): string {
    const language = LANGUAGE[locale];
    return this.setAside()[locale]
      ? `The ${language} version goes when you save. Turn its switch back on to keep it.`
      : `No ${language} version: the ${language} site leaves this post out.`;
  }

  protected bodyOf(locale: Locale): string {
    return this.post()?.translations[locale]?.body ?? "";
  }

  protected textIssue(locale: Locale, key: string): string | null {
    return this.issues.get(`translations.${locale}.${key}`);
  }

  protected patch(change: Partial<PostRow>): void {
    this.post.update((p) => (p ? { ...p, ...change } : p));
    this.revision.update((v) => v + 1);
    // `translations` is patched whole; its per-field messages clear in patchText.
    for (const key of Object.keys(change)) {
      if (key !== "translations") this.issues.resolve(key);
    }
  }

  protected setDate(value: string): void {
    this.patch({ publishedAt: value ? new Date(value).toISOString() : null });
  }

  protected setPublished(published: boolean): void {
    const current = this.post();
    this.patch({
      status: published ? "published" : "draft",
      // Publishing without a date means "now".
      publishedAt:
        published && !current?.publishedAt
          ? new Date().toISOString()
          : (current?.publishedAt ?? null),
    });
  }

  /**
   * On: the text set aside comes back. Off: the text is set aside until Save, so
   * nothing is lost by a slip, and the first time for a language it asks.
   */
  protected async setLocale(locale: Locale, exists: boolean): Promise<void> {
    const current = this.post();
    if (!current) return;
    this.issues.resolve("translations");
    if (exists) {
      this.putTranslation(locale, this.setAside()[locale] ?? blankTranslation());
      this.setAside.update((kept) => ({ ...kept, [locale]: undefined }));
      return;
    }
    const text = current.translations[locale];
    const typed = text && Object.values(text).some((v) => v.trim() !== "" && v !== "<p></p>");
    this.setAside.update((kept) => ({ ...kept, [locale]: typed ? text : undefined }));
    this.putTranslation(locale, null);
    if (!typed || this.asked.has(locale)) return;

    const remove = await this.confirm.ask({
      title: `Remove the ${LANGUAGE[locale]} version when you save?`,
      description: "The text stays here until you save. Turn the switch back on to keep it.",
      confirmLabel: "Remove when I save",
      cancelLabel: "Keep it",
      destructive: true,
    });
    if (remove) {
      this.asked.add(locale);
      return;
    }
    this.putTranslation(locale, text);
    this.setAside.update((kept) => ({ ...kept, [locale]: undefined }));
  }

  private putTranslation(locale: Locale, translation: PostTranslationInput | null): void {
    this.post.update((p) =>
      p ? { ...p, translations: { ...p.translations, [locale]: translation } } : p,
    );
    this.revision.update((v) => v + 1);
    this.fill();
  }

  protected patchText(locale: Locale, change: Partial<PostTranslationInput>): void {
    const current = this.post();
    const translation = current?.translations[locale];
    if (!current || !translation) return;
    this.patch({
      translations: { ...current.translations, [locale]: { ...translation, ...change } },
    });
    for (const key of Object.keys(change)) this.issues.resolve(`translations.${locale}.${key}`);
  }

  protected chooseCover(asset: MediaAsset | null): void {
    this.patch({ coverId: asset?.id ?? null, coverPath: asset?.path ?? null });
  }

  protected discard(): void {
    const edits = this.post();
    const setAside = this.setAside();
    toastDiscarded(() => {
      this.post.set(edits);
      this.setAside.set(setAside);
      this.revision.update((v) => v + 1);
      this.fill();
    });
    this.post.set(this.pristine ? structuredClone(this.pristine) : null);
    this.setAside.set({});
    this.asked.clear();
    this.revision.update((v) => v + 1);
    this.issues.clear();
    this.fill();
    // Thrown away with the other unsaved edits: the copilot's drafts were not kept.
    this.ledger.abandonPrefix("post:");
  }

  protected async save(): Promise<void> {
    const current = this.post();
    if (!current || this.saving()) return;

    this.saving.set(true);
    if (!(await this.versionsCheck.mayOverwrite([current.id], this.title()))) {
      this.saving.set(false);
      return;
    }
    // The copilot's drafts are judged by what this save sends (plan phase 27).
    const ended = this.ledger.beginSave({
      [this.seoTarget("en", current.id)]: current.translations.en?.seoDescription ?? "",
      [this.seoTarget("de", current.id)]: current.translations.de?.seoDescription ?? "",
    });
    const result = await this.api.updatePost(current.id, {
      slug: current.slug,
      status: current.status,
      publishedAt: current.publishedAt,
      coverId: current.coverId,
      tags: current.tags.filter((t) => t.trim() !== ""),
      canonicalUrl: current.canonicalUrl.trim(),
      translations: current.translations,
    });
    if (result.ok) await this.versionsCheck.refresh();
    this.saving.set(false);
    ended(result.ok);
    if (this.gone) return;
    if (result.ok) this.saved(current);
    else this.refused(result.error, result.issues ?? []);
  }

  /** A refused save: its problems on their fields, the first focused, in the language that shows them. */
  private refused(error: string, issues: readonly ApiIssue[]): void {
    if (error === "duplicate_slug") {
      this.issues.add("slug", "Another post already uses this slug");
      focusFirstInvalid(this.host.nativeElement);
      return;
    }
    if (!issues.length) {
      toastNotSaved(error, "Save failed");
      return;
    }
    this.issues.set(issues);
    toastIssues(issues);
    const shown = this.shownView();
    const other = issues.find((i) => isLocale(i.path[1]) && shown !== "both" && i.path[1] !== shown)
      ?.path[1] as Locale | undefined;
    // A problem in the language not shown: show it (both where both fit), then place the problems.
    if (other) this.view.set(this.wide() ? "both" : other);
    afterNextRender(
      () => {
        if (this.gone) return;
        for (const { key } of PLAIN_FIELDS) {
          for (const locale of LOCALES) {
            const message = this.textIssue(locale, key);
            if (message) this.controls[key][locale].setErrors({ server: message });
          }
        }
        focusFirstInvalid(this.host.nativeElement);
      },
      { injector: this.injector },
    );
  }

  /** A save that landed: the new saved state, its fields marked saved here, the header told when. */
  private saved(current: PostRow): void {
    const slugChanged = this.pristine?.slug !== current.slug;
    const before = this.trace();
    this.pristine = structuredClone(current);
    this.setAside.set({});
    this.asked.clear();
    const at = Date.now();
    this.savedHere.update((marks) => {
      const next = new Map(marks);
      for (const [key, state] of Object.entries(before)) if (state === "unsaved") next.set(key, at);
      return next;
    });
    this.revision.update((v) => v + 1);
    this.issues.clear();
    for (const { key } of PLAIN_FIELDS) {
      for (const locale of LOCALES) this.controls[key][locale].markAsPristine();
    }
    this.savedAt.set(at);
    // The route is keyed by slug, so keep the URL in step after a rename (saved: the guard lets it by).
    if (slugChanged) {
      this.unsaved.set("post", false);
      void this.router.navigate(["/admin/writing", current.slug], { replaceUrl: true });
    }
  }
}
