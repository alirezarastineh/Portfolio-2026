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
  type ProjectRow,
  type ProjectTranslation,
} from "../../../admin/admin-api.service";
import type { MetricInput } from "../../../admin/admin-schema";
import { ChangedElsewhere } from "../../../admin/changed-elsewhere";
import { countChangedFields } from "../../../admin/changed-fields";
import {
  inDraft,
  rollUp,
  TRACE_WORDS,
  type DraftMarks,
  type TraceState,
} from "../../../admin/change-trace";
import { BilingualFieldComponent } from "../../../admin/components/bilingual-field.component";
import { ConfirmService } from "../../../admin/components/confirm-dialog.component";
import {
  CopilotSuggestComponent,
  type PageDraftRequest,
} from "../../../admin/components/copilot-suggest.component";
import {
  FieldIssueComponent,
  LocaleToggleComponent,
} from "../../../admin/components/editor-chrome.component";
import { EditorHeaderComponent } from "../../../admin/components/editor-header.component";
import { EditorLayoutComponent } from "../../../admin/components/editor-layout.component";
import type { LocaleView } from "../../../admin/components/field-pair.component";
import {
  GalleryEditorComponent,
  type GalleryItem,
} from "../../../admin/components/gallery-editor.component";
import {
  FormSkeletonComponent,
  LoadErrorComponent,
  NotFoundStateComponent,
} from "../../../admin/components/load-state.component";
import { MediaFieldComponent } from "../../../admin/components/media-field.component";
import { MetricsEditorComponent } from "../../../admin/components/metrics-editor.component";
import { RichTextComponent } from "../../../admin/components/rich-text.component";
import { StringListComponent } from "../../../admin/components/string-list.component";
import { TokenFieldComponent } from "../../../admin/components/token-field.component";
import { CopilotLedger } from "../../../admin/copilot-ledger";
import { projectOutline, type OutlineItem } from "../../../admin/editor-outline";
import { glossaryText, parseGlossary } from "../../../admin/glossary-lines";
import { FieldIssues, focusFirstInvalid } from "../../../admin/issues";
import { storedView, storeView } from "../../../admin/language-view";
import { withProject, type LiveCompose } from "../../../admin/preview/live-content";
import { LivePreviewService } from "../../../admin/preview/live-preview.service";
import { LivePreviewToggleComponent } from "../../../admin/preview/live-preview-toggle.component";
import { AdminPulseService } from "../../../admin/pulse.service";
import { RecoveryService } from "../../../admin/recovery.service";
import { toastDiscarded, toastIssues, toastNotSaved } from "../../../admin/save-feedback";
import { UnsavedChangesService, unsavedChangesGuard } from "../../../admin/unsaved-changes.service";
import { isLocale } from "../../../content/locale";
import type { Doc, Locale, ProjectDoc } from "../../../content/schema";

/** The texts edited in the bilingual field, one control per language. */
type PlainKey =
  | "name"
  | "descriptor"
  | "hook"
  | "role"
  | "categoryLabel"
  | "seoDescription"
  | "summaryPlain"
  | "summaryExpert"
  /** Edited as `term: definition` lines, saved as the list they parse into. */
  | "glossary";
type RichKey = "problem" | "aiArchitecture" | "fullStackInfra";

interface PlainField {
  key: PlainKey;
  label: string;
  multiline?: boolean;
  rows?: number;
  hint?: string;
  maxLength?: number;
  /** Translate and Tighten in its ⋯; off for a name, and where a Suggest drafts it instead. */
  ai?: boolean;
  /** A Suggest under each language, drafting from the page's text: the copilot's request and its words. */
  copilot?: { request: PageDraftRequest; name: string };
}

interface RichField {
  key: RichKey;
  label: string;
}

const CATEGORY_LABEL: PlainField = {
  key: "categoryLabel",
  label: "Category label",
  hint: "The category in the case study's facts, and what the assistant calls it. Empty: the category key shows instead.",
  maxLength: 80,
};

