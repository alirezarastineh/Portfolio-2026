import {
  CdkDrag,
  type CdkDragDrop,
  CdkDragHandle,
  CdkDropList,
  moveItemInArray,
} from "@angular/cdk/drag-drop";
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
  untracked,
} from "@angular/core";
import { toSignal } from "@angular/core/rxjs-interop";
import type { RouteMeta } from "@analogjs/router";
import { FormControl, FormsModule } from "@angular/forms";
import { ActivatedRoute, Router, RouterLink } from "@angular/router";
import { NgIcon, provideIcons } from "@ng-icons/core";
import {
  lucideEllipsis,
  lucideEye,
  lucideEyeOff,
  lucideGripVertical,
  lucidePencil,
  lucidePlus,
  lucideTrash2,
} from "@ng-icons/lucide";
import { toast } from "@spartan-ng/brain/sonner";
import { HlmBadge } from "@spartan-ng/helm/badge";
import { HlmButton } from "@spartan-ng/helm/button";
import { HlmDropdownMenuImports } from "@spartan-ng/helm/dropdown-menu";
import { HlmFieldLabel } from "@spartan-ng/helm/field";
import { HlmInput } from "@spartan-ng/helm/input";
import { HlmSwitch } from "@spartan-ng/helm/switch";
import { HlmTableImports } from "@spartan-ng/helm/table";
import { map } from "rxjs";

import {
  AdminApiService,
  type ApiIssue,
  type ApiResult,
  type ExperienceInput,
  type ExperienceRow,
  type MediaAsset,
} from "../../admin/admin-api.service";
import { ChangedElsewhere } from "../../admin/changed-elsewhere";
import { countChangedFields } from "../../admin/changed-fields";
import { inDraft, rollUp, stateOf, TRACE_WORDS, type TraceState } from "../../admin/change-trace";
import { BilingualFieldComponent } from "../../admin/components/bilingual-field.component";
import { ConfirmService } from "../../admin/components/confirm-dialog.component";
import {
  FieldIssueComponent,
  LocaleToggleComponent,
} from "../../admin/components/editor-chrome.component";
import { EditorHeaderComponent } from "../../admin/components/editor-header.component";
import { EditorLayoutComponent } from "../../admin/components/editor-layout.component";
import type { LocaleView } from "../../admin/components/field-pair.component";
import {
  FormSkeletonComponent,
  LoadErrorComponent,
  NotFoundStateComponent,
} from "../../admin/components/load-state.component";
import { MediaFieldComponent } from "../../admin/components/media-field.component";
import { AdminPageHeaderComponent } from "../../admin/components/page-header.component";
import { StringListComponent } from "../../admin/components/string-list.component";
import { TokenFieldComponent } from "../../admin/components/token-field.component";
import { problemsUnder, type OutlineItem } from "../../admin/editor-outline";
import { FieldIssues, focusFirstInvalid } from "../../admin/issues";
import { storedView, storeView } from "../../admin/language-view";
import { withExperiences, type LiveCompose } from "../../admin/preview/live-content";
import { LivePreviewService } from "../../admin/preview/live-preview.service";
import { LivePreviewToggleComponent } from "../../admin/preview/live-preview-toggle.component";
import { AdminPulseService } from "../../admin/pulse.service";
import { RecoveryService, type RecoveryHandle } from "../../admin/recovery.service";
import { toastDiscarded, toastIssues, toastNotSaved } from "../../admin/save-feedback";
import { UnsavedChangesService, unsavedChangesGuard } from "../../admin/unsaved-changes.service";
import { isLocale } from "../../content/locale";
import type { Locale } from "../../content/schema";

export const routeMeta: RouteMeta = { canDeactivate: [unsavedChangesGuard] };

const KINDS: { value: ExperienceInput["kind"]; label: string }[] = [
  { value: "work", label: "Work" },
  { value: "education", label: "Education" },
  { value: "certification", label: "Certification" },
];

const EMPLOYMENT: { value: ExperienceInput["employmentType"]; label: string }[] = [
  { value: "", label: "Not said" },
  { value: "full-time", label: "Full-time" },
  { value: "part-time", label: "Part-time" },
  { value: "contract", label: "Contract" },
  { value: "freelance", label: "Freelance" },
  { value: "internship", label: "Internship" },
];

const PRECISION: { value: ExperienceInput["datePrecision"]; label: string }[] = [
  { value: "month", label: "Month and year" },
  { value: "year", label: "Year only" },
];

const LOCALES: Locale[] = ["en", "de"];
const LANGUAGE: Record<Locale, string> = { en: "English", de: "German" };

/**
 * What the editor edits: the input plus, for an existing entry, its id and logo preview. The
 * recovery copy keeps this shape, the sheet's (plan 5, U14), so a copy typed there comes back.
 */
type Draft = ExperienceInput & { id: string | null; logoPath: string | null };

type DetailKey =
  | "kind"
  | "employmentType"
  | "orgName"
  | "orgUrl"
  | "startDate"
  | "endDate"
  | "datePrecision"
  | "location"
  | "credentialId"
  | "credentialUrl";

interface DetailField {
  key: DetailKey;
  /** The element's id, as the sheet had it. */
  id: string;
  label: string;
  type?: "date" | "url";
  hint?: string;
  maxLength?: number;
  options?: { value: string; label: string }[];
}

