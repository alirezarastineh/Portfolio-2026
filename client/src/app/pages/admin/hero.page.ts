import { NgTemplateOutlet } from "@angular/common";
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
import {
  FormBuilder,
  FormControl,
  FormsModule,
  ReactiveFormsModule,
  type AbstractControl,
  type FormGroup,
} from "@angular/forms";
import { NgIcon, provideIcons } from "@ng-icons/core";
import { lucidePlus, lucideTrash2 } from "@ng-icons/lucide";
import { HlmButton } from "@spartan-ng/helm/button";
import { HlmFieldLabel } from "@spartan-ng/helm/field";
import { HlmInput } from "@spartan-ng/helm/input";
import { HlmSwitch } from "@spartan-ng/helm/switch";

import {
  AdminApiService,
  type ApiIssue,
  type MediaAsset,
  type ProfileInput,
  type ResumeRow,
  type SocialInput,
  type SocialRow,
} from "../../admin/admin-api.service";
import { ChangedElsewhere } from "../../admin/changed-elsewhere";
import { countChangedFields } from "../../admin/changed-fields";
import { liveText, rollUp, TRACE_WORDS, traceOf, type TraceState } from "../../admin/change-trace";
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
} from "../../admin/components/load-state.component";
import { MediaFieldComponent } from "../../admin/components/media-field.component";
import {
  SortableListComponent,
  SortableRowDirective,
} from "../../admin/components/sortable-list.component";
import type { OutlineItem } from "../../admin/editor-outline";
import { isHidden } from "../../admin/hidden-fields";
import { applyIssues, countServerErrors, FieldIssues, focusFirstInvalid } from "../../admin/issues";
import { storedView, storeView } from "../../admin/language-view";
import { withIdentity, withUi, type LiveCompose } from "../../admin/preview/live-content";
import { LivePreviewService } from "../../admin/preview/live-preview.service";
import { LivePreviewToggleComponent } from "../../admin/preview/live-preview-toggle.component";
import { AdminPulseService } from "../../admin/pulse.service";
import { RecoveryService } from "../../admin/recovery.service";
import {
  askStale,
  toastDiscarded,
  toastIssues,
  toastNotSaved,
  toastUndo,
} from "../../admin/save-feedback";
import { UiSectionService } from "../../admin/ui-section.service";
import { UnsavedChangesService, unsavedChangesGuard } from "../../admin/unsaved-changes.service";
import { isLocale } from "../../content/locale";
import type { AppTranslations, Availability, Locale } from "../../content/schema";

type ProfileGroup = AppTranslations["profile"];
type NavGroup = AppTranslations["nav"];
type HeroGroup = AppTranslations["hero"];
type CopyGroup = "profile" | "hero" | "nav";

/** A field in two languages, by the `ui` group it is saved in. */
interface CopyField {
  group: CopyGroup;
  key: string;
  label: string;
  hint: string;
  multiline?: boolean;
}

type IdentityKey = Exclude<keyof ProfileInput, "avatarId">;

/** A field in one language: the identity row's. */
interface PlainField {
  key: IdentityKey;
  label: string;
  hint: string;
  type?: "email" | "url";
  placeholder?: string;
  maxLength?: number;
  /** A value, not words: no spelling check. */
  value?: boolean;
}

/** In the page's order; each hint names every place its value appears. */
const IDENTITY: PlainField[] = [
  {
    key: "name",
    label: "Name",
    hint: "Header, footer, page titles and breadcrumbs, share images, structured data, the feed, llms.txt, the console and the assistant.",
  },
  {
    key: "handle",
    label: "Handle",
    hint: "The structured data, llms.txt and the assistant.",
    value: true,
  },
  {
    key: "contactEmail",
    label: "Contact email",
    type: "email",
    hint: "The contact section, the structured data and the assistant.",
    value: true,
  },
  {
    key: "siteUrl",
    label: "Site address",
    type: "url",
    placeholder: "https://alirezarastineh.me",
    hint: "Starts every absolute link; if empty, SEO's canonical URL.",
    value: true,
  },
  {
    key: "availability",
    label: "Availability",
    hint: "The hero's dot and line, the console and the assistant.",
  },
  {
    key: "timezone",
    label: "Time zone",
    placeholder: "Europe/Berlin",
    hint: "Local time in the hero, contact section and the assistant.",
    value: true,
  },
  {
    key: "locationCity",
    label: "City",
    placeholder: "Berlin",
    hint: "Hero, About, contact section, console, llms.txt, assistant.",
  },
  {
    key: "locationCountry",
    label: "Country code",
    placeholder: "DE",
    maxLength: 2,
    hint: "Two letters, as DE.",
    value: true,
  },
];

/** The hero's button link; the second button's stays out of sight (nothing reads it) and in every save. */
const BUTTON_LINKS: PlainField[] = [
  {
    key: "primaryCtaHref",
    label: "Button link",
    hint: "Where the hero's button goes: #projects or an address.",
    value: true,
  },
  { key: "secondaryCtaHref", label: "Second button link", hint: "", value: true },
];

const ABOUT_YOU: CopyField[] = [
  {
    group: "profile",
    key: "role",
    label: "Role",
    hint: "Beside your name in the console, the share images, the structured data's job title, llms.txt and the assistant.",
  },
  {
    group: "profile",
    key: "location",
    label: "Fallback place",
    hint: "Only while City and Country are empty: the place in the hero, About's facts, the contact section, the console and the assistant.",
  },
];

const HERO_COPY: CopyField[] = [
  {
    group: "profile",
    key: "heroHeadline",
    label: "Headline",
    multiline: true,
    hint: "The hero's large statement; also the home page's share image, the console and the assistant.",
  },
  {
    group: "profile",
    key: "heroSubheadline",
    label: "Subheadline",
    multiline: true,
    hint: "The line under the hero's statement, and the assistant.",
  },
  { group: "profile", key: "primaryCta", label: "Button label", hint: "The hero's button." },
  { group: "profile", key: "secondaryCta", label: "Second button label", hint: "" },
];