const CARD_FIELDS: PlainField[] = [
  { key: "name", label: "Name", maxLength: 160, ai: false },
  {
    key: "descriptor",
    label: "Descriptor",
    multiline: true,
    rows: 1,
    hint: "Under the name on the home page's plate and the case study; over the title on its share image. The search palette, the tour, the console, llms.txt and the assistant read it too, and search engines when the hook and search description are empty.",
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
  {
    key: "role",
    label: "Your role",
    multiline: true,
    rows: 1,
    hint: "e.g. Lead engineer · team of 4",
    maxLength: 160,
  },
];

const STORY_FIELDS: RichField[] = [
  { key: "problem", label: "Problem" },
  { key: "aiArchitecture", label: "AI architecture" },
  { key: "fullStackInfra", label: "Full-stack & infrastructure" },
];

/** The case study's reader aids (plan 3, W8): its page shows each only when it is set. */
const AID_FIELDS: PlainField[] = [
  {
    key: "summaryPlain",
    label: "Plain summary",
    multiline: true,
    rows: 3,
    hint: "“In short” at the top of the case study, for any reader: plain words, at most 80.",
    maxLength: 1000,
    ai: false,
    copilot: { request: { task: "summary", level: "plain" }, name: "plain summary" },
  },
  {
    key: "summaryExpert",
    label: "Summary for experts",
    multiline: true,
    rows: 3,
    hint: "Folded under “In depth”, for engineers: at most 80 words.",
    maxLength: 1000,
    ai: false,
    copilot: { request: { task: "summary", level: "expert" }, name: "summary for experts" },
  },
  {
    key: "glossary",
    label: "Glossary",
    multiline: true,
    rows: 5,
    hint: "“Terms used here”, after the narrative: one a line, as Term: definition. At most 8.",
    ai: false,
    copilot: { request: { task: "glossary" }, name: "glossary" },
  },
];

const SEARCH_FIELDS: PlainField[] = [
  {
    key: "seoDescription",
    label: "Search description",
    multiline: true,
    rows: 2,
    hint: "For the case-study page; the hook is used when empty. About 150 characters.",
    maxLength: 300,
    ai: false,
    copilot: { request: { task: "seo", maxLength: 155 }, name: "search description" },
  },
];

const PLAIN_FIELDS = [CATEGORY_LABEL, ...CARD_FIELDS, ...AID_FIELDS, ...SEARCH_FIELDS];
/** The fields with a Suggest: their drafts are judged when the project is saved. */
const COPILOT_FIELDS = PLAIN_FIELDS.filter((field) => field.copilot);
const LOCALES: Locale[] = ["en", "de"];
const LANGUAGE: Record<Locale, string> = { en: "English", de: "German" };

type LinkKey = "linkLive" | "linkRepo" | "linkCaseStudy";
type DetailKey = "slug" | "category" | "periodStart" | "periodEnd" | LinkKey;

interface DetailField {
  key: DetailKey;
  label: string;
  type?: "date" | "url";
  placeholder?: string;
  hint?: string;
  maxLength?: number;
}

const DETAIL_FIELDS: DetailField[] = [
  { key: "slug", label: "Slug", maxLength: 80 },
  { key: "category", label: "Category key", placeholder: "ai-platform", maxLength: 40 },
  { key: "periodStart", label: "Started", type: "date" },
  { key: "periodEnd", label: "Ended", type: "date", hint: "Empty = ongoing." },
  { key: "linkLive", label: "Live URL", type: "url", maxLength: 500 },
  { key: "linkRepo", label: "Repository URL", type: "url", maxLength: 500 },
  { key: "linkCaseStudy", label: "External case study URL", type: "url", maxLength: 500 },
];

type Section =
  "details" | "card" | "cover" | "results" | "story" | "case-study" | "search" | "gallery";

/**
 * Each traced field (plan 5, U13): how to read it, and where the review shows it in the draft: its
 * path under `projects[slug]` in the core content, or its value in the case study's doc.
 */
interface Traced {
  key: string;
  section: Section;
  read: (p: ProjectRow) => unknown;
  path?: string;
  doc?: (d: ProjectDoc) => unknown;
}

const both =
  (key: keyof ProjectTranslation) =>
  (p: ProjectRow): unknown =>
    LOCALES.map((locale) => p.translations[locale][key]);

const TRACED: Traced[] = [
  { key: "slug", section: "details", read: (p) => p.slug, path: "slug" },
  { key: "category", section: "details", read: (p) => p.category, path: "category" },
  { key: "periodStart", section: "details", read: (p) => p.periodStart, path: "period" },
  { key: "periodEnd", section: "details", read: (p) => p.periodEnd, path: "period" },
  { key: "linkLive", section: "details", read: (p) => p.linkLive, path: "links.live" },
  { key: "linkRepo", section: "details", read: (p) => p.linkRepo, path: "links.repo" },
  {
    key: "linkCaseStudy",
    section: "details",
    read: (p) => p.linkCaseStudy,
    path: "links.caseStudy",
  },
  { key: "featured", section: "details", read: (p) => p.featured, path: "featured" },
  {
    key: "categoryLabel",
    section: "details",
    read: both("categoryLabel"),
    path: "category.label",
  },
  { key: "stack", section: "details", read: (p) => p.stack, path: "stack" },
  { key: "tags", section: "details", read: (p) => p.tags, path: "tags" },
  ...(["name", "descriptor", "hook", "role"] as const).map((key): Traced => ({
    key,
    section: "card",
    read: both(key),
    path: key,
  })),
  { key: "coverId", section: "cover", read: (p) => p.coverId, path: "cover" },
  { key: "metrics", section: "results", read: both("metrics"), path: "metrics" },
  ...(["problem", "aiArchitecture", "fullStackInfra", "outcomes"] as const).map((key): Traced => ({
    key,
    section: "story",
    read: both(key),
    path: key,
  })),
  { key: "body", section: "case-study", read: both("body"), doc: (d) => d.body },
  {
    key: "summaryPlain",
    section: "case-study",
    read: both("summaryPlain"),
    doc: (d) => d.summaries?.plain,
  },
  {
    key: "summaryExpert",
    section: "case-study",
    read: both("summaryExpert"),
    doc: (d) => d.summaries?.expert,
  },
  { key: "glossary", section: "case-study", read: both("glossary"), doc: (d) => d.glossary },
  {
    key: "seoDescription",
    section: "search",
    read: both("seoDescription"),
    doc: (d) => d.seo.description,
  },
  {
    key: "gallery",
    section: "gallery",
    read: (p) => p.gallery.map(({ mediaId, caption }) => ({ mediaId, caption })),
    doc: (d) => d.gallery,
  },
];

function stateOf(unsaved: boolean, draft: boolean): TraceState {
  if (unsaved) return "unsaved";
  return draft ? "draft" : "live";
}

function filledMetrics(metrics: MetricInput[]): MetricInput[] {
  return metrics.filter((m) => m.value.trim() !== "" && m.label.trim() !== "");
}

/** A case study's field is in the draft when its doc's value differs from the live one, in either language. */
function docInDraft(marks: DraftMarks | null, slug: string, read: (d: ProjectDoc) => unknown) {
  const pick = (doc: Doc | null) => (doc?.kind === "project" ? read(doc) : undefined);
  return LOCALES.some((locale) => {
    const change = marks?.docs?.[locale]?.find((d) => d.key === `project:${slug}`);
    return !!change && JSON.stringify(pick(change.draft)) !== JSON.stringify(pick(change.live));
  });
}

export const routeMeta: RouteMeta = { canDeactivate: [unsavedChangesGuard] };

/**
 * The project editor (plan 5, U13) on Part G's pieces: the sticky header (Save, Ctrl/⌘ S, ⋯ with
 * Discard), the bilingual field with its trace, the outline with a dot per section, the language
 * switch remembered per editor. The case study's two bodies stand side by side from 1280 px.
 */
@Component({
  selector: "app-admin-project-editor",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    BilingualFieldComponent,
    CopilotSuggestComponent,
    EditorHeaderComponent,
    EditorLayoutComponent,
    FieldIssueComponent,
    FormSkeletonComponent,
    FormsModule,
    GalleryEditorComponent,
    HlmBadge,
    HlmButton,
    HlmFieldLabel,
    HlmInput,
    HlmSwitch,
    LivePreviewToggleComponent,
    LoadErrorComponent,
    LocaleToggleComponent,
    MediaFieldComponent,
    MetricsEditorComponent,
    NgIcon,
    NgTemplateOutlet,
    NotFoundStateComponent,
    RichTextComponent,
    StringListComponent,
    TokenFieldComponent,
  ],
  viewProviders: [provideIcons({ lucideExternalLink })],
  host: { class: "block" },
  template: `
    <app-editor-layout
      anchor="projects"
      [compose]="livePreview()"
      [focus]="previewFocus()"
      [focusKey]="project()?.id ?? null"
      [note]="previewNote()"
      [outline]="outline()"
      [view]="shownView()"
    >
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
          @if (project()?.isVisible === false) {
            <span hlmBadge variant="outline">Hidden</span>
          }
          <app-locale-toggle
            class="max-md:order-first"
            [view]="shownView()"
            [both]="wide()"
            (viewChange)="choose($event)"
          />
          @if (casePreview(); as href) {
            <a
              hlmBtn
              variant="ghost"
              size="sm"
              class="max-md:hidden"
              target="_blank"
              rel="noopener"
              [href]="href"
              >Case study draft
              <ng-icon name="lucideExternalLink" size="14" class="ml-1.5" aria-hidden="true"
            /></a>
          }
          <app-live-preview-toggle />
        </app-editor-header>

        @if (loading()) {
          <app-form-skeleton [rows]="8" />
        } @else if (loadError(); as reason) {
          <app-load-error title="Could not load the project" [reason]="reason" (retry)="reload()" />
        } @else if (!project()) {
          <app-not-found-state what="project" back="/admin/projects" backLabel="All projects" />
        } @else if (project(); as p) {
          <div class="flex flex-col gap-10">
            <section id="details" aria-labelledby="details-title" class="flex flex-col gap-6">
              <h2 id="details-title" class="m-0 text-section-title">Details</h2>
              <div class="grid gap-x-4 gap-y-6 sm:grid-cols-2">
                @for (field of detailFields; track field.key) {
                  <div
                    class="change-trace flex min-w-0 flex-col gap-1.5"
                    [attr.data-change]="mark(field.key)"
                  >
                    <label hlmFieldLabel [for]="field.key">{{ field.label }}</label>
                    @if (field.hint) {
                      <p [id]="field.key + '-hint'" class="m-0 text-hint text-muted-foreground">
                        {{ field.hint }}
                      </p>
                    }
                    <input
                      hlmInput
                      autocomplete="off"
                      [id]="field.key"
                      [type]="field.type ?? 'text'"
                      [placeholder]="field.placeholder ?? ''"
                      [attr.maxlength]="field.maxLength ?? null"
                      [attr.spellcheck]="field.type ? null : 'false'"
                      [attr.translate]="field.key === 'slug' ? 'no' : null"
                      [ngModel]="detailOf(field.key)"
                      (ngModelChange)="patchDetail(field.key, $event)"
                      [attr.aria-invalid]="issues.get(field.key) ? true : null"
                      [aria-describedby]="describedBy(field.key, field.hint)"
                    />
                    <span [id]="field.key + '-state'" class="sr-only">{{ words(field.key) }}</span>
                    <app-field-issue
                      [id]="field.key + '-issue'"
                      [message]="issues.get(field.key)"
                    />
                  </div>
                }
                <div
                  class="change-trace flex items-center self-end"
                  [attr.data-change]="mark('featured')"
                >
                  <label class="flex min-h-9 items-center gap-3 text-sm font-medium">
                    <hlm-switch
                      [checked]="p.featured"
                      (checkedChange)="patch({ featured: $event })"
                      [aria-describedby]="mark('featured') ? 'featured-state' : null"
                    />
                    <span>Featured on the home page</span>
                  </label>
                  <span id="featured-state" class="sr-only">{{ words("featured") }}</span>
                </div>
              </div>
              <ng-container *ngTemplateOutlet="heads" />
              <ng-container *ngTemplateOutlet="plain; context: { $implicit: categoryLabel }" />
              <app-token-field
                [id]="'stack'"
                label="Tech stack"
                singular="technology"
                [max]="40"
                [value]="p.stack"
                [issue]="issues.under('stack')"
                [state]="trace()['stack'] ?? 'live'"
                (valueChange)="patch({ stack: $event })"
              />
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

            <section id="card" aria-labelledby="card-title" class="flex flex-col gap-6">
              <div>
                <h2 id="card-title" class="m-0 text-section-title">On the card</h2>
                <p class="m-0 mt-1 text-hint text-muted-foreground">
                  What the home page's card shows, and the top of the case study.
                </p>
              </div>
              <ng-container *ngTemplateOutlet="heads" />
              @for (field of cardFields; track field.key) {
                <ng-container *ngTemplateOutlet="plain; context: { $implicit: field }" />
              }
            </section>

            <section id="cover" aria-labelledby="cover-title" class="flex flex-col gap-4">
              <h2 id="cover-title" class="m-0 text-section-title">Cover</h2>
              <div class="change-trace" [attr.data-change]="mark('coverId')">
                <app-media-field
                  id="cover-image"
                  label="Cover image"
                  [hint]="coverHint()"
                  [path]="p.coverPath"
                  (chosen)="chooseCover($event)"
                />
              </div>
            </section>

            <section id="results" aria-labelledby="results-title" class="flex flex-col gap-4">
              <h2 id="results-title" class="m-0 text-section-title">Results</h2>
              <div class="change-trace" [attr.data-change]="mark('metrics')">
                <app-metrics-editor
                  [view]="shownView()"
                  [en]="p.translations.en.metrics"
                  [de]="p.translations.de.metrics"
                  (enChange)="patchTranslation('en', { metrics: $event })"
                  (deChange)="patchTranslation('de', { metrics: $event })"
                />
                @for (locale of locales(); track locale) {
                  <app-field-issue
                    [id]="'metrics-' + locale + '-issue'"
                    [message]="issues.under('translations.' + locale + '.metrics')"
                  />
                }
              </div>
            </section>

            <section id="story" aria-labelledby="story-title" class="flex flex-col gap-6">
              <h2 id="story-title" class="m-0 text-section-title">Story</h2>
              <ng-container *ngTemplateOutlet="heads" />
              @for (field of storyFields; track field.key) {
                <ng-container *ngTemplateOutlet="rich; context: { $implicit: field }" />
              }
              <div class="change-trace flex flex-col gap-1.5" [attr.data-change]="mark('outcomes')">
                <span class="text-sm font-medium">Outcomes</span>
                <span id="outcomes-state" class="sr-only">{{ words("outcomes") }}</span>
                <div [class]="columns()">
                  @for (locale of locales(); track locale) {
                    <div class="flex min-w-0 flex-col">
                      <app-string-list
                        [label]="language[locale] + ' outcomes'"
                        singular="outcome"
                        emptyText="No outcomes yet."
                        [max]="20"
                        [multiline]="true"
                        [lang]="locale"
                        [value]="p.translations[locale].outcomes"
                        (valueChange)="patchTranslation(locale, { outcomes: $event })"
                      />
                      <app-field-issue
                        [id]="'outcomes-' + locale + '-issue'"
                        [message]="issues.under('translations.' + locale + '.outcomes')"
                      />
                    </div>
                  }
                </div>
              </div>
            </section>

            <section id="case-study" aria-labelledby="case-study-title" class="flex flex-col gap-6">
              <div>
                <h2 id="case-study-title" class="m-0 text-section-title">Case study</h2>
                <p class="m-0 mt-1 text-hint text-muted-foreground">
                  The long read at /work/{{ p.slug }}. Empty in a language: no case-study page in
                  that language.
                </p>
              </div>
              <div class="change-trace flex flex-col gap-1.5" [attr.data-change]="mark('body')">
                <span id="body-state" class="sr-only">{{ words("body") }}</span>
                <!-- Side by side from 1280 px, each about half the column; one above the other below it. -->
                <div [class]="shownView() === 'both' ? 'grid gap-4 xl:grid-cols-2' : 'grid gap-4'">
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
                        [ngModel]="p.translations[locale].body"
                        (ngModelChange)="patchText(locale, 'body', $event)"
                        [label]="'Case study ' + language[locale]"
                        [describedBy]="richDescribedBy('body', locale)"
                      />
                      <app-field-issue
                        [id]="'body-' + locale + '-issue'"
                        [message]="textIssue(locale, 'body')"
                      />
                    </div>
                  }
                </div>
              </div>
              <ng-container *ngTemplateOutlet="heads" />
              @for (field of aidFields; track field.key) {
                <ng-container *ngTemplateOutlet="plain; context: { $implicit: field }" />
              }
            </section>

            <section id="search" aria-labelledby="search-title" class="flex flex-col gap-6">
              <h2 id="search-title" class="m-0 text-section-title">Search</h2>
              <ng-container *ngTemplateOutlet="heads" />
              @for (field of searchFields; track field.key) {
                <ng-container *ngTemplateOutlet="plain; context: { $implicit: field }" />
              }
            </section>

            <section id="gallery" aria-labelledby="gallery-title" class="flex flex-col gap-4">
              <h2 id="gallery-title" class="m-0 text-section-title">Gallery</h2>
              <div class="change-trace" [attr.data-change]="mark('gallery')">
                <span id="gallery-state" class="sr-only">{{ words("gallery") }}</span>
                <app-gallery-editor
                  [view]="shownView()"
                  [value]="gallery()"
                  (valueChange)="patchGallery($event)"
                />
                <app-field-issue id="gallery-issue" [message]="issues.under('gallery')" />
              </div>
            </section>
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
        [id]="field.key"
        [label]="field.label"
        [hint]="field.hint ?? ''"
        [multiline]="field.multiline ?? false"
        [rows]="field.rows ?? 2"
        [maxLength]="field.maxLength ?? 0"
        [ai]="field.ai ?? true"
        [view]="shownView()"
        [state]="trace()[field.key] ?? 'live'"
        [live]="liveCopy()[field.key] ?? null"
        [controlEn]="control(field.key, 'en')"
        [controlDe]="control(field.key, 'de')"
        [below]="field.copilot ? suggest : null"
      />
      <ng-template #suggest let-locale>
        <app-copilot-suggest
          class="self-end"
          [locale]="locale"
          [request]="field.copilot.request"
          [name]="field.copilot.name"
          [fieldId]="field.key + '-' + locale"
          [source]="sourceFor(locale)"
          [target]="copilotTarget(field.key, locale)"
          [current]="currentFor(field.key, locale)"
          (suggested)="control(field.key, locale).setValue($event)"
        />
      </ng-template>
    </ng-template>

    <!-- A rich text in each language shown: the bilingual field's anatomy around Tiptap. -->
    <ng-template #rich let-field>
      <div class="change-trace flex min-w-0 flex-col gap-1.5" [attr.data-change]="mark(field.key)">
        <span class="text-sm font-medium">{{ field.label }}</span>
        <span [id]="field.key + '-state'" class="sr-only">{{ words(field.key) }}</span>
        <div [class]="columns()">
          @for (locale of locales(); track locale) {
            <div class="flex min-w-0 flex-col gap-1">
              <app-rich-text
                [attr.lang]="locale"
                [ngModel]="textOf(locale, field.key)"
                (ngModelChange)="patchText(locale, field.key, $event)"
                [label]="field.label + ' ' + language[locale]"
                [describedBy]="richDescribedBy(field.key, locale)"
              />
              <app-field-issue
                [id]="field.key + '-' + locale + '-issue'"
                [message]="textIssue(locale, field.key)"
              />
            </div>
          }
        </div>
      </div>
    </ng-template>
  `,
})
export default class AdminProjectEditorPage implements OnInit {
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
  private readonly versions = new ChangedElsewhere(this.confirm, async () => {
    const id = this.project()?.id;
    const found = id ? await this.api.getProject(id) : null;
    return found?.ok ? [found.data.project] : null;
  });

