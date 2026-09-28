import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  ElementRef,
  inject,
  OnInit,
  signal,
} from "@angular/core";
import type { RouteMeta } from "@analogjs/router";
import {
  FormBuilder,
  FormControl,
  ReactiveFormsModule,
  type AbstractControl,
  type FormGroup,
} from "@angular/forms";
import { toast } from "@spartan-ng/brain/sonner";
import { HlmField, HlmFieldLabel } from "@spartan-ng/helm/field";
import { HlmInput } from "@spartan-ng/helm/input";
import { HlmSeparator } from "@spartan-ng/helm/separator";

import {
  AdminApiService,
  type ApiIssue,
  type MediaAsset,
  type ProfileInput,
  type ResumeRow,
} from "../../admin/admin-api.service";
import { countChangedFields } from "../../admin/changed-fields";
import { EditorLayoutComponent } from "../../admin/components/editor-layout.component";
import { hasText, type OutlineItem } from "../../admin/editor-outline";
import { applyIssues, countServerErrors, focusFirstInvalid } from "../../admin/issues";
import { withIdentity, withUi, type LiveCompose } from "../../admin/preview/live-content";
import { LivePreviewToggleComponent } from "../../admin/preview/live-preview-toggle.component";
import { toastIssues, toastStale } from "../../admin/save-feedback";
import { UnsavedChangesService, unsavedChangesGuard } from "../../admin/unsaved-changes.service";
import {
  FieldIssueComponent,
  SaveBarComponent,
} from "../../admin/components/editor-chrome.component";
import { FieldPairComponent, type LocaleView } from "../../admin/components/field-pair.component";
import {
  FormSkeletonComponent,
  LoadErrorComponent,
} from "../../admin/components/load-state.component";
import { MediaFieldComponent } from "../../admin/components/media-field.component";
import { AdminPageHeaderComponent } from "../../admin/components/page-header.component";
import { UiSectionService } from "../../admin/ui-section.service";
import { isLocale } from "../../content/locale";
import type { AppTranslations, Availability, Locale } from "../../content/schema";

type ProfileGroup = AppTranslations["profile"];
type NavGroup = AppTranslations["nav"];
type HeroGroup = AppTranslations["hero"];

interface Field<K extends string> {
  key: K;
  label: string;
  multiline?: boolean;
  hint?: string;
}

const PROFILE_FIELDS: Field<keyof ProfileGroup>[] = [
  { key: "role", label: "Role", hint: "Shown next to your handle and in the footer." },
  { key: "heroHeadline", label: "Hero headline", multiline: true },
  { key: "heroSubheadline", label: "Hero subheadline", multiline: true },
  { key: "primaryCta", label: "Primary button label" },
  { key: "secondaryCta", label: "Secondary button label" },
  { key: "location", label: "Location", hint: "Rendered in the footer." },
];

const HERO_FIELDS: Field<keyof HeroGroup>[] = [
  { key: "availabilityOpen", label: "Availability — open" },
  { key: "availabilityLimited", label: "Availability — limited" },
  { key: "availabilityClosed", label: "Availability — closed" },
  { key: "downloadCv", label: "CV button label" },
  { key: "askCta", label: "Ask-my-portfolio button label" },
];

const NAV_FIELDS: Field<keyof NavGroup>[] = [
  { key: "skills", label: "Nav — skills" },
  { key: "projects", label: "Nav — projects" },
  { key: "about", label: "Nav — about" },
  { key: "contact", label: "Nav — contact" },
  { key: "work", label: "Nav — work (case studies)" },
  { key: "experience", label: "Nav — experience" },
  { key: "writing", label: "Nav — writing" },
];

type IdentityKey = Exclude<keyof ProfileInput, "avatarId" | "availability">;

const IDENTITY_FIELDS: {
  key: IdentityKey;
  label: string;
  type?: string;
  placeholder?: string;
  maxLength?: number;
}[] = [
  { key: "name", label: "Name" },
  { key: "handle", label: "Handle" },
  { key: "contactEmail", label: "Contact email", type: "email" },
  { key: "siteUrl", label: "Site address", placeholder: "https://alirezarastineh.me" },
  { key: "primaryCtaHref", label: "Primary button link" },
  { key: "secondaryCtaHref", label: "Secondary button link" },
  // The availability select renders just before the time zone.
  { key: "timezone", label: "Time zone", placeholder: "Europe/Berlin" },
  { key: "locationCity", label: "City", placeholder: "Berlin" },
  { key: "locationCountry", label: "Country code", placeholder: "DE", maxLength: 2 },
];