/** Labels until Words takes them (plan 5, U12): closed at rest. */
const LABELS: CopyField[] = [
  {
    group: "hero",
    key: "availabilityOpen",
    label: "Availability line when open",
    hint: "Beside the hero's dot and in the console, while Availability is open.",
  },
  {
    group: "hero",
    key: "availabilityLimited",
    label: "Availability line when limited",
    hint: "Beside the hero's dot and in the console, while Availability is limited.",
  },
  {
    group: "hero",
    key: "availabilityClosed",
    label: "Availability line when closed",
    hint: "Beside the hero's dot and in the console, while Availability is closed.",
  },
  {
    group: "hero",
    key: "downloadCv",
    label: "CV button",
    hint: "The hero's and the header's CV button, and its entry in the search palette.",
  },
  {
    group: "hero",
    key: "askCta",
    label: "Ask button",
    hint: "The title over the assistant's stage on home, and the 404 page's button to ask.",
  },
  { group: "nav", key: "skills", label: "Skills link", hint: "" },
  {
    group: "nav",
    key: "projects",
    label: "Work link",
    hint: "The header's link to the work section.",
  },
  { group: "nav", key: "about", label: "About link", hint: "The header's link to About." },
  { group: "nav", key: "contact", label: "Contact link", hint: "" },
  {
    group: "nav",
    key: "work",
    label: "Work heading",
    hint: "Over the project links in the footer, in the case study's breadcrumb, and on the share image of a project without a descriptor.",
  },
  {
    group: "nav",
    key: "experience",
    label: "Experience link",
    hint: "The header's link to Experience.",
  },
  {
    group: "nav",
    key: "writing",
    label: "Writing link",
    hint: "The header's link to Writing; also over the posts in the footer and in the search palette, the 404 page's link to the posts, and on a post's share image.",
  },
];

const AVAILABILITY: { value: Availability; label: string }[] = [
  { value: "open", label: "Open to new roles" },
  { value: "limited", label: "Limited availability" },
  { value: "closed", label: "Not available" },
];

/** Where the review names an identity field: most by their own name. */
const PATHS: Partial<Record<string, string>> = {
  locationCity: "identity.location.city",
  locationCountry: "identity.location.country",
  avatarId: "identity.avatar",
};
const identityPath = (key: string): string => PATHS[key] ?? `identity.${key}`;

/** What nothing on the site reads stays out of sight; its value stays in the form, and saves. */
const shownCopy = (fields: CopyField[]): CopyField[] =>
  fields.filter((f) => !isHidden("section", "ui", `${f.group}.${f.key}`));
const shownPlain = (fields: PlainField[]): PlainField[] =>
  fields.filter((f) => !isHidden("identity", "", f.key));

function toInput(row: SocialRow): SocialInput {
  return {
    label: row.label.trim(),
    href: row.href.trim(),
    icon: row.icon,
    isVisible: row.isVisible,
  };
}

export const routeMeta: RouteMeta = { canDeactivate: [unsavedChangesGuard] };

/**
 * Profile (plan 5, U11): the facts the site states about you, the photo, the CV per language
 * (saved at once), the hero's words and button, and the links (Socials, folded in), on the editor
 * header and the bilingual field. The identity row has a version of its own beside the `ui`
 * document's; the links save row by row, and add, delete and reorder at once.
 */