  private readonly host = inject(ElementRef<HTMLElement>);
  private gone = false;

  protected readonly detailFields = DETAIL_FIELDS;
  protected readonly categoryLabel = CATEGORY_LABEL;
  protected readonly cardFields = CARD_FIELDS;
  protected readonly storyFields = STORY_FIELDS;
  protected readonly aidFields = AID_FIELDS;
  protected readonly searchFields = SEARCH_FIELDS;
  protected readonly language = LANGUAGE;

  protected readonly view = signal<LocaleView>(storedView("project") ?? "both");
  /** English and German side by side from 1024 px; one language below it. */
  protected readonly wide = computed(() => this.previewPanel?.wide() ?? true);
  protected readonly shownView = computed<LocaleView>(() =>
    this.view() === "both" && !this.wide() ? "en" : this.view(),
  );
  protected readonly locales = computed<Locale[]>(() => {
    const view = this.shownView();
    return view === "both" ? LOCALES : [view];
  });
  protected readonly columns = computed(() =>
    this.shownView() === "both" ? "grid gap-3 lg:grid-cols-2" : "grid gap-3",
  );

  /** The last save's problems, by the input's path (`translations.de.name`). */
  protected readonly issues = new FieldIssues();
  protected readonly loading = signal(true);
  /** The API's reason when the project did not arrive. */
  protected readonly loadError = signal<string | null>(null);
  protected readonly saving = signal(false);
  /** When this editor last saved, for the header's "Saved 14:02". */
  protected readonly savedAt = signal<number | null>(null);
  /** Per trace key, when this editor saved it: in the draft until a review asked after that arrives. */
  private readonly savedHere = signal<ReadonlyMap<string, number>>(new Map());