const DETAIL_FIELDS: DetailField[] = [
  { key: "kind", id: "exp-kind", label: "Kind", options: KINDS },
  { key: "employmentType", id: "exp-type", label: "Employment", options: EMPLOYMENT },
  { key: "orgName", id: "exp-org", label: "Organisation", maxLength: 160 },
  { key: "orgUrl", id: "exp-url", label: "Organisation URL", type: "url", maxLength: 500 },
  { key: "startDate", id: "exp-start", label: "Started", type: "date" },
  { key: "endDate", id: "exp-end", label: "Ended", type: "date", hint: "Empty = now." },
  { key: "datePrecision", id: "exp-precision", label: "Show dates as", options: PRECISION },
  { key: "location", id: "exp-location", label: "Location", maxLength: 160 },
  { key: "credentialId", id: "exp-cred-id", label: "Credential ID", maxLength: 200 },
  {
    key: "credentialUrl",
    id: "exp-cred-url",
    label: "Credential URL",
    type: "url",
    maxLength: 500,
  },
];

type Section = "details" | "logo" | "timeline";
type TextKey = "title" | "summary";

/** Each traced field: how to read it, and its path under `experiences[<id>]` in the review. */
const TRACED: { key: string; section: Section; read: (d: Draft) => unknown; path: string }[] = [
  ...(
    [
      ["kind", "kind"],
      ["employmentType", "employmentType"],
      ["orgName", "org.name"],
      ["orgUrl", "org.url"],
      ["startDate", "period.start"],
      ["endDate", "period.end"],
      ["datePrecision", "period.precision"],
      ["location", "location"],
      // The credential is one object on the site, null while both are empty.
      ["credentialId", "credential"],
      ["credentialUrl", "credential"],
      ["skills", "skills"],
    ] as const
  ).map(([key, path]) => ({
    key,
    section: "details" as const,
    read: (d: Draft) => d[key],
    path,
  })),
  { key: "logoId", section: "logo", read: (d) => d.logoId, path: "org.logo" },
  ...(["title", "summary", "highlights"] as const).map((key) => ({
    key,
    section: "timeline" as const,
    read: (d: Draft) => LOCALES.map((locale) => d.translations[locale][key]),
    path: key,
  })),
];

const SECTIONS: { id: Section; label: string; prefixes: string[] }[] = [
  {
    id: "details",
    label: "Details",
    prefixes: [...DETAIL_FIELDS.map((field) => field.key), "skills"],
  },
  { id: "logo", label: "Logo", prefixes: ["logoId"] },
  { id: "timeline", label: "On the timeline", prefixes: ["translations"] },
];

const MONTH = new Intl.DateTimeFormat("en-GB", {
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});
const YEAR = new Intl.DateTimeFormat("en-GB", { year: "numeric", timeZone: "UTC" });

/** "Mar 2024 – now", "2017 – 2019", "May 2023": by the entry's precision. */
function datesOf(row: ExperienceInput): string {
  const format = row.datePrecision === "year" ? YEAR : MONTH;
  const at = (iso: string) => format.format(new Date(`${iso}T00:00:00Z`));
  const from = at(row.startDate);
  const to = row.endDate ? at(row.endDate) : "now";
  return from === to ? from : `${from} – ${to}`;
}

/** "Staff engineer at Acme": how the list, its switch, its ⋯ and the editor name an entry. */
function nameOf(row: ExperienceInput): string {
  const title = row.translations.en.title.trim() || row.translations.de.title.trim();
  return [title, row.orgName.trim()].filter(Boolean).join(" at ");
}

function blankDraft(): Draft {
  const translation = { title: "", summary: "", highlights: [] as string[] };
  return {
    id: null,
    kind: "work",
    orgName: "",
    orgUrl: "",
    logoId: null,
    logoPath: null,
    location: "",
    employmentType: "",
    startDate: new Date().toISOString().slice(0, 10),
    endDate: null,
    datePrecision: "month",
    credentialId: "",
    credentialUrl: "",
    skills: [],
    isVisible: true,
    translations: { en: { ...translation }, de: { ...translation } },
  };
}

/** What a save sends: the editor's fields trimmed, blank list rows left out. */
function inputOf(d: Draft): ExperienceInput {
  const highlights = (locale: Locale) =>
    d.translations[locale].highlights.filter((h) => h.trim() !== "");
  return {
    kind: d.kind,
    orgName: d.orgName.trim(),
    orgUrl: d.orgUrl.trim(),
    logoId: d.logoId,
    location: d.location.trim(),
    employmentType: d.employmentType,
    startDate: d.startDate,
    endDate: d.endDate,
    datePrecision: d.datePrecision,
    credentialId: d.credentialId.trim(),
    credentialUrl: d.credentialUrl.trim(),
    skills: d.skills.filter((s) => s.trim() !== ""),
    isVisible: d.isVisible,
    translations: {
      en: { ...d.translations.en, highlights: highlights("en") },
      de: { ...d.translations.de, highlights: highlights("de") },
    },
  };
}

/**
 * Experience (plan 5, U14): the timeline's entries as a table, in the home page's order, and an
 * entry's editor in the list's place at `?edit=<id>` (`new` for one not saved yet): no route of its
 * own, Back returns to the list, and the guard asks before an unsaved entry closes. The editor runs
 * Part G's pieces: the sticky header, the bilingual field with its trace, the outline.
 */