const AVAILABILITY: { value: Availability; label: string }[] = [
  { value: "open", label: "Open to new roles" },
  { value: "limited", label: "Limited availability" },
  { value: "closed", label: "Not available" },
];

export const routeMeta: RouteMeta = { canDeactivate: [unsavedChangesGuard] };

@Component({
  selector: "app-admin-hero",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    AdminPageHeaderComponent,
    EditorLayoutComponent,
    FieldIssueComponent,
    FieldPairComponent,
    FormSkeletonComponent,
    HlmField,
    HlmFieldLabel,
    HlmInput,
    HlmSeparator,
    LivePreviewToggleComponent,
    LoadErrorComponent,
    MediaFieldComponent,
    ReactiveFormsModule,
    SaveBarComponent,
  ],
  host: { class: "block" },
  template: `
    <app-editor-layout
      anchor="hero"
      [compose]="livePreview()"
      [outline]="outline()"
      [view]="view()"
    >
      <div class="flex flex-col gap-6 pb-24">
        <app-page-header
          title="Hero & identity"
          description="Who you are, where, whether you are available, plus the headline, button labels and navigation wording."
          preview="/admin/preview/en"
          [(view)]="view"
        >
          <app-live-preview-toggle headerActions />
        </app-page-header>

        @if (loading()) {
          <app-form-skeleton [rows]="6" />
        } @else if (!loaded()) {
          <app-load-error (retry)="reload()" />
        } @else {
          <section
            id="hero-identity"
            aria-labelledby="hero-identity-title"
            class="flex flex-col gap-4"
          >
            <h2 id="hero-identity-title" class="m-0 text-h4">Identity</h2>
            <p class="m-0 -mt-3 text-sm text-muted-foreground">
              Not translated: the same in both languages.
            </p>
            <form [formGroup]="identity" class="grid gap-4 sm:grid-cols-2">
              @for (field of identityFields; track field.key) {
                @if (field.key === "timezone") {
                  <div hlmField>
                    <label hlmFieldLabel for="availability">Availability</label>
                    <select
                      id="availability"
                      formControlName="availability"
                      class="h-9 rounded-md border border-border bg-card px-2 text-sm"
                    >
                      @for (option of availability; track option.value) {
                        <option [value]="option.value">{{ option.label }}</option>
                      }
                    </select>
                  </div>
                }
                <div hlmField>
                  <label hlmFieldLabel [for]="field.key">{{ field.label }}</label>
                  <input
                    hlmInput
                    [id]="field.key"
                    [type]="field.type ?? 'text'"
                    [formControlName]="field.key"
                    [placeholder]="field.placeholder ?? ''"
                    [attr.maxlength]="field.maxLength ?? null"
                    [class.uppercase]="field.key === 'locationCountry'"
                    [attr.aria-invalid]="identityIssue(field.key) ? true : null"
                    [attr.aria-describedby]="identityIssue(field.key) ? field.key + '-issue' : null"
                  />
                  <app-field-issue
                    [id]="field.key + '-issue'"
                    [message]="identityIssue(field.key)"
                  />
                </div>
              }
            </form>

            <app-media-field
              id="avatar"
              label="Photo"
              hint="Optional; shown in the hero and in the structured data."
              [path]="avatarPath()"
              (chosen)="chooseAvatar($event)"
            />
          </section>

          <hlm-separator />

          <section id="hero-cv" aria-labelledby="hero-cv-title" class="flex flex-col gap-4">
            <h2 id="hero-cv-title" class="m-0 text-h4">CV</h2>
            <p class="m-0 -mt-3 text-sm text-muted-foreground">
              A PDF per language, behind the "Download CV" button. Saved immediately; live after the
              next publish.
            </p>
            <div class="grid gap-4 sm:grid-cols-2">
              @for (locale of locales; track locale) {
                <app-media-field
                  [id]="'cv-' + locale"
                  [label]="'CV (' + locale.toUpperCase() + ')'"
                  kind="document"
                  [path]="resumes()[locale]?.path ?? null"
                  [caption]="resumes()[locale]?.originalName ?? ''"
                  (chosen)="chooseResume(locale, $event)"
                />
              }
            </div>
          </section>

          <hlm-separator />

          <section id="hero-copy" aria-labelledby="hero-copy-title" class="flex flex-col gap-6">
            <h2 id="hero-copy-title" class="m-0 text-h4">Hero copy</h2>
            <div class="flex flex-col gap-6">
              @for (field of profileFields; track field.key) {
                <app-field-pair
                  [id]="'profile-' + field.key"
                  [label]="field.label"
                  [hint]="field.hint ?? ''"
                  [multiline]="field.multiline ?? false"
                  [rows]="2"
                  [view]="view()"
                  [controlEn]="control('profile', 'en', field.key)"
                  [controlDe]="control('profile', 'de', field.key)"
                />
              }

              @for (field of heroFields; track field.key) {
                <app-field-pair
                  [id]="'hero-' + field.key"
                  [label]="field.label"
                  [view]="view()"
                  [controlEn]="control('hero', 'en', field.key)"
                  [controlDe]="control('hero', 'de', field.key)"
                />
              }
            </div>
          </section>

          <hlm-separator />

          <section id="hero-nav" aria-labelledby="hero-nav-title" class="flex flex-col gap-6">
            <h2 id="hero-nav-title" class="m-0 text-h4">Navigation labels</h2>
            @for (field of navFields; track field.key) {
              <app-field-pair
                [id]="'nav-' + field.key"
                [label]="field.label"
                [view]="view()"
                [controlEn]="control('nav', 'en', field.key)"
                [controlDe]="control('nav', 'de', field.key)"
              />
            }
          </section>

          <app-save-bar
            [dirty]="dirty()"
            [saving]="saving()"
            [problems]="problems()"
            [changes]="changes()"
            previewHref="/admin/preview/en"
            (save)="save()"
            (discard)="discard()"
          />
        }
      </div>
    </app-editor-layout>
  `,
})
export default class AdminHeroPage implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly api = inject(AdminApiService);
  private readonly ui = inject(UiSectionService);
  private readonly unsaved = inject(UnsavedChangesService);

  private readonly host = inject(ElementRef<HTMLElement>);

  protected readonly identityFields = IDENTITY_FIELDS;
  protected readonly profileFields = PROFILE_FIELDS;
  protected readonly heroFields = HERO_FIELDS;
  protected readonly navFields = NAV_FIELDS;
  protected readonly availability = AVAILABILITY;
  protected readonly locales: Locale[] = ["en", "de"];
  protected readonly view = signal<LocaleView>("both");

  protected readonly loading = signal(true);
  protected readonly loaded = signal(false);
  protected readonly saving = signal(false);
  private readonly revision = signal(0);

  protected readonly avatarId = signal<string | null>(null);
  protected readonly avatarPath = signal<string | null>(null);
  protected readonly resumes = signal<Record<Locale, ResumeRow | null>>({ en: null, de: null });

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
    profileEn: this.fb.nonNullable.group(blank(PROFILE_FIELDS)),
    profileDe: this.fb.nonNullable.group(blank(PROFILE_FIELDS)),
    heroEn: this.fb.nonNullable.group(blank(HERO_FIELDS)),
    heroDe: this.fb.nonNullable.group(blank(HERO_FIELDS)),
    navEn: this.fb.nonNullable.group(blank(NAV_FIELDS)),
    navDe: this.fb.nonNullable.group(blank(NAV_FIELDS)),
  });

  /** The fields as loaded or last saved, in the forms' own shape: what "changed" compares with. */
  private baseline: object | null = null;

  private snapshot(): object {
    return {
      identity: this.identity.getRawValue(),
      copy: this.form.getRawValue(),
      avatarId: this.avatarId(),
    };
  }

  /** Fields that differ from the saved ones: typing a value back is no change. */
  protected readonly changes = computed(() => {
    this.revision();
    return this.baseline ? countChangedFields(this.baseline, this.snapshot()) : 0;
  });

  protected readonly dirty = computed(() => this.changes() > 0);

  protected readonly problems = computed(() => {
    this.revision();
    return countServerErrors(this.form) + countServerErrors(this.identity);
  });

  /** The page's four sections for the rail: filled in, and the last save's problems in each. */
  protected readonly outline = computed<OutlineItem[]>(() => {
    this.revision();
    if (!this.loaded()) return [];
    const who = this.identity.getRawValue();
    const copy = this.form.controls;
    const filled = (groups: FormGroup[]) =>
      groups.every((group) =>
        Object.values(group.getRawValue() as Record<string, string>).every(hasText),
      );
    const state = (done: boolean): OutlineItem["state"] => (done ? "done" : "todo");
    const resumes = this.resumes();
    return [
      {
        id: "hero-identity",
        label: "Identity",
        state: state(
          [
            who.name,
            who.handle,
            who.contactEmail,
            who.timezone,
            who.locationCity,
            who.locationCountry,
          ].every((value) => value.trim() !== ""),
        ),
        problems: countServerErrors(this.identity),
      },
      {
        id: "hero-cv",
        label: "CV",
        state: state(!!resumes.en && !!resumes.de),
        problems: 0,
      },
      {
        id: "hero-copy",
        label: "Hero copy",
        state: state(filled([copy.profileEn, copy.profileDe, copy.heroEn, copy.heroDe])),
        problems: [copy.profileEn, copy.profileDe, copy.heroEn, copy.heroDe].reduce(
          (sum, group) => sum + countServerErrors(group),
          0,
        ),
      },
      {
        id: "hero-nav",
        label: "Navigation labels",
        state: state(filled([copy.navEn, copy.navDe])),
        problems: countServerErrors(copy.navEn) + countServerErrors(copy.navDe),
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
    const bump = () => {
      this.revision.update((v) => v + 1);
      this.unsaved.set("hero", this.dirty());
    };
    this.form.valueChanges.subscribe(bump);
    this.identity.valueChanges.subscribe(bump);
    inject(DestroyRef).onDestroy(() => this.unsaved.clear("hero"));
  }

  ngOnInit(): void {
    void this.load();
  }

  protected control(
    group: "profile" | "hero" | "nav",
    locale: Locale,
    key: string,
  ): FormControl<string> {
    const name = `${group}${locale === "en" ? "En" : "De"}` as keyof typeof this.form.controls;
    return (this.form.controls[name].controls as Record<string, FormControl<string>>)[key]!;
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
    this.unsaved.clear("hero");
  }

  protected discard(): void {
    this.applyPristine();
  }

  protected chooseAvatar(asset: MediaAsset | null): void {
    this.avatarId.set(asset?.id ?? null);
    this.avatarPath.set(asset?.path ?? null);
    this.revision.update((v) => v + 1);
    this.unsaved.set("hero", this.dirty());
  }

  /** CVs point at media; changing one is saved at once and goes live with the next publish. */
  protected async chooseResume(locale: Locale, asset: MediaAsset | null): Promise<void> {
    const result = asset
      ? await this.api.putResume(locale, asset.id)
      : await this.api.deleteResume(locale);
    if (!result.ok) {
      toast.error("CV not saved", { description: result.error });
      return;
    }
    const refreshed = await this.api.getResumes();
    if (refreshed.ok) this.resumes.set(refreshed.data.resumes);
    toast.success(
      asset ? `CV (${locale.toUpperCase()}) set` : `CV (${locale.toUpperCase()}) removed`,
    );
  }

  /** Identity and copy in one request, so the page is never left half-saved. */
  protected async save(): Promise<void> {
    if (this.saving()) return;
    this.saving.set(true);

    const raw = this.form.getRawValue();
    const typed = this.identity.getRawValue();
    const identity = { ...typed, locationCountry: typed.locationCountry.trim().toUpperCase() };
    const value = {
      profile: { en: raw.profileEn as ProfileGroup, de: raw.profileDe as ProfileGroup },
      hero: { en: raw.heroEn as HeroGroup, de: raw.heroDe as HeroGroup },
      nav: { en: raw.navEn as NavGroup, de: raw.navDe as NavGroup },
    };

    const result = await this.api.saveHero({
      profile: { ...identity, avatarId: this.avatarId() },
      ui: value,
      updatedAt: this.uiUpdatedAt,
      profileUpdatedAt: this.profileUpdatedAt,
    });
    this.saving.set(false);

    if (!result.ok) {
      if (result.status === 409) {
        toastStale(() => this.reload(), "This page");
      } else if (result.issues?.length) {
        this.showIssues(result.issues);
      } else {
        toast.error("Save failed", { description: result.error });
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
    this.revision.update((v) => v + 1);
    this.unsaved.clear("hero");
    toast.success("Draft saved");
  }

  /** `profile.<field>` → an identity control; `ui.<group>.<locale>.<field>` → a copy control. */
  private showIssues(issues: ApiIssue[]): void {
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
    const view = this.view();
    if (view !== "both" && issues.some((i) => isLocale(i.path[2]) && i.path[2] !== view)) {
      this.view.set("both");
    }
    toastIssues(unplaced.length ? unplaced : issues);
    focusFirstInvalid(this.host.nativeElement);
  }

  protected identityIssue(key: IdentityKey): string | null {
    this.revision();
    return (this.identity.controls[key].errors?.["server"] as string | undefined) ?? null;
  }

  /** After "Saved elsewhere", or a load that failed: the stored version, replacing any edits here. */
  protected async reload(): Promise<void> {
    this.loading.set(true);
    await this.load();
  }
}

function blank(fields: { key: string }[]): Record<string, string> {
  return Object.fromEntries(fields.map((f) => [f.key, ""]));
}