  protected readonly project = signal<ProjectRow | null>(null);
  private pristine: ProjectRow | null = null;
  private readonly revision = signal(0);

  /** The glossary as typed, one `term: definition` a line: the list it parses into is what is saved. */
  private readonly typedGlossary = signal<Record<Locale, string>>({ en: "", de: "" });

  /** One control per plain text and language, mirroring `project`: the bilingual field's. */
  private readonly controls = Object.fromEntries(
    PLAIN_FIELDS.map(({ key }) => [
      key,
      {
        en: new FormControl("", { nonNullable: true }),
        de: new FormControl("", { nonNullable: true }),
      },
    ]),
  ) as Record<PlainKey, Record<Locale, FormControl<string>>>;

  protected readonly title = computed(
    () =>
      this.project()?.translations.en.name ||
      this.project()?.slug ||
      this.route.snapshot.paramMap.get("slug") ||
      "Project",
  );

  /** The saved case study's draft page, when it has one: what the old page header's Preview opened. */
  protected readonly casePreview = computed(() => {
    this.revision();
    const saved = this.pristine;
    return saved && (saved.translations.en.body || saved.translations.de.body)
      ? `/admin/preview/en/work/${encodeURIComponent(saved.slug)}`
      : null;
  });

  /** What the copilot drafts from, for every Suggest: the page's text in that language. */
  protected readonly pageSources: Record<Locale, () => string> = {
    en: () => this.pageText("en"),
    de: () => this.pageText("de"),
  };