@Component({
  selector: "app-admin-hero",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    BilingualFieldComponent,
    EditorHeaderComponent,
    EditorLayoutComponent,
    FieldIssueComponent,
    FormSkeletonComponent,
    FormsModule,
    HlmButton,
    HlmFieldLabel,
    HlmInput,
    HlmSwitch,
    LivePreviewToggleComponent,
    LoadErrorComponent,
    LocaleToggleComponent,
    MediaFieldComponent,
    NgIcon,
    NgTemplateOutlet,
    ReactiveFormsModule,
    SortableListComponent,
    SortableRowDirective,
  ],
  viewProviders: [provideIcons({ lucidePlus, lucideTrash2 })],
  host: { class: "block" },
  template: `
    <app-editor-layout
      anchor="hero"
      [compose]="livePreview()"
      [outline]="outline()"
      [view]="shownView()"
    >
      <div class="flex flex-col gap-6">
        <app-editor-header
          title="Profile"
          [changes]="changes()"
          [saving]="saving()"
          [problems]="problems()"
          [notLive]="notLive()"
          (save)="save()"
          (discard)="discard()"
        >
          <app-locale-toggle
            class="max-md:order-first"
            [view]="shownView()"
            [both]="wide()"
            (viewChange)="choose($event)"
          />
          <app-live-preview-toggle />
        </app-editor-header>

        @if (loading()) {
          <app-form-skeleton [rows]="6" />
        } @else if (!loaded()) {
          <app-load-error (retry)="reload()" />
        } @else {
          <div class="flex flex-col gap-10">
            <section
              id="profile-identity"
              aria-labelledby="profile-identity-title"
              class="flex flex-col gap-6"
            >
              <h2 id="profile-identity-title" class="m-0 text-section-title">Identity</h2>
              <div class="grid gap-6 lg:grid-cols-2">
                @for (field of identityFields; track field.key) {
                  <ng-container *ngTemplateOutlet="plain; context: { $implicit: field }" />
                }
              </div>
              <ng-container *ngTemplateOutlet="heads" />
              @for (field of aboutYou; track field.key) {
                <ng-container *ngTemplateOutlet="copy; context: { $implicit: field }" />
              }
            </section>

            <section
              id="profile-hero"
              aria-labelledby="profile-hero-title"
              class="flex flex-col gap-6"
            >
              <h2 id="profile-hero-title" class="m-0 text-section-title">Hero</h2>
              <ng-container *ngTemplateOutlet="heads" />
              @for (field of heroCopy; track field.key) {
                <ng-container *ngTemplateOutlet="copy; context: { $implicit: field }" />
              }
              <div class="grid gap-6 lg:grid-cols-2">
                @for (field of buttonLinks; track field.key) {
                  <ng-container *ngTemplateOutlet="plain; context: { $implicit: field }" />
                }
              </div>
            </section>

            <section id="profile-cv" aria-labelledby="profile-cv-title" class="flex flex-col gap-6">
              <div class="flex flex-col gap-1">
                <h2 id="profile-cv-title" class="m-0 text-section-title">Photo and CV</h2>
                <p class="m-0 text-hint text-muted-foreground">
                  A CV is saved at once and goes live with the next publish: one PDF per language,
                  behind the CV buttons. The photo waits for Save.
                </p>
              </div>
              <div class="grid gap-6 lg:grid-cols-3">
                <app-media-field
                  id="avatar"
                  class="change-trace"
                  label="Photo"
                  [attr.data-change]="mark('avatarId')"
                  [hint]="withState('In About: black and white, 4:5.', 'avatarId')"
                  [path]="avatarPath()"
                  (chosen)="chooseAvatar($event)"
                />
                @for (locale of locales; track locale) {
                  <app-media-field
                    class="change-trace"
                    kind="document"
                    [id]="'cv-' + locale"
                    [label]="'CV (' + locale.toUpperCase() + ')'"
                    [attr.data-change]="mark('cv-' + locale)"
                    [hint]="withState('', 'cv-' + locale)"
                    [path]="resumes()[locale]?.path ?? null"
                    [caption]="resumes()[locale]?.originalName ?? ''"
                    (chosen)="chooseResume(locale, $event)"
                  />
                }
              </div>
            </section>

            <section
              id="profile-links"
              aria-labelledby="profile-links-title"
              class="flex flex-col gap-4"
            >
              <div class="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                <div class="flex flex-col gap-1">
                  <h2
                    id="profile-links-title"
                    tabindex="-1"
                    class="m-0 text-section-title outline-none"
                  >
                    Links
                  </h2>
                  <p class="m-0 text-hint text-muted-foreground">
                    The footer, the contact section and the structured data. Add, delete and reorder
                    save at once.
                  </p>
                </div>
                @if (!linksError()) {
                  <button hlmBtn variant="outline" size="sm" type="button" (click)="add()">
                    <ng-icon name="lucidePlus" size="16" aria-hidden="true" />Add link
                  </button>
                }
              </div>
              @if (linksError(); as reason) {
                <app-load-error
                  title="Could not load the links"
                  [reason]="reason"
                  (retry)="reloadLinks()"
                />
              } @else {
                <div
                  class="hidden gap-3 pl-8 text-hint text-muted-foreground sm:grid sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_5.5rem_2rem]"
                  aria-hidden="true"
                >
                  <span>Label</span><span>URL</span><span>Shown</span>
                </div>
                <app-sortable-list
                  label="link"
                  emptyText="No links yet."
                  [items]="rows()"
                  [trackBy]="trackRow"
                  [ruled]="true"
                  [change]="linkChange"
                  (reordered)="onReorder($event)"
                >
                  <ng-template appSortableRow let-row>
                    <div
                      class="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_5.5rem_2rem] sm:items-start"
                    >
                      <div class="col-span-2 flex flex-col sm:col-span-1">
                        <input
                          hlmInput
                          autocomplete="off"
                          maxlength="60"
                          aria-label="Link label"
                          placeholder="GitHub"
                          [ngModel]="row.label"
                          (ngModelChange)="patch(row.id, { label: $event })"
                          [attr.aria-invalid]="issues.get(row.id + '.label') ? true : null"
                          [aria-describedby]="linkDescribedBy(row.id, 'label')"
                        />
                        <app-field-issue
                          [id]="row.id + '-label-issue'"
                          [message]="issues.get(row.id + '.label')"
                        />
                      </div>
                      <div class="col-span-2 flex flex-col sm:col-span-1">
                        <input
                          hlmInput
                          autocomplete="off"
                          spellcheck="false"
                          inputmode="url"
                          maxlength="500"
                          aria-label="Link URL"
                          placeholder="https://…"
                          [ngModel]="row.href"
                          (ngModelChange)="patch(row.id, { href: $event })"
                          [attr.aria-invalid]="issues.get(row.id + '.href') ? true : null"
                          [aria-describedby]="linkDescribedBy(row.id, 'href')"
                        />
                        <app-field-issue
                          [id]="row.id + '-href-issue'"
                          [message]="issues.get(row.id + '.href')"
                        />
                      </div>
                      <label
                        class="flex h-9 items-center gap-2 text-xs text-muted-foreground pointer-coarse:h-11"
                      >
                        <hlm-switch
                          [checked]="row.isVisible"
                          (checkedChange)="patch(row.id, { isVisible: $event })"
                        />
                        <span aria-hidden="true">{{ row.isVisible ? "shown" : "hidden" }}</span>
                        <span class="sr-only">Show {{ row.label || "this link" }} on the site</span>
                      </label>
                      <button
                        hlmBtn
                        variant="ghost"
                        size="icon-sm"
                        type="button"
                        class="text-muted-foreground hover:text-destructive"
                        [attr.aria-label]="'Delete ' + row.label"
                        (click)="remove(row)"
                      >
                        <ng-icon name="lucideTrash2" size="16" aria-hidden="true" />
                      </button>
                      <span [id]="row.id + '-state'" class="sr-only">{{
                        words(linkChange(row))
                      }}</span>
                    </div>
                  </ng-template>
                </app-sortable-list>
              }
            </section>

            <section
              id="profile-labels"
              aria-labelledby="profile-labels-title"
              class="flex flex-col gap-6"
            >
              <div class="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                <div class="flex flex-col gap-1">
                  <h2 id="profile-labels-title" class="m-0 text-section-title">Labels</h2>
                  <p class="m-0 text-hint text-muted-foreground">
                    The words of the hero's availability line, its CV and Ask buttons, and the
                    navigation.
                  </p>
                </div>
                <button
                  hlmBtn
                  variant="outline"
                  size="sm"
                  type="button"
                  aria-controls="profile-labels-fields"
                  [attr.aria-expanded]="labelsOpen()"
                  (click)="labelsOpen.set(!labelsOpen())"
                >
                  {{ labelsOpen() ? "Hide the labels" : "Show " + labelFields.length + " labels" }}
                </button>
              </div>
              <div id="profile-labels-fields" class="flex flex-col gap-6">
                @if (labelsOpen()) {
                  <ng-container *ngTemplateOutlet="heads" />
                  @for (field of labelFields; track field.key) {
                    <ng-container *ngTemplateOutlet="copy; context: { $implicit: field }" />
                  }
                }
              </div>
            </section>
          </div>
        }
      </div>
    </app-editor-layout>

    <!-- English and German over the two-language fields below them, once. -->
    <ng-template #heads>
      @if (shownView() === "both") {
        <div
          class="-mb-4 grid grid-cols-2 gap-3 text-hint text-muted-foreground"
          aria-hidden="true"
        >
          <span>English</span><span>German</span>
        </div>
      }
    </ng-template>

    <ng-template #copy let-field>
      <app-bilingual-field
        [id]="field.group + '-' + field.key"
        [label]="field.label"
        [hint]="field.hint"
        [multiline]="field.multiline ?? false"
        [rows]="2"
        [view]="shownView()"
        [state]="trace()[field.group + '.' + field.key] ?? 'live'"
        [live]="liveCopy()[field.group + '.' + field.key] ?? null"
        [controlEn]="control(field.group, 'en', field.key)"
        [controlDe]="control(field.group, 'de', field.key)"
      />
    </ng-template>

    <!-- One language: the identity row's. The field's anatomy without ⋯ or a language. -->
    <ng-template #plain let-field>
      <div class="change-trace flex min-w-0 flex-col gap-1.5" [attr.data-change]="mark(field.key)">
        <label hlmFieldLabel [for]="field.key">{{ field.label }}</label>
        @if (field.hint) {
          <p [id]="field.key + '-hint'" class="m-0 text-hint text-muted-foreground">
            {{ field.hint }}
          </p>
        }
        @if (field.key === "availability") {
          <select
            id="availability"
            class="h-9 rounded-lg border border-input-line bg-card px-2 text-sm pointer-coarse:h-11 pointer-coarse:text-base"
            [formControl]="identity.controls.availability"
            [attr.aria-describedby]="describedBy(field)"
          >
            @for (option of availability; track option.value) {
              <option [value]="option.value">{{ option.label }}</option>
            }
          </select>
        } @else {
          <input
            hlmInput
            autocomplete="off"
            [id]="field.key"
            [type]="field.type ?? 'text'"
            [formControl]="identityControl(field.key)"
            [placeholder]="field.placeholder ?? ''"
            [attr.maxlength]="field.maxLength ?? null"
            [attr.spellcheck]="field.value ? 'false' : null"
            [class.uppercase]="field.key === 'locationCountry'"
            [attr.aria-invalid]="identityIssue(field.key) ? true : null"
            [aria-describedby]="describedBy(field)"
          />
        }
        <span [id]="field.key + '-state'" class="sr-only">{{ words(mark(field.key)) }}</span>
        <app-field-issue [id]="field.key + '-issue'" [message]="identityIssue(field.key)" />
      </div>
    </ng-template>
  `,
})
export default class AdminHeroPage implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly api = inject(AdminApiService);
  private readonly ui = inject(UiSectionService);
  private readonly unsaved = inject(UnsavedChangesService);
  private readonly confirm = inject(ConfirmService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  /** Destroyed: a save that answers after that focuses nothing. */
  private gone = false;
  /** The review, for the trace's draft state; absent in unit tests. */
  private readonly pulse = inject(AdminPulseService, { optional: true });
  private readonly previewPanel = inject(LivePreviewService, { optional: true });
  private readonly versions = new ChangedElsewhere(this.confirm, async () => {
    const list = await this.api.listSocials();
    return list.ok ? list.data.socials : null;
  });

  protected readonly identityFields = shownPlain(IDENTITY);
  protected readonly buttonLinks = shownPlain(BUTTON_LINKS);
  protected readonly aboutYou = shownCopy(ABOUT_YOU);
  protected readonly heroCopy = shownCopy(HERO_COPY);
  protected readonly labelFields = shownCopy(LABELS);
  protected readonly availability = AVAILABILITY;
  protected readonly locales: Locale[] = ["en", "de"];

  protected readonly view = signal<LocaleView>("both");
  /** English and German side by side from 1024 px; one language below it. */
  protected readonly wide = computed(() => this.previewPanel?.wide() ?? true);
  protected readonly shownView = computed<LocaleView>(() =>
    this.view() === "both" && !this.wide() ? "en" : this.view(),
  );

  protected readonly loading = signal(true);
  protected readonly loaded = signal(false);
  protected readonly saving = signal(false);
  /** A save in progress, from Save to its last write: a second Ctrl S waits for it. */
  private busy = false;
  private readonly revision = signal(0);
  /** The labels, closed at rest: they open by themselves for a change or a problem (below). */
  protected readonly labelsOpen = signal(false);

  protected readonly avatarId = signal<string | null>(null);
  protected readonly avatarPath = signal<string | null>(null);
  protected readonly resumes = signal<Record<Locale, ResumeRow | null>>({ en: null, de: null });

  /** The links, in their order; each as last saved, by id. */
  protected readonly rows = signal<SocialRow[]>([]);
  private readonly savedRows = signal<ReadonlyMap<string, SocialRow>>(new Map());
  private readonly linksLoaded = signal(false);
  /** The API's reason when the links did not arrive: the rest of the page still works. */
  protected readonly linksError = signal<string | null>(null);
  /** A link's problems from the last save, keyed `<id>.<field>`. */
  protected readonly issues = new FieldIssues();

  /** Per trace key, when this page saved it: in the draft until a review asked after that arrives. */
  private readonly savedHere = signal<ReadonlyMap<string, number>>(new Map());

  /** Version tokens of the `ui` document and of the identity row. */
  private uiUpdatedAt: string | null = null;
  private profileUpdatedAt: string | null = null;
  private pristine: {
    identity: Omit<ProfileInput, "avatarId">;
    avatar: { id: string | null; path: string | null };
    profile: Record<Locale, ProfileGroup>;
    hero: Record<Locale, HeroGroup>;
    nav: Record<Locale, NavGroup>;
  } | null = null;

  protected readonly identity = this.fb.nonNullable.group({
    name: "",
    handle: "",
    contactEmail: "",
    primaryCtaHref: "",
    secondaryCtaHref: "",
    siteUrl: "",
    availability: "open" as Availability,
    locationCity: "",
    locationCountry: "",
    timezone: "",
  });

  protected readonly form = this.fb.nonNullable.group({
    profileEn: this.fb.nonNullable.group(blank("profile")),
    profileDe: this.fb.nonNullable.group(blank("profile")),
    heroEn: this.fb.nonNullable.group(blank("hero")),
    heroDe: this.fb.nonNullable.group(blank("hero")),
    navEn: this.fb.nonNullable.group(blank("nav")),
    navDe: this.fb.nonNullable.group(blank("nav")),
  });

  /** The fields as loaded or last saved, in the forms' own shape: what "changed" compares with. */
  private baseline: ReturnType<AdminHeroPage["snapshot"]> | null = null;

  private snapshot() {
    return {
      identity: this.identity.getRawValue(),
      copy: this.form.getRawValue(),
      avatarId: this.avatarId(),
    };
  }

  /** The identity, the copy and the photo: fields that differ from the saved ones. */
  private readonly heroChanges = computed(() => {
    this.revision();
    return this.baseline ? countChangedFields(this.baseline, this.snapshot()) : 0;
  });

  /** Each link that differs from its saved self, by id. */
  private readonly changedIds = computed(() => {
    const saved = this.savedRows();
    return new Set(
      this.rows()
        .filter((row) => {
          const before = saved.get(row.id);
          return before && JSON.stringify(toInput(row)) !== JSON.stringify(toInput(before));
        })
        .map((row) => row.id),
    );
  });

  /** The links' changed fields. */
  private readonly linkChanges = computed(() => {
    const saved = this.savedRows();
    return this.rows().reduce((sum, row) => {
      const before = saved.get(row.id);
      return sum + (before ? countChangedFields(toInput(before), toInput(row)) : 0);
    }, 0);
  });

  protected readonly changes = computed(() => this.heroChanges() + this.linkChanges());

  protected readonly problems = computed(() => {
    this.revision();
    return countServerErrors(this.form) + countServerErrors(this.identity) + this.issues.count();
  });

  /**
   * Each traced field's state, by key: an identity field by its name, a copy field as
   * `group.key`, the photo as `avatarId`, a CV as `cv-<locale>`.
   */
  protected readonly trace = computed<Record<string, TraceState>>(() => {
    this.revision();
    const marks = this.pulse?.marks() ?? null;
    const saved = this.savedHere();
    const base = this.baseline;
    const now = this.snapshot();
    const out: Record<string, TraceState> = {};
    const of = (key: string, path: string, unsaved: boolean, locale?: Locale) =>
      (out[key] = traceOf(unsaved, marks, path, saved.get(key), locale));
    for (const { key } of [...this.identityFields, ...this.buttonLinks]) {
      of(key, identityPath(key), !!base && base.identity[key] !== now.identity[key]);
    }
    of("avatarId", identityPath("avatarId"), !!base && base.avatarId !== now.avatarId);
    for (const { group, key } of [...this.aboutYou, ...this.heroCopy, ...this.labelFields]) {
      const [en, de] = [`${group}En`, `${group}De`] as const;
      const copy = (side: typeof en | typeof de) =>
        (now.copy[side] as Record<string, string>)[key] !==
        (base?.copy[side] as Record<string, string> | undefined)?.[key];
      of(`${group}.${key}`, `ui.${group}.${key}`, !!base && (copy(en) || copy(de)));
    }
    for (const locale of this.locales) {
      of(`cv-${locale}`, "identity.resume", false, locale);
    }
    return out;
  });

  /** A link's line, for the list: its own fields unsaved, or its place among the shown links in the draft. */
  protected readonly linkChange = (row: SocialRow): TraceState | null => this.linkState(row.id);

  private linkState(id: string): TraceState | null {
    const state = this.linkTrace().get(id) ?? "live";
    return state === "live" ? null : state;
  }

  private readonly linkTrace = computed(() => {
    const marks = this.pulse?.marks() ?? null;
    const saved = this.savedRows();
    const here = this.savedHere();
    const changed = this.changedIds();
    // The draft lists the shown links in their saved order, without ids: by place.
    const shown = this.rows().filter((row) => saved.get(row.id)?.isVisible);
    const live = marks?.live.en?.socials ?? [];
    return new Map(
      this.rows().map((row) => {
        const at = shown.indexOf(row);
        const path = at >= 0 ? `socials[${at}]` : "";
        const hiddenSince = at < 0 && live.some((link) => link.href === row.href);
        const state = traceOf(changed.has(row.id), marks, path, here.get(`link-${row.id}`));
        return [row.id, state === "live" && hiddenSince ? "draft" : state] as const;
      }),
    );
  });

  /** The live site's text of each copy field, for the German's notes. */
  protected readonly liveCopy = computed(() => {
    const marks = this.pulse?.marks() ?? null;
    return Object.fromEntries(
      [...this.aboutYou, ...this.heroCopy, ...this.labelFields].map(({ group, key }) => [
        `${group}.${key}`,
        liveText(marks, `ui.${group}.${key}`),
      ]),
    );
  });

  /** Fields saved to the draft and not live; null until the review or a save here says. */
  protected readonly notLive = computed(() => {
    if (!this.pulse?.marks() && this.savedHere().size === 0) return null;
    const states = [...Object.values(this.trace()), ...this.linkTrace().values()];
    return states.filter((state) => state === "draft").length;
  });

  /** The page's five sections, each with its trace rolled up and the last save's problems. */
  protected readonly outline = computed<OutlineItem[]>(() => {
    this.revision();
    if (!this.loaded()) return [];
    const trace = this.trace();
    const states = (keys: string[]) => keys.map((key) => trace[key] ?? "live");
    const copyKeys = (fields: CopyField[]) => fields.map((f) => `${f.group}.${f.key}`);
    const flagged = (fields: CopyField[]) =>
      fields.reduce(
        (sum, { group, key }) =>
          sum +
          (["En", "De"] as const).filter((side) =>
            this.form.controls[`${group}${side}`].get(key)?.hasError("server"),
          ).length,
        0,
      );
    return [
      {
        id: "profile-identity",
        label: "Identity",
        problems: countServerErrors(this.identity) + flagged(this.aboutYou),
        change: rollUp([
          ...states(this.identityFields.map((f) => f.key)),
          ...states(copyKeys(this.aboutYou)),
        ]),
      },
      {
        id: "profile-hero",
        label: "Hero",
        problems: flagged(this.heroCopy),
        change: rollUp([
          ...states(copyKeys(this.heroCopy)),
          ...states(this.buttonLinks.map((f) => f.key)),
        ]),
      },
      {
        id: "profile-cv",
        label: "Photo and CV",
        problems: 0,
        change: rollUp(states(["avatarId", "cv-en", "cv-de"])),
      },
      {
        id: "profile-links",
        label: "Links",
        problems: this.issues.count(),
        change: rollUp([...this.linkTrace().values()]),
      },
      {
        id: "profile-labels",
        label: "Labels",
        problems: flagged(this.labelFields),
        change: rollUp(states(copyKeys(this.labelFields))),
      },
    ];
  });

  /** The hero as it would be published with these edits: identity and copy over the draft. */
  protected readonly livePreview = computed<LiveCompose | null>(() => {
    this.revision();
    if (!this.loaded()) return null;
    const identity = { ...this.identity.getRawValue(), avatarId: this.avatarId() };
    const copy = this.form.getRawValue();
    const savedAvatar = this.pristine?.avatar.id ?? null;
    return (base, locale, media) =>
      withUi(withIdentity(base, locale, identity, savedAvatar, media), locale, {
        profile: { en: copy.profileEn, de: copy.profileDe },
        hero: { en: copy.heroEn, de: copy.heroDe },
        nav: { en: copy.navEn, de: copy.navDe },
      });
  });

  constructor() {
    const bump = () => this.revision.update((v) => v + 1);
    this.form.valueChanges.subscribe(bump);
    this.identity.valueChanges.subscribe(bump);
    effect(() => this.unsaved.set("hero", this.changes() > 0));
    // A label that comes back unsaved (a recovery copy, an Undo) opens the labels; closed again by
    // hand, they stay closed until the next one. A refused one opens them too (`showIssues`).
    let waiting = false;
    effect(() => {
      const trace = this.trace();
      const changed = this.labelFields.some(
        ({ group, key }) => trace[`${group}.${key}`] === "unsaved",
      );
      if (changed && !waiting) this.labelsOpen.set(true);
      waiting = changed;
    });
    inject(DestroyRef).onDestroy(() => {
      this.gone = true;
      this.unsaved.clear("hero");
    });
    const recovery = inject(RecoveryService);
    recovery.track({
      editor: "hero",
      saved: () => {
        this.revision();
        const baseline = this.baseline;
        return baseline ? { ...baseline, avatarPath: this.pristine?.avatar.path ?? null } : null;
      },
      current: () => {
        this.revision();
        return this.loaded() ? { ...this.snapshot(), avatarPath: this.avatarPath() } : null;
      },
      restore: ({ identity, copy, avatarId, avatarPath }) => {
        this.identity.patchValue(identity);
        this.form.patchValue(copy);
        this.identity.markAsDirty();
        this.form.markAsDirty();
        this.avatarId.set(avatarId);
        this.avatarPath.set(avatarPath);
        this.revision.update((v) => v + 1);
      },
    });
    // Each link's copy by its id: add, delete and reorder save at once.
    recovery.track({
      editor: "socials",
      rows: true,
      saved: () =>
        this.linksLoaded()
          ? Object.fromEntries([...this.savedRows().values()].map((row) => [row.id, toInput(row)]))
          : null,
      current: () => Object.fromEntries(this.rows().map((row) => [row.id, toInput(row)])),
      restore: (copy) =>
        this.rows.update((list) => list.map((row) => ({ ...row, ...copy[row.id] }))),
    });
  }

  ngOnInit(): void {
    const stored = storedView("profile");
    if (stored) this.view.set(stored);
    void this.load();
    void this.loadLinks();
  }

  protected control(group: CopyGroup, locale: Locale, key: string): FormControl<string> {
    const name = `${group}${locale === "en" ? "En" : "De"}` as const;
    return this.form.controls[name].get(key) as FormControl<string>;
  }

  /** A traced field's line: `unsaved`, `draft`, or none. */
  protected mark(key: string): TraceState | null {
    const state = this.trace()[key] ?? "live";
    return state === "live" ? null : state;
  }

  protected words(state: TraceState | null): string {
    return TRACE_WORDS[state ?? "live"];
  }

  /** A media slot has no description of its own: its state is said after its hint. */
  protected withState(hint: string, key: string): string {
    const words = this.words(this.mark(key));
    return [hint, words && `${words}.`].filter(Boolean).join(" ");
  }

  /** A save's problem first, then the trace's words, then the hint. */
  protected describedBy(field: PlainField): string | null {
    const ids = [
      this.identityIssue(field.key) ? `${field.key}-issue` : null,
      this.mark(field.key) ? `${field.key}-state` : null,
      field.hint ? `${field.key}-hint` : null,
    ].filter(Boolean);
    return ids.length ? ids.join(" ") : null;
  }

  protected linkDescribedBy(id: string, field: "label" | "href"): string | null {
    const ids = [
      this.issues.get(`${id}.${field}`) ? `${id}-${field}-issue` : null,
      this.linkState(id) ? `${id}-state` : null,
    ].filter(Boolean);
    return ids.length ? ids.join(" ") : null;
  }

  /** Profile's language view, remembered in this browser. */
  protected choose(view: LocaleView): void {
    this.view.set(view);
    storeView("profile", view);
  }

  private async load(): Promise<void> {
    const [profileResult, resumes, profileGroup, heroGroup, navGroup] = await Promise.all([
      this.api.getProfile(),
      this.api.getResumes(),
      this.ui.loadGroup("profile"),
      this.ui.loadGroup("hero"),
      this.ui.loadGroup("nav"),
    ]);
    this.loading.set(false);

    // The page says so, with a retry; `loaded` stays false.
    if (!profileResult.ok || !profileGroup || !heroGroup || !navGroup) return;
    if (resumes.ok) this.resumes.set(resumes.data.resumes);

    const p = profileResult.data.profile;
    this.uiUpdatedAt = profileGroup.updatedAt;
    this.profileUpdatedAt = p.updatedAt;
    this.pristine = {
      identity: {
        name: p.name,
        handle: p.handle,
        contactEmail: p.contactEmail,
        primaryCtaHref: p.primaryCtaHref,
        secondaryCtaHref: p.secondaryCtaHref,
        siteUrl: p.siteUrl,
        availability: p.availability,
        locationCity: p.locationCity,
        locationCountry: p.locationCountry,
        timezone: p.timezone,
      },
      avatar: { id: p.avatarId, path: p.avatarPath },
      profile: profileGroup.value,
      hero: heroGroup.value,
      nav: navGroup.value,
    };

    this.applyPristine();
    this.loaded.set(true);
  }

  private applyPristine(): void {
    if (!this.pristine) return;

    this.identity.reset(this.pristine.identity);
    this.avatarId.set(this.pristine.avatar.id);
    this.avatarPath.set(this.pristine.avatar.path);
    this.form.reset({
      profileEn: this.pristine.profile.en,
      profileDe: this.pristine.profile.de,
      heroEn: this.pristine.hero.en,
      heroDe: this.pristine.hero.de,
      navEn: this.pristine.nav.en,
      navDe: this.pristine.nav.de,
    });
    this.form.markAsPristine();
    this.identity.markAsPristine();
    this.baseline = this.snapshot();
    this.revision.update((v) => v + 1);
  }

  private async loadLinks(): Promise<void> {
    const result = await this.api.listSocials();
    this.linksError.set(result.ok ? null : result.error);
    if (!result.ok) return;
    this.rows.set(result.data.socials);
    this.savedRows.set(new Map(result.data.socials.map((row) => [row.id, structuredClone(row)])));
    this.versions.remember(result.data.socials);
    this.linksLoaded.set(true);
  }

  protected reloadLinks(): void {
    this.linksError.set(null);
    void this.loadLinks();
  }

  protected discard(): void {
    const identity = this.identity.getRawValue();
    const copy = this.form.getRawValue();
    const avatarId = this.avatarId();
    const avatarPath = this.avatarPath();
    const rows = this.rows();
    const saved = this.savedRows();
    this.applyPristine();
    this.rows.update((list) => list.map((row) => structuredClone(saved.get(row.id) ?? row)));
    this.issues.clear();
    toastDiscarded(() => {
      this.avatarId.set(avatarId);
      this.avatarPath.set(avatarPath);
      this.identity.setValue(identity);
      this.form.setValue(copy);
      this.identity.markAsDirty();
      this.form.markAsDirty();
      this.rows.set(rows);
    });
  }

  protected chooseAvatar(asset: MediaAsset | null): void {
    this.avatarId.set(asset?.id ?? null);
    this.avatarPath.set(asset?.path ?? null);
    this.revision.update((v) => v + 1);
  }

  /** CVs point at media; changing one is saved at once and goes live with the next publish. */
  protected async chooseResume(locale: Locale, asset: MediaAsset | null): Promise<void> {
    const before = this.resumes()[locale];
    if (!asset) {
      const remove = await this.confirm.ask({
        title: `Remove ${before?.originalName ?? "this CV"}?`,
        description: `The ${locale.toUpperCase()} CV leaves the draft now, and the site at the next publish. The file stays in Media.`,
        confirmLabel: "Remove",
        cancelLabel: "Keep it",
        destructive: true,
      });
      if (!remove) return;
    }
    if (!(await this.putResume(locale, asset?.id ?? null))) return;
    const name = `CV (${locale.toUpperCase()})`;
    // Saved at once, so the way back is a step of its own: the file before it, or none.
    toastUndo(
      asset ? `${name} saved` : `${name} removed`,
      () => void this.putResume(locale, before?.mediaId ?? null),
      `#cv-${locale} button`,
    );
  }

  /** One CV written at once, then read back; true when it went through. */
  private async putResume(locale: Locale, mediaId: string | null): Promise<boolean> {
    const result = mediaId
      ? await this.api.putResume(locale, mediaId)
      : await this.api.deleteResume(locale);
    if (!result.ok) {
      toastNotSaved(result.error, "CV not saved");
      return false;
    }
    this.markSaved([`cv-${locale}`]);
    const refreshed = await this.api.getResumes();
    if (refreshed.ok) this.resumes.set(refreshed.data.resumes);
    return true;
  }

  /** What this page wrote now stays grey until a review asked after it arrives. */
  private markSaved(keys: readonly string[]): void {
    const now = Date.now();
    this.savedHere.update(
      (saved) => new Map([...saved, ...keys.map((key) => [key, now] as const)]),
    );
  }

  /** Profile, then the changed links: one Save for both, each keeping its own way of failing. */
  protected async save(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      if (this.heroChanges()) await this.saveHero();
      if (this.linkChanges()) await this.saveLinks();
    } finally {
      this.busy = false;
    }
  }

  /** Identity and copy in one request, so the page is never left half-saved. */
  private async saveHero(retried = false): Promise<void> {
    this.saving.set(true);

    const raw = this.form.getRawValue();
    const typed = this.identity.getRawValue();
    const identity = { ...typed, locationCountry: typed.locationCountry.trim().toUpperCase() };
    const value = {
      profile: { en: raw.profileEn as ProfileGroup, de: raw.profileDe as ProfileGroup },
      hero: { en: raw.heroEn as HeroGroup, de: raw.heroDe as HeroGroup },
      nav: { en: raw.navEn as NavGroup, de: raw.navDe as NavGroup },
    };
    const changed = Object.entries(this.trace())
      .filter(([, state]) => state === "unsaved")
      .map(([key]) => key);

    const result = await this.api.saveHero({
      profile: { ...identity, avatarId: this.avatarId() },
      ui: value,
      updatedAt: this.uiUpdatedAt,
      profileUpdatedAt: this.profileUpdatedAt,
    });
    this.saving.set(false);

    if (!result.ok) {
      if (result.status === 409) {
        await this.afterConflict(retried);
      } else if (result.issues?.length) {
        this.showIssues(result.issues);
      } else {
        toastNotSaved(result.error, "Save failed");
      }
      return;
    }

    this.uiUpdatedAt = result.data.updatedAt;
    this.profileUpdatedAt = result.data.profileUpdatedAt;
    this.pristine = {
      identity,
      avatar: { id: this.avatarId(), path: this.avatarPath() },
      ...value,
    };
    this.identity.patchValue({ locationCountry: identity.locationCountry }, { emitEvent: false });
    this.form.markAsPristine();
    this.identity.markAsPristine();
    this.baseline = this.snapshot();
    this.markSaved(changed);
    this.revision.update((v) => v + 1);
  }

  /**
   * A 409 can come from another group of the `ui` document: its one version moves for all of
   * them. Nothing of this page changed there, and the identity row's own version did not move:
   * save again on the new version. Otherwise ask, with the edits kept.
   */
  private async afterConflict(retried: boolean): Promise<void> {
    const saved = this.pristine;
    if (!saved) return;
    const [latest, profile] = await Promise.all([
      this.ui.latest({ profile: saved.profile, hero: saved.hero, nav: saved.nav }),
      this.api.getProfile(),
    ]);
    const identityAt = profile.ok ? profile.data.profile.updatedAt : null;
    if (latest?.unchanged && identityAt === this.profileUpdatedAt && !retried) {
      this.uiUpdatedAt = latest.updatedAt;
      return this.saveHero(true);
    }
    if (await askStale(this.confirm, "This page")) return this.reload();
    if (latest) this.uiUpdatedAt = latest.updatedAt;
    if (identityAt) this.profileUpdatedAt = identityAt;
  }

  /** `profile.<field>` → an identity control; `ui.<group>.<locale>.<field>` → a copy control. */
  private showIssues(issues: ApiIssue[]): void {
    // A refused label opens the labels first: helm's input marks a field invalid from the status
    // changes it sees, so the problems go on once the fields exist.
    const label = issues.some(({ path: [part, group] }) => part === "ui" && group !== "profile");
    if (label && !this.labelsOpen()) {
      this.labelsOpen.set(true);
      if (!this.gone) afterNextRender(() => this.showIssues(issues), { injector: this.injector });
      return;
    }
    const unplaced = applyIssues(issues, (path) => {
      const [part, group, locale, key] = path;
      if (part === "profile" && typeof group === "string") {
        return (this.identity.controls as Record<string, AbstractControl>)[group] ?? null;
      }
      if (part === "ui" && isLocale(locale) && typeof key === "string") {
        const name = `${String(group)}${locale === "en" ? "En" : "De"}`;
        const controls = this.form.controls as Record<string, FormGroup | undefined>;
        return controls[name]?.controls[key] ?? null;
      }
      return null;
    });
    this.revision.update((v) => v + 1);
    // One language at a time on a narrow editor: the one with the problem.
    const shown = this.shownView();
    const hidden = issues
      .map((i) => i.path[2])
      .find((l): l is Locale => isLocale(l) && shown !== "both" && l !== shown);
    if (hidden) this.view.set(this.wide() ? "both" : hidden);
    toastIssues(unplaced.length ? unplaced : issues);
    focusFirstInvalid(this.host.nativeElement);
  }

  protected identityControl(key: IdentityKey): FormControl<string> {
    return this.identity.controls[key] as FormControl<string>;
  }

  protected identityIssue(key: IdentityKey): string | null {
    this.revision();
    return (this.identity.controls[key].errors?.["server"] as string | undefined) ?? null;
  }

  /** After Reload at "Saved elsewhere", or a load that failed: the stored version, replacing any edits here. */
  protected async reload(): Promise<void> {
    this.loading.set(true);
    await this.load();
  }

  protected readonly trackRow = (row: SocialRow): string => row.id;

  protected patch(id: string, change: Partial<SocialInput>): void {
    this.rows.update((list) => list.map((r) => (r.id === id ? { ...r, ...change } : r)));
    for (const key of Object.keys(change)) this.issues.resolve(`${id}.${key}`);
  }

  /** Every changed link. One that fails keeps its edits and says why. */
  private async saveLinks(): Promise<void> {
    const changedRows = this.rows().filter((row) => this.changedIds().has(row.id));
    const ids = changedRows.map((row) => row.id);
    if (!(await this.versions.mayOverwrite(ids, "A link on this page"))) return;
    this.saving.set(true);
    const results = await Promise.all(
      changedRows.map(async (row) => ({
        row,
        result: await this.api.updateSocial(row.id, toInput(row)),
      })),
    );
    if (ids.length) await this.versions.refresh();

    const failed: ApiIssue[] = [];
    let error = "";
    const done: string[] = [];
    this.savedRows.update((savedMap) => {
      const next = new Map(savedMap);
      for (const { row, result } of results) {
        if (result.ok) {
          next.set(row.id, structuredClone(row));
          done.push(`link-${row.id}`);
        } else if (result.issues?.length) {
          failed.push(...result.issues.map((i) => ({ ...i, path: [row.id, ...i.path] })));
        } else {
          error = result.error;
        }
      }
      return next;
    });
    this.markSaved(done);
    this.saving.set(false);

    if (failed.length > 0) {
      this.issues.set(failed);
      toastIssues(failed);
      focusFirstInvalid(this.host.nativeElement);
    } else if (error) {
      toastNotSaved(error);
    } else {
      this.issues.clear();
    }
  }

  /** Saved at once, with the defaults the server needs (the icon is hidden); its label takes the focus. */
  protected async add(): Promise<void> {
    const result = await this.api.createSocial({
      label: "New link",
      href: "https://example.com",
      icon: "github",
      isVisible: true,
    });
    if (!result.ok) {
      toastNotSaved(result.error, "Could not add");
      return;
    }
    const social = result.data.social;
    this.rows.update((list) => [...list, social]);
    this.savedRows.update((map) => new Map(map).set(social.id, structuredClone(social)));
    this.markSaved([`link-${social.id}`]);
    setTimeout(() => {
      const labels = this.host.nativeElement.querySelectorAll<HTMLInputElement>(
        "#profile-links input[aria-label='Link label']",
      );
      labels[labels.length - 1]?.select();
    });
  }

  /** Deleted on the server at once, so it asks by name first; the focus goes to the list's heading. */
  protected async remove(row: SocialRow): Promise<void> {
    const go = await this.confirm.ask({
      title: `Delete ${row.label}?`,
      description:
        "It leaves the footer, the contact section and the structured data at the next publish. This cannot be undone.",
      confirmLabel: "Delete link",
      destructive: true,
    });
    if (!go) return;

    const previous = this.rows();
    this.rows.update((list) => list.filter((r) => r.id !== row.id));
    this.host.nativeElement.querySelector<HTMLElement>("#profile-links-title")?.focus();

    const result = await this.api.deleteSocial(row.id);
    if (!result.ok) {
      this.rows.set(previous);
      toastNotSaved(result.error, "Could not delete");
      return;
    }
    this.issues.resolve(row.id);
    this.savedRows.update((map) => {
      const next = new Map(map);
      next.delete(row.id);
      return next;
    });
  }

  /** Saved at once: a reorder is reversible by another. */
  protected async onReorder(next: SocialRow[]): Promise<void> {
    const previous = this.rows();
    this.rows.set(next);
    const result = await this.api.reorder(
      "socials",
      next.map((r) => r.id),
    );
    if (!result.ok) {
      this.rows.set(previous);
      toastNotSaved(result.error, "Could not reorder");
      return;
    }
    // A reorder is an edit to every row, so it moves their versions.
    void this.versions.refresh();
  }
}

/** A group's keys, every one (hidden ones too): the form holds them all, and saves them. */
function blank(group: CopyGroup): Record<string, string> {
  const fields = [...ABOUT_YOU, ...HERO_COPY, ...LABELS].filter((f) => f.group === group);
  return Object.fromEntries(fields.map((f) => [f.key, ""]));
}