@Component({
  selector: "app-admin-experience",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    AdminPageHeaderComponent,
    BilingualFieldComponent,
    CdkDrag,
    CdkDragHandle,
    CdkDropList,
    EditorHeaderComponent,
    EditorLayoutComponent,
    FieldIssueComponent,
    FormSkeletonComponent,
    FormsModule,
    HlmBadge,
    HlmButton,
    HlmDropdownMenuImports,
    HlmFieldLabel,
    HlmInput,
    HlmSwitch,
    HlmTableImports,
    LivePreviewToggleComponent,
    LoadErrorComponent,
    LocaleToggleComponent,
    MediaFieldComponent,
    NgIcon,
    NotFoundStateComponent,
    RouterLink,
    StringListComponent,
    TokenFieldComponent,
  ],
  viewProviders: [
    provideIcons({
      lucideEllipsis,
      lucideEye,
      lucideEyeOff,
      lucideGripVertical,
      lucidePencil,
      lucidePlus,
      lucideTrash2,
    }),
  ],
  host: { class: "block" },
  template: `
    <app-editor-layout
      anchor="experience"
      [compose]="livePreview()"
      [focus]="entryFocus()"
      [focusKey]="draft() ? (draft()?.id ?? 'new') : null"
      [note]="previewNote()"
      [outline]="outline()"
      [view]="shownView()"
    >
      @if (draft(); as d) {
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
            @if (!d.isVisible) {
              <span hlmBadge variant="outline">Hidden</span>
            }
            <app-locale-toggle
              class="max-md:order-first"
              [view]="shownView()"
              [both]="wide()"
              (viewChange)="choose($event)"
            />
            <app-live-preview-toggle />
          </app-editor-header>

          <div class="flex flex-col gap-10">
            <section id="details" aria-labelledby="details-title" class="flex flex-col gap-6">
              <h2 id="details-title" class="m-0 text-section-title">Details</h2>
              <div class="grid gap-x-4 gap-y-6 sm:grid-cols-2">
                @for (field of detailFields; track field.key) {
                  <div
                    class="change-trace flex min-w-0 flex-col gap-1.5"
                    [attr.data-change]="mark(field.key)"
                  >
                    <label hlmFieldLabel [for]="field.id">{{ field.label }}</label>
                    @if (field.hint) {
                      <p [id]="field.id + '-hint'" class="m-0 text-hint text-muted-foreground">
                        {{ field.hint }}
                      </p>
                    }
                    @if (field.options; as options) {
                      <select
                        class="h-9 rounded-lg border border-input-line bg-card px-2 text-sm text-foreground pointer-coarse:h-11 pointer-coarse:text-base"
                        [id]="field.id"
                        [attr.aria-describedby]="describedBy(field)"
                        (change)="patchDetail(field.key, $any($event.target).value)"
                      >
                        @for (option of options; track option.value) {
                          <option
                            [value]="option.value"
                            [selected]="detailOf(field.key) === option.value"
                          >
                            {{ option.label }}
                          </option>
                        }
                      </select>
                    } @else {
                      <input
                        hlmInput
                        autocomplete="off"
                        [id]="field.id"
                        [type]="field.type ?? 'text'"
                        [attr.maxlength]="field.maxLength ?? null"
                        [ngModel]="detailOf(field.key)"
                        (ngModelChange)="patchDetail(field.key, $event)"
                        [attr.aria-invalid]="issues.get(field.key) ? true : null"
                        [aria-describedby]="describedBy(field)"
                      />
                    }
                    <span [id]="field.id + '-state'" class="sr-only">{{ words(field.key) }}</span>
                    <app-field-issue [id]="field.id + '-issue'" [message]="issues.get(field.key)" />
                  </div>
                }
              </div>
              <app-token-field
                [id]="'exp-skills'"
                label="Skills"
                singular="skill"
                [max]="30"
                [value]="d.skills"
                [issue]="issues.under('skills')"
                [state]="trace()['skills'] ?? 'live'"
                (valueChange)="patch({ skills: $event })"
              />
            </section>

            <section id="logo" aria-labelledby="logo-title" class="flex flex-col gap-4">
              <h2 id="logo-title" class="m-0 text-section-title">Logo</h2>
              <div class="change-trace" [attr.data-change]="mark('logoId')">
                <app-media-field
                  id="exp-logo"
                  label="Organisation logo"
                  [hint]="logoHint()"
                  [path]="d.logoPath"
                  (chosen)="chooseLogo($event)"
                />
              </div>
            </section>

            <section id="timeline" aria-labelledby="timeline-title" class="flex flex-col gap-6">
              <div>
                <h2 id="timeline-title" class="m-0 text-section-title">On the timeline</h2>
                <p class="m-0 mt-1 text-hint text-muted-foreground">
                  What the home page's timeline shows for this entry.
                </p>
              </div>
              @if (shownView() === "both") {
                <div
                  class="-mb-4 grid grid-cols-2 gap-3 text-hint text-muted-foreground max-lg:hidden"
                  aria-hidden="true"
                >
                  <span>English</span><span>German</span>
                </div>
              }
              <app-bilingual-field
                [id]="'exp-title'"
                label="Title"
                [maxLength]="200"
                [view]="shownView()"
                [state]="trace()['title'] ?? 'live'"
                [live]="liveCopy().title"
                [controlEn]="control('title', 'en')"
                [controlDe]="control('title', 'de')"
              />
              <app-bilingual-field
                [id]="'exp-summary'"
                label="Summary"
                [multiline]="true"
                [rows]="3"
                [maxLength]="2000"
                [view]="shownView()"
                [state]="trace()['summary'] ?? 'live'"
                [live]="liveCopy().summary"
                [controlEn]="control('summary', 'en')"
                [controlDe]="control('summary', 'de')"
              />
              <div
                class="change-trace flex flex-col gap-1.5"
                [attr.data-change]="mark('highlights')"
              >
                <span class="text-sm font-medium">Highlights</span>
                <span id="highlights-state" class="sr-only">{{ words("highlights") }}</span>
                <div [class]="columns()">
                  @for (locale of locales(); track locale) {
                    <div class="flex min-w-0 flex-col">
                      <app-string-list
                        [label]="language[locale] + ' highlights'"
                        singular="highlight"
                        emptyText="No highlights yet."
                        [max]="12"
                        [multiline]="true"
                        [lang]="locale"
                        [value]="d.translations[locale].highlights"
                        (valueChange)="patchText(locale, { highlights: $event })"
                      />
                      <app-field-issue
                        [id]="'highlights-' + locale + '-issue'"
                        [message]="issues.under('translations.' + locale + '.highlights')"
                      />
                    </div>
                  }
                </div>
              </div>
            </section>
          </div>
        </div>
      } @else {
        <div class="flex flex-col gap-6 pb-12">
          <app-page-header
            title="Experience"
            description="Work, education and certifications for the timeline. Drag to reorder: saved at once, and on the site after the next publish."
            preview="/admin/preview/en#experience"
          >
            <app-live-preview-toggle headerActions />
            <button headerActions hlmBtn variant="outline" type="button" data-add (click)="add()">
              <ng-icon name="lucidePlus" size="14" aria-hidden="true" />
              <span class="ml-1.5">Add entry</span>
            </button>
          </app-page-header>

          @if (loading()) {
            <app-form-skeleton kind="list" [rows]="4" label="Loading the timeline…" />
          } @else if (loadError(); as reason) {
            <app-load-error
              title="Could not load the timeline"
              [reason]="reason"
              (retry)="reload()"
            />
          } @else if (missing()) {
            <app-not-found-state what="entry" back="/admin/experience" backLabel="All entries" />
          } @else {
            <div hlmTableContainer>
              <table hlmTable>
                <caption class="sr-only">
                  Entries in the timeline's order
                </caption>
                <thead hlmTHead>
                  <tr hlmTr>
                    <th hlmTh scope="col" class="w-10"><span class="sr-only">Order</span></th>
                    <th hlmTh scope="col">Title and organisation</th>
                    <th hlmTh scope="col" class="max-sm:hidden">Kind</th>
                    <th hlmTh scope="col" class="max-sm:hidden">Dates</th>
                    <th hlmTh scope="col">Shown</th>
                    <th hlmTh scope="col" class="w-12"><span class="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody hlmTBody cdkDropList (cdkDropListDropped)="dropped($event)">
                  @for (row of rows(); track row.id; let i = $index) {
                    <tr
                      hlmTr
                      cdkDrag
                      cdkDragPreviewContainer="parent"
                      class="h-9 pointer-coarse:h-11"
                    >
                      <td hlmTd>
                        <button
                          cdkDragHandle
                          type="button"
                          data-grip
                          class="flex size-6 cursor-grab items-center justify-center rounded-sm text-muted-foreground hover:text-foreground active:cursor-grabbing pointer-coarse:size-11"
                          [attr.aria-label]="'Reorder ' + name(row) + '. Use Alt with arrow keys.'"
                          (keydown)="onGripKey($event, i)"
                        >
                          <ng-icon name="lucideGripVertical" size="16" aria-hidden="true" />
                        </button>
                      </td>
                      <td hlmTd class="whitespace-normal">
                        <a
                          class="font-medium wrap-anywhere text-foreground underline-offset-2 hover:underline"
                          routerLink="/admin/experience"
                          [queryParams]="{ edit: row.id }"
                          [attr.data-entry]="row.id"
                          >{{ titleOf(row) }}</a
                        >
                        <span class="block text-xs wrap-anywhere text-muted-foreground">{{
                          row.orgName
                        }}</span>
                        <span class="block text-data text-muted-foreground sm:hidden">{{
                          dates(row)
                        }}</span>
                      </td>
                      <td hlmTd class="max-sm:hidden">{{ kindOf(row) }}</td>
                      <td hlmTd class="text-data whitespace-nowrap max-sm:hidden">
                        {{ dates(row) }}
                      </td>
                      <td hlmTd>
                        <label class="flex items-center gap-2 text-xs text-muted-foreground">
                          <hlm-switch
                            [checked]="row.isVisible"
                            (checkedChange)="toggleVisible(row, $event)"
                          />
                          <span aria-hidden="true">{{ row.isVisible ? "Shown" : "Hidden" }}</span>
                          <span class="sr-only">Show {{ name(row) }} on the site</span>
                        </label>
                      </td>
                      <td hlmTd class="text-right">
                        <button
                          hlmBtn
                          variant="ghost"
                          size="icon-sm"
                          type="button"
                          class="text-muted-foreground pointer-coarse:size-11"
                          [hlmDropdownMenuTrigger]="rowMenu"
                          [hlmDropdownMenuTriggerData]="{ $implicit: row, index: i }"
                          [attr.aria-label]="'More actions for ' + name(row)"
                        >
                          <ng-icon name="lucideEllipsis" size="16" aria-hidden="true" />
                        </button>
                      </td>
                    </tr>
                  } @empty {
                    <tr hlmTr>
                      <td hlmTd colspan="6" class="py-6 text-hint text-muted-foreground">
                        No entries yet.
                        <button
                          hlmBtn
                          variant="link"
                          size="sm"
                          type="button"
                          class="px-1"
                          (click)="add()"
                        >
                          Add an entry
                        </button>
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>

            <ng-template #rowMenu let-row let-i="index">
              <hlm-dropdown-menu class="w-48">
                <button
                  hlmDropdownMenuItem
                  type="button"
                  routerLink="/admin/experience"
                  [queryParams]="{ edit: row.id }"
                >
                  <ng-icon name="lucidePencil" size="14" aria-hidden="true" />
                  <span>Edit</span>
                </button>
                <button
                  hlmDropdownMenuItem
                  type="button"
                  (triggered)="toggleVisible(row, !row.isVisible)"
                >
                  <ng-icon
                    [name]="row.isVisible ? 'lucideEyeOff' : 'lucideEye'"
                    size="14"
                    aria-hidden="true"
                  />
                  <span>{{ row.isVisible ? "Hide from site" : "Show on site" }}</span>
                </button>
                <button
                  hlmDropdownMenuItem
                  type="button"
                  [disabled]="i === 0"
                  (triggered)="move(i, -1)"
                >
                  Move up
                </button>
                <button
                  hlmDropdownMenuItem
                  type="button"
                  [disabled]="i === rows().length - 1"
                  (triggered)="move(i, 1)"
                >
                  Move down
                </button>
                <hlm-dropdown-menu-separator />
                <button
                  hlmDropdownMenuItem
                  type="button"
                  class="text-destructive focus:text-destructive"
                  (triggered)="remove(row)"
                >
                  <ng-icon name="lucideTrash2" size="14" aria-hidden="true" />
                  <span>Delete</span>
                </button>
              </hlm-dropdown-menu>
            </ng-template>
          }
        </div>
      }
    </app-editor-layout>
  `,
})
export default class AdminExperiencePage implements OnInit {
  private readonly api = inject(AdminApiService);
  private readonly confirm = inject(ConfirmService);
  private readonly unsaved = inject(UnsavedChangesService);
  private readonly recovery = inject(RecoveryService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  /** The review, for the trace's draft state; absent in unit tests. */
  private readonly pulse = inject(AdminPulseService, { optional: true });
  private readonly preview = inject(LivePreviewService, { optional: true });
  private readonly versions = new ChangedElsewhere(this.confirm, async () => {
    const list = await this.api.listExperiences();
    return list.ok ? list.data.experiences : null;
  });

  protected readonly detailFields = DETAIL_FIELDS;
  protected readonly language = LANGUAGE;

  /** The entry the address opens: an id, `new`, or none (the list). */
  private readonly edit = toSignal(this.route.queryParamMap.pipe(map((q) => q.get("edit"))), {
    initialValue: null,
  });

  protected readonly rows = signal<ExperienceRow[]>([]);
  protected readonly loading = signal(true);
  /** The API's reason when the list did not arrive. */
  protected readonly loadError = signal<string | null>(null);
  /** The address names an entry that is not there. */
  protected readonly missing = signal(false);
  protected readonly saving = signal(false);
  /** When this editor last saved, for the header's "Saved 14:02". */
  protected readonly savedAt = signal<number | null>(null);
  /** Per trace key, when this editor saved it: in the draft until a review asked after that arrives. */
  private readonly savedHere = signal<ReadonlyMap<string, number>>(new Map());
  protected readonly draft = signal<Draft | null>(null);
  /** The entry as opened or last saved, to tell what is unsaved. */
  private readonly opened = signal("");
  private readonly openedDraft = computed(() =>
    this.opened() ? (JSON.parse(this.opened()) as Draft) : null,
  );
  private readonly backup: RecoveryHandle;
  private reopened = false;
  private gone = false;
  /** The last save's problems, by the input's path. */
  protected readonly issues = new FieldIssues();

  protected readonly view = signal<LocaleView>(storedView("experience") ?? "both");
  /** English and German side by side from 1024 px; one language below it. */
  protected readonly wide = computed(() => this.preview?.wide() ?? true);
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

  /** One control per text and language, mirroring the draft: the bilingual field's. */
  private readonly controls = Object.fromEntries(
    (["title", "summary"] as const).map((key) => [
      key,
      {
        en: new FormControl("", { nonNullable: true }),
        de: new FormControl("", { nonNullable: true }),
      },
    ]),
  ) as Record<TextKey, Record<Locale, FormControl<string>>>;

  private readonly draftDirty = computed(() => {
    const d = this.draft();
    return d !== null && JSON.stringify(d) !== this.opened();
  });

  /** The logo's path follows its id: one field. */
  protected readonly changes = computed(() =>
    countChangedFields(this.openedDraft(), this.draft(), ["logoPath"]),
  );

  protected readonly title = computed(() => {
    const d = this.draft();
    return d ? nameOf(d) || "New entry" : "Experience";
  });

  /** Each traced field's state, by its key: unsaved here, in the draft, or live. */
  protected readonly trace = computed<Record<string, TraceState>>(() => {
    const now = this.draft();
    const base = this.openedDraft();
    if (!now || !base) {
      return {};
    }
    const marks = this.pulse?.marks() ?? null;
    const saved = this.savedHere();
    // A new or a hidden entry is not on the site: nothing of it is live, or in the draft against it.
    const onSite = base.id !== null && base.isVisible;
    const out: Record<string, TraceState> = {};
    for (const { key, read, path } of TRACED) {
      const unsaved = JSON.stringify(read(now)) !== JSON.stringify(read(base));
      const draft =
        onSite &&
        (inDraft(marks, `experiences[${base.id}].${path}`) ||
          (saved.get(key) ?? 0) > (marks?.asked ?? 0));
      out[key] = stateOf(unsaved, draft);
    }
    return out;
  });

  /** The live site's title and summary in both languages, for "English changed, German not". */
  protected readonly liveCopy = computed(() => {
    const marks = this.pulse?.marks() ?? null;
    const id = this.openedDraft()?.id;
    const at = (locale: Locale, key: TextKey) =>
      marks?.live[locale]?.experiences?.find((e) => e.id === id)?.[key];
    return Object.fromEntries(
      (["title", "summary"] as const).map((key) => {
        const [en, de] = [at("en", key), at("de", key)];
        return [key, typeof en === "string" && typeof de === "string" ? { en, de } : null];
      }),
    ) as Record<TextKey, Record<Locale, string> | null>;
  });

  /** Fields saved to the draft and not live; null for an entry not on the site, or while unknown. */
  protected readonly notLive = computed(() => {
    const base = this.openedDraft();
    if (!base?.id || !base.isVisible) {
      return null;
    }
    if (!this.pulse?.marks() && this.savedHere().size === 0) {
      return null;
    }
    return Object.values(this.trace()).filter((state) => state === "draft").length;
  });

  /** The sections for the rail: the trace rolled up, and the last save's problems in each. */
  protected readonly outline = computed<OutlineItem[]>(() => {
    if (!this.draft()) {
      return [];
    }
    const trace = this.trace();
    const problems = this.issues.entries().map(([path]) => path);
    return SECTIONS.map(({ id, label, prefixes }) => ({
      id,
      label,
      problems: problemsUnder(problems, prefixes),
      change: rollUp(TRACED.filter((t) => t.section === id).map((t) => trace[t.key] ?? "live")),
    }));
  });

  /** The timeline as it would be published: the list and the open entry. */
  protected readonly livePreview = computed<LiveCompose | null>(() => {
    if (this.loading() || this.loadError()) {
      return null;
    }
    const rows = this.rows();
    const open = this.draft();
    return (base, locale, media) => withExperiences(base, locale, rows, open, media);
  });

  /** The open entry's title in each language, to bring it into view. */
  protected readonly entryFocus = computed(() => {
    const d = this.draft();
    return d ? { en: d.translations.en.title, de: d.translations.de.title } : null;
  });

  protected readonly previewNote = computed(() => {
    const d = this.draft();
    if (d && !d.isVisible) {
      return "Hidden on the site: shown here so you can check it.";
    }
    return d || this.loading() || this.rows().some((row) => row.isVisible)
      ? null
      : "No entries shown yet: the timeline is left off the page.";
  });

  /** The logo's hint, with its trace's words: a media slot has no description of its own. */
  protected readonly logoHint = computed(() => {
    const words = this.words("logoId");
    return ["The organisation's mark beside the entry.", words && `${words}.`]
      .filter(Boolean)
      .join(" ");
  });

  constructor() {
    effect(() => this.unsaved.set("experience-entry", this.draftDirty()));
    inject(DestroyRef).onDestroy(() => {
      this.gone = true;
      this.unsaved.clear("experience-entry");
    });
    // The address decides what shows, once the list is here: the list, an entry, or a new one.
    effect(() => {
      const edit = this.edit();
      if (this.loading() || this.loadError()) {
        return;
      }
      untracked(() => this.follow(edit));
    });
    // A text typed, or put there by its ⋯, goes into the draft like any edit.
    for (const key of ["title", "summary"] as const) {
      for (const locale of LOCALES) {
        this.controls[key][locale].valueChanges.subscribe((text) => {
          if (text !== this.draft()?.translations[locale][key]) {
            this.patchText(locale, { [key]: text });
          }
        });
      }
    }
    this.backup = this.recovery.track<Draft>({
      editor: "experience-entry",
      item: () => {
        const draft = this.draft();
        return draft ? (draft.id ?? "new") : null;
      },
      saved: this.openedDraft,
      current: this.draft,
      restore: (draft) => {
        this.draft.set(draft);
        this.fill();
      },
    });
  }

  ngOnInit(): void {
    void this.load();
  }

  protected name(row: ExperienceRow): string {
    return nameOf(row) || "(untitled)";
  }

  protected titleOf(row: ExperienceRow): string {
    return row.translations.en.title || row.translations.de.title || "(untitled)";
  }

  protected kindOf(row: ExperienceRow): string {
    return KINDS.find((kind) => kind.value === row.kind)?.label ?? row.kind;
  }

  protected dates(row: ExperienceRow): string {
    return datesOf(row);
  }

  protected choose(view: LocaleView): void {
    this.view.set(view);
    storeView("experience", view);
  }

  protected control(key: TextKey, locale: Locale): FormControl<string> {
    return this.controls[key][locale];
  }

  protected reload(): void {
    this.loading.set(true);
    void this.load();
  }

  private async load(): Promise<void> {
    const result = await this.api.listExperiences();
    this.loading.set(false);
    this.loadError.set(result.ok ? null : result.error);
    if (!result.ok) {
      return;
    }
    this.rows.set(result.data.experiences);
    this.versions.remember(result.data.experiences);
    if (!this.reopened) {
      void this.reopen();
    }
  }

  /** A copy kept in this browser: its entry opens again, and the copy comes back over it. */
  private async reopen(): Promise<void> {
    this.reopened = true;
    if (this.edit() !== null) {
      return;
    }
    const [item] = await this.recovery.items("experience-entry");
    const known = item === "new" || this.rows().some((row) => row.id === item);
    if (item && known && !this.gone && this.edit() === null) {
      this.goTo(item);
    }
  }

  protected add(): void {
    this.goTo("new");
  }

  private goTo(edit: string): void {
    void this.router.navigate([], { relativeTo: this.route, queryParams: { edit } });
  }

  /** The address's entry, opened in the list's place; none, and the list is back. */
  private follow(edit: string | null): void {
    const open = this.draft();
    if (edit === (open ? (open.id ?? "new") : null) && !(edit === null && this.missing())) {
      return;
    }
    const row = edit && edit !== "new" ? this.rows().find((r) => r.id === edit) : undefined;
    this.missing.set(edit !== null && edit !== "new" && !row);
    if (edit === null || this.missing()) {
      this.draft.set(null);
      this.opened.set("");
      this.issues.clear();
      // A query's change is no page change to the layout: the focus goes back to the entry left.
      if (open) {
        this.focusRow(open.id);
      }
      return;
    }
    this.open(row ?? null);
  }

  private open(row: ExperienceRow | null): void {
    const empty = { title: "", summary: "", highlights: [] as string[] };
    const draft: Draft = row
      ? {
          ...structuredClone(row),
          translations: {
            en: row.translations.en ?? { ...empty },
            de: row.translations.de ?? { ...empty },
          },
        }
      : blankDraft();
    this.draft.set(draft);
    this.opened.set(JSON.stringify(draft));
    this.issues.clear();
    this.savedAt.set(null);
    this.savedHere.set(new Map());
    this.fill(true);
    // As after a navigation: the editor from its top, its heading focused.
    this.afterRender((root) => {
      globalThis.scrollTo?.(0, 0);
      root.querySelector<HTMLElement>("app-editor-header h1")?.focus({ preventScroll: true });
    });
  }

  private focusRow(id: string | null): void {
    this.afterRender((root) => {
      const link = id ? root.querySelector<HTMLElement>(`a[data-entry="${CSS.escape(id)}"]`) : null;
      (link ?? root.querySelector<HTMLElement>("button[data-add]"))?.focus();
    });
  }

  /** The controls take the draft's text: after an open, a discard or a recovery copy. */
  private fill(fresh = false): void {
    const d = this.draft();
    for (const key of ["title", "summary"] as const) {
      for (const locale of LOCALES) {
        const control = this.controls[key][locale];
        const text = d?.translations[locale][key] ?? "";
        // A reset abandons the field's own drafts and its Undo: only where the text moved, or on an open.
        if (fresh || control.value !== text) {
          control.reset(text);
        }
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
  protected describedBy(field: DetailField): string | null {
    const ids = [
      this.issues.get(field.key) ? `${field.id}-issue` : null,
      this.mark(field.key) ? `${field.id}-state` : null,
      field.hint ? `${field.id}-hint` : null,
    ].filter(Boolean);
    return ids.length ? ids.join(" ") : null;
  }

  protected detailOf(key: DetailKey): string {
    return this.draft()?.[key] ?? "";
  }

  protected patchDetail(key: DetailKey, value: string): void {
    this.patch({ [key]: key === "endDate" ? value || null : value });
  }

  protected patch(change: Partial<Draft>): void {
    this.draft.update((d) => (d ? { ...d, ...change } : d));
    for (const key of Object.keys(change)) {
      this.issues.resolve(key);
    }
  }

  protected patchText(locale: Locale, change: Partial<Draft["translations"]["en"]>): void {
    this.draft.update((d) =>
      d
        ? {
            ...d,
            translations: { ...d.translations, [locale]: { ...d.translations[locale], ...change } },
          }
        : d,
    );
    for (const key of Object.keys(change)) {
      this.issues.resolve(`translations.${locale}.${key}`);
    }
  }

  protected chooseLogo(asset: MediaAsset | null): void {
    this.patch({ logoId: asset?.id ?? null, logoPath: asset?.path ?? null });
  }

  protected discard(): void {
    const edits = this.draft();
    toastDiscarded(() => {
      this.draft.set(edits);
      this.fill();
    });
    this.draft.set(this.openedDraft());
    this.issues.clear();
    this.fill();
  }

  protected async save(): Promise<void> {
    const d = this.draft();
    if (!d || this.saving()) {
      return;
    }

    this.saving.set(true);
    if (!(await this.versions.mayOverwrite(d.id ? [d.id] : [], this.title()))) {
      this.saving.set(false);
      return;
    }
    const input = inputOf(d);
    let nextId = d.id;
    let result: ApiResult<{ ok: true }>;
    if (d.id) {
      result = await this.api.updateExperience(d.id, input);
    } else {
      const created = await this.api.createExperience(input);
      result = created;
      if (created.ok) {
        nextId = created.data.id;
      }
    }
    if (result.ok) {
      await this.versions.refresh();
    }
    this.saving.set(false);
    if (this.gone) {
      return;
    }
    if (!result.ok) {
      this.refused(result.error, result.issues ?? []);
      return;
    }
    const id = nextId;
    // A new entry's copy was kept under `new`: it is saved now, under its id.
    if (!d.id) {
      this.backup.drop("new");
    }
    this.saved({ ...d, id });
    if (!d.id) {
      void this.router.navigate([], {
        relativeTo: this.route,
        queryParams: { edit: id },
        replaceUrl: true,
      });
    }
    void this.load();
  }

  /** A save that landed: the new saved state, its fields marked saved here, the header told when. */
  private saved(current: Draft): void {
    const before = this.trace();
    const at = Date.now();
    this.draft.set(current);
    this.opened.set(JSON.stringify(current));
    this.savedHere.update((marks) => {
      const next = new Map(marks);
      for (const [key, state] of Object.entries(before)) {
        if (state === "unsaved") {
          next.set(key, at);
        }
      }
      return next;
    });
    this.issues.clear();
    for (const key of ["title", "summary"] as const) {
      for (const locale of LOCALES) {
        this.controls[key][locale].markAsPristine();
      }
    }
    this.savedAt.set(at);
    // Now, not at the next render: a new entry's address changes next, and the guard reads this.
    this.unsaved.set("experience-entry", false);
  }

  /** A refused save: its problems on their fields, the first focused, in the language that shows them. */
  private refused(error: string, issues: readonly ApiIssue[]): void {
    if (!issues.length) {
      toastNotSaved(error, "Save failed");
      return;
    }
    this.issues.set(issues);
    toastIssues(issues);
    const shown = this.shownView();
    const other = issues.find((i) => isLocale(i.path[1]) && shown !== "both" && i.path[1] !== shown)
      ?.path[1] as Locale | undefined;
    if (other) {
      this.view.set(this.wide() ? "both" : other);
    }
    this.afterRender((root) => {
      for (const key of ["title", "summary"] as const) {
        for (const locale of LOCALES) {
          const message = this.issues.get(`translations.${locale}.${key}`);
          if (message) {
            this.controls[key][locale].setErrors({ server: message });
          }
        }
      }
      focusFirstInvalid(root);
    });
  }

  protected async toggleVisible(row: ExperienceRow, isVisible: boolean): Promise<void> {
    const previous = this.rows();
    this.rows.update((list) => list.map((r) => (r.id === row.id ? { ...r, isVisible } : r)));
    const result = await this.api.setVisibility("experiences", row.id, isVisible);
    if (!result.ok) {
      this.rows.set(previous);
      toastNotSaved(result.error);
      return;
    }
    void this.versions.refresh();
  }

  protected async remove(row: ExperienceRow): Promise<void> {
    const go = await this.confirm.ask({
      title: `Delete ${this.name(row)}?`,
      description: "The entry and its text in both languages are deleted. This cannot be undone.",
      confirmLabel: "Delete entry",
      destructive: true,
    });
    if (!go) {
      return;
    }

    const previous = this.rows();
    this.rows.update((list) => list.filter((r) => r.id !== row.id));
    const result = await this.api.deleteExperience(row.id);
    if (!result.ok) {
      this.rows.set(previous);
      toast.error("Could not delete", { description: result.error });
      return;
    }
    this.recovery.forget("experience-entry", row.id);
    // Its row and ⋯ went: the page's Add takes the focus.
    this.afterRender((root) => root.querySelector<HTMLElement>("button[data-add]")?.focus());
  }

  protected onGripKey(event: KeyboardEvent, index: number): void {
    if (!event.altKey || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) {
      return;
    }
    event.preventDefault();
    this.move(index, event.key === "ArrowUp" ? -1 : 1);
  }

  protected move(index: number, by: -1 | 1): void {
    this.moveTo(index, index + by);
  }

  protected dropped(event: CdkDragDrop<unknown>): void {
    this.moveTo(event.previousIndex, event.currentIndex);
  }

  private moveTo(from: number, to: number): void {
    const list = [...this.rows()];
    if (from === to || to < 0 || to >= list.length) {
      return;
    }
    moveItemInArray(list, from, to);
    void this.onReorder(list);
    // A moved row is a node moved, which loses the focus: its grip takes it back where it lands.
    this.afterRender((root) =>
      root.querySelectorAll<HTMLElement>("button[data-grip]")[to]?.focus(),
    );
  }

  private async onReorder(next: ExperienceRow[]): Promise<void> {
    const previous = this.rows();
    this.rows.set(next);
    const result = await this.api.reorder(
      "experiences",
      next.map((r) => r.id),
    );
    if (!result.ok) {
      this.rows.set(previous);
      toast.error("Could not reorder", { description: result.error });
      return;
    }
    // A reorder is an edit to every row, so it moves their versions.
    void this.versions.refresh();
  }

  private afterRender(run: (root: HTMLElement) => void): void {
    afterNextRender(
      () => {
        if (!this.gone) {
          run(this.host.nativeElement);
        }
      },
      { injector: this.injector },
    );
  }
}