  /** A field's name in the copilot's ledger, with its project. */
  protected copilotTarget(key: PlainKey, locale: Locale, id = this.project()?.id ?? ""): string {
    return `project:${id}:${key}:${locale}`;
  }

  /** Each Suggest's field as it reads now: what its draft is judged by when the project is saved. */
  private readonly current: Record<string, Record<Locale, () => string>> = Object.fromEntries(
    COPILOT_FIELDS.map(({ key }) => [
      key,
      { en: () => this.textOf("en", key), de: () => this.textOf("de", key) },
    ]),
  );

  /** For the Suggest's template, whose `let-locale` is untyped. */
  protected sourceFor(locale: Locale): () => string {
    return this.pageSources[locale];
  }

  protected currentFor(key: PlainKey, locale: Locale): () => string {
    return this.current[key]![locale];
  }

  private pageText(locale: Locale): string {
    const t = this.project()?.translations[locale];
    if (!t) return "";
    return [t.name, t.descriptor, t.hook, t.problem, t.aiArchitecture, t.fullStackInfra, t.body]
      .filter(Boolean)
      .join("\n");
  }

  protected readonly dirty = computed(() => {
    this.revision();
    const current = this.project();
    return current !== null && JSON.stringify(current) !== JSON.stringify(this.pristine);
  });

  /** The cover's path follows its id: one field. */
  protected readonly changes = computed(() => {
    this.revision();
    return countChangedFields(this.pristine, this.project(), ["coverPath"]);
  });

  /** Each traced field's state, by its key: unsaved here, in the draft, or live. */
  protected readonly trace = computed<Record<string, TraceState>>(() => {
    this.revision();
    const now = this.project();
    const base = this.pristine;
    if (!now || !base) return {};
    const marks = this.pulse?.marks() ?? null;
    const saved = this.savedHere();
    const typed = this.typedGlossary();
    const out: Record<string, TraceState> = {};
    for (const { key, read, path, doc } of TRACED) {
      const unsaved =
        key === "glossary"
          ? LOCALES.some((l) => typed[l] !== glossaryText(base.translations[l].glossary))
          : JSON.stringify(read(now)) !== JSON.stringify(read(base));
      const inReview = path
        ? inDraft(marks, `projects[${base.slug}].${path}`)
        : docInDraft(marks, base.slug, doc!);
      // Saved here after the review was asked: in the draft, though the review cannot say so yet.
      const draft = inReview || (saved.get(key) ?? 0) > (marks?.asked ?? 0);
      out[key] = stateOf(unsaved, draft);
    }
    return out;
  });

  /** Fields saved to the draft and not live; null until the review or a save here says. */
  protected readonly notLive = computed(() => {
    if (!this.pulse?.marks() && this.savedHere().size === 0) return null;
    return Object.values(this.trace()).filter((state) => state === "draft").length;
  });

  /** The live site's text of the card's fields, for the German's notes. */
  protected readonly liveCopy = computed(() => {
    const marks = this.pulse?.marks() ?? null;
    const slug = this.pristine?.slug;
    this.revision();
    const at = (locale: Locale, key: string) => {
      const live = marks?.live[locale]?.projects?.find((p) => p.slug === slug);
      return (live as Record<string, unknown> | undefined)?.[key];
    };
    return Object.fromEntries(
      (["name", "descriptor", "hook", "role"] as const).map((key) => {
        const [en, de] = [at("en", key), at("de", key)];
        return [key, typeof en === "string" && typeof de === "string" ? { en, de } : null];
      }),
    );
  });

  /** The sections for the rail: how far along each is, its trace, and the last save's problems in it. */
  protected readonly outline = computed<OutlineItem[]>(() => {
    const p = this.project();
    if (!p) return [];
    const trace = this.trace();
    const problems = this.issues.entries().map(([path]) => path);
    return projectOutline(p, problems).map((item) => ({
      ...item,
      change: rollUp(
        TRACED.filter((t) => t.section === item.id).map((t) => trace[t.key] ?? "live"),
      ),
    }));
  });

  /** The card as the home page would show it with these edits (and the rest of the draft). */
  protected readonly livePreview = computed<LiveCompose | null>(() => {
    this.revision();
    const row = this.project();
    const saved = this.pristine;
    if (!row || !saved) return null;
    return (base, locale, media) =>
      withProject(base, locale, row, { slug: saved.slug, coverId: saved.coverId }, media);
  });

  /** The card to bring into view: its name in each language. */
  protected readonly previewFocus = computed(() => {
    const p = this.project();
    return p ? { en: p.translations.en.name, de: p.translations.de.name } : null;
  });

  protected readonly previewNote = computed(() =>
    this.project()?.isVisible === false
      ? "Hidden on the site: shown here at the end of the list so you can check it."
      : null,
  );

  protected readonly gallery = computed<GalleryItem[]>(() => this.project()?.gallery ?? []);

  /** The cover's hint, with its trace's words: a media slot has no description of its own. */
  protected readonly coverHint = computed(() => {
    const words = this.words("coverId");
    return [
      "Shown on the card and at the top of the case study. Without one, the card has no picture.",
      words && `${words}.`,
    ]
      .filter(Boolean)
      .join(" ");
  });

  constructor() {
    effect(() => this.unsaved.set("project", this.dirty()));
    inject(DestroyRef).onDestroy(() => {
      this.gone = true;
      this.unsaved.clear("project");
      // Leaving unsaved: the copilot's drafts were not kept.
      this.ledger.abandonPrefix("project:");
    });
    // A field's text, typed or put there by its ⋯, goes into the project like any edit.
    for (const { key } of PLAIN_FIELDS) {
      for (const locale of LOCALES) {
        this.controls[key][locale].valueChanges.subscribe((text) => {
          if (text !== this.textOf(locale, key)) this.patchText(locale, key, text);
        });
      }
    }
    // The glossary as typed goes too: a line that does not parse yet is still text.
    inject(RecoveryService).track<ProjectRow & { typedGlossary: Record<Locale, string> }>({
      editor: "project",
      item: () => this.project()?.id ?? null,
      saved: () => {
        this.revision();
        const row = this.pristine;
        if (!row) return null;
        const typedGlossary = {
          en: glossaryText(row.translations.en.glossary),
          de: glossaryText(row.translations.de.glossary),
        };
        return { ...row, typedGlossary };
      },
      current: () => {
        const row = this.project();
        return row ? { ...row, typedGlossary: this.typedGlossary() } : null;
      },
      restore: ({ typedGlossary, ...row }) => {
        this.project.set(row);
        this.typedGlossary.set(typedGlossary);
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
    storeView("project", view);
  }

  protected control(key: PlainKey, locale: Locale): FormControl<string> {
    return this.controls[key][locale];
  }

  protected reload(): void {
    this.loading.set(true);
    void this.load();
  }

  private async load(): Promise<void> {
    // A draft left by an earlier editor (a save that failed after it closed) was not kept.
    this.ledger.abandonPrefix("project:");
    const slug = this.route.snapshot.paramMap.get("slug");
    const list = await this.api.listProjects();
    const id = list.ok ? list.data.projects.find((p) => p.slug === slug)?.id : undefined;
    const result = id ? await this.api.getProject(id) : null;
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

    const found = result?.ok ? result.data.project : null;
    this.project.set(found ? structuredClone(found) : null);
    this.pristine = found ? structuredClone(found) : null;
    if (found) this.versions.remember([found]);
    this.showGlossary(found);
    this.revision.update((v) => v + 1);
    this.fill(true);
  }

  /** The controls take the project's text: after a load, a discard or a recovery copy. */
  private fill(fresh = false): void {
    for (const { key } of PLAIN_FIELDS) {
      for (const locale of LOCALES) {
        const control = this.controls[key][locale];
        const text = this.textOf(locale, key);
        // A reset abandons the field's own drafts and its Undo: only where the text moved, or on a load.
        if (fresh || control.value !== text) control.reset(text);
      }
    }
  }

  private showGlossary(row: ProjectRow | null): void {
    this.typedGlossary.set({
      en: glossaryText(row?.translations.en.glossary ?? []),
      de: glossaryText(row?.translations.de.glossary ?? []),
    });
  }

  protected mark(key: string): TraceState | null {
    const state = this.trace()[key] ?? "live";
    return state === "live" ? null : state;
  }

  protected words(key: string): string {
    return TRACE_WORDS[this.trace()[key] ?? "live"];
  }

  /** A one-language field's description: its save problem, its trace's words, its hint. */
  protected describedBy(key: string, hint?: string): string | null {
    const ids = [
      this.issues.get(key) ? `${key}-issue` : null,
      this.mark(key) ? `${key}-state` : null,
      hint ? `${key}-hint` : null,
    ].filter(Boolean);
    return ids.length ? ids.join(" ") : null;
  }

  /** A rich text's description: its save problem, then its trace's words. */
  protected richDescribedBy(key: string, locale: Locale): string | null {
    const ids = [
      this.textIssue(locale, key) ? `${key}-${locale}-issue` : null,
      this.mark(key) ? `${key}-state` : null,
    ].filter(Boolean);
    return ids.length ? ids.join(" ") : null;
  }

  protected detailOf(key: DetailKey): string {
    return this.project()?.[key] ?? "";
  }

  protected patchDetail(key: DetailKey, value: string): void {
    const dates = key === "periodStart" || key === "periodEnd";
    this.patch({ [key]: dates ? value || null : value } as Partial<ProjectRow>);
  }

  protected chooseCover(asset: MediaAsset | null): void {
    this.patch({ coverId: asset?.id ?? null, coverPath: asset?.path ?? null });
  }

  protected patch(change: Partial<ProjectRow>): void {
    this.project.update((p) => (p ? { ...p, ...change } : p));
    this.revision.update((v) => v + 1);
    for (const key of Object.keys(change)) this.issues.resolve(key);
  }

  /** A text field's value in one language (the shared templates' `field` is untyped). */
  protected textOf(locale: Locale, key: PlainKey | RichKey | "body"): string {
    if (key === "glossary") return this.typedGlossary()[locale];
    return this.project()?.translations[locale][key] ?? "";
  }

  /** A field's save problem, or one of its items' (a glossary line's). */
  protected textIssue(locale: Locale, key: string): string | null {
    return this.issues.under(`translations.${locale}.${key}`);
  }

  protected patchGallery(gallery: GalleryItem[]): void {
    this.patch({ gallery });
  }

  /** Angular templates cannot express a computed property key, so the field
   * name arrives as its own argument. */
  protected patchText(locale: Locale, key: PlainKey | RichKey | "body", value: string): void {
    if (key === "glossary") {
      this.typedGlossary.update((text) => ({ ...text, [locale]: value }));
      this.patchTranslation(locale, { glossary: parseGlossary(value) });
      return;
    }
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
    for (const key of Object.keys(change)) this.issues.resolve(`translations.${locale}.${key}`);
  }

  protected discard(): void {
    const edits = this.project();
    const typed = this.typedGlossary();
    toastDiscarded(() => {
      this.project.set(edits);
      this.typedGlossary.set(typed);
      this.revision.update((v) => v + 1);
      this.fill();
    });
    this.project.set(this.pristine ? structuredClone(this.pristine) : null);
    this.showGlossary(this.pristine);
    this.revision.update((v) => v + 1);
    this.issues.clear();
    this.fill();
    // Thrown away with the other unsaved edits: the copilot's drafts were not kept.
    this.ledger.abandonPrefix("project:");
  }

  protected async save(): Promise<void> {
    const current = this.project();
    if (!current || this.saving()) return;

    this.saving.set(true);
    const name = current.translations.en.name || current.slug;
    if (!(await this.versions.mayOverwrite([current.id], name))) {
      this.saving.set(false);
      return;
    }
    // The copilot's drafts are judged by what this save sends (plan phase 27).
    const ended = this.ledger.beginSave(
      Object.fromEntries(
        COPILOT_FIELDS.flatMap(({ key }) =>
          LOCALES.map((l) => [this.copilotTarget(key, l, current.id), this.textOf(l, key)]),
        ),
      ),
    );
    const result = await this.api.updateProject(current.id, {
      slug: current.slug,
      coverId: current.coverId,
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
    if (result.ok) await this.versions.refresh();
    this.saving.set(false);
    ended(result.ok);
    if (this.gone) return;
    if (result.ok) this.saved(current);
    else this.refused(result.error, result.issues ?? []);
  }

  /** A refused save: its problems on their fields, the first focused, in the language that shows them. */
  private refused(error: string, issues: readonly ApiIssue[]): void {
    if (error === "duplicate_slug") {
      this.issues.add("slug", "Another project already uses this slug");
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
        this.placeIssues();
        focusFirstInvalid(this.host.nativeElement);
      },
      { injector: this.injector },
    );
  }

  /** A save that landed: the new saved state, its fields marked saved here, the header told when. */
  private saved(current: ProjectRow): void {
    const slugChanged = this.pristine?.slug !== current.slug;
    const before = this.trace();
    this.pristine = structuredClone(current);
    const at = Date.now();
    this.savedHere.update((map) => {
      const next = new Map(map);
      for (const [key, state] of Object.entries(before)) if (state === "unsaved") next.set(key, at);
      return next;
    });
    this.revision.update((v) => v + 1);
    this.issues.clear();
    for (const { key } of PLAIN_FIELDS) {
      for (const locale of LOCALES) this.controls[key][locale].markAsPristine();
    }
    this.savedAt.set(at);

    // The route is keyed by slug, so keep the URL in step after a rename.
    if (slugChanged) {
      void this.router.navigate(["/admin/projects", current.slug], { replaceUrl: true });
    }
  }

  /** The save's problems on the plain texts' controls, where the bilingual field shows them. */
  private placeIssues(): void {
    for (const { key } of PLAIN_FIELDS) {
      for (const locale of LOCALES) {
        const message = this.textIssue(locale, key);
        if (message) this.controls[key][locale].setErrors({ server: message });
      }
    }
  }
}
