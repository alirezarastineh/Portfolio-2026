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
import { HlmField, HlmFieldLabel } from "@spartan-ng/helm/field";
import { HlmInput } from "@spartan-ng/helm/input";
import { HlmSeparator } from "@spartan-ng/helm/separator";
import { HlmSkeleton } from "@spartan-ng/helm/skeleton";

import {
  AdminApiService,
  type MediaAsset,
  type ProfileInput,
  type ResumeRow,
} from "../../admin/admin-api.service";
import { UnsavedChangesService, unsavedChangesGuard } from "../../admin/unsaved-changes.service";
import {
  LocaleToggleComponent,
  SaveBarComponent,
} from "../../admin/components/editor-chrome.component";
import { FieldPairComponent, type LocaleView } from "../../admin/components/field-pair.component";
import { MediaFieldComponent } from "../../admin/components/media-field.component";
import { UiSectionService } from "../../admin/ui-section.service";
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
    FieldPairComponent,
    HlmField,
    HlmFieldLabel,
    HlmInput,
    HlmSeparator,
    HlmSkeleton,
    LocaleToggleComponent,
    MediaFieldComponent,
    ReactiveFormsModule,
    SaveBarComponent,
  ],
  host: { class: "block" },
  template: `
    <div class="mx-auto flex max-w-4xl flex-col gap-6 pb-24">
      <header class="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 class="m-0 font-mono text-2xl tracking-tight">Hero &amp; identity</h1>
          <p class="mt-1 text-sm text-muted-foreground">
            Who you are, where, whether you are available — plus the headline, button labels and
            navigation wording.
          </p>
        </div>
        <app-locale-toggle [(view)]="view" />
      </header>

      @if (loading()) {
        <hlm-skeleton class="h-96 w-full" />
      } @else if (!loaded()) {
        <p class="text-sm text-muted-foreground">Could not load this section.</p>
      } @else {
        <section class="flex flex-col gap-4">
          <h2 class="m-0 font-mono text-sm uppercase tracking-[0.2em] text-muted-foreground">
            Identity
          </h2>
          <p class="m-0 -mt-2 text-[0.78rem] text-muted-foreground">
            Not translated — the same in both languages.
          </p>
          <form [formGroup]="identity" class="grid gap-4 sm:grid-cols-2">
            <div hlmField>
              <label hlmFieldLabel for="name">Name</label>
              <input hlmInput id="name" formControlName="name" />
            </div>
            <div hlmField>
              <label hlmFieldLabel for="handle">Handle</label>
              <input hlmInput id="handle" formControlName="handle" />
            </div>
            <div hlmField>
              <label hlmFieldLabel for="contactEmail">Contact email</label>
              <input hlmInput id="contactEmail" type="email" formControlName="contactEmail" />
            </div>
            <div hlmField>
              <label hlmFieldLabel for="siteUrl">Site address</label>
              <input
                hlmInput
                id="siteUrl"
                formControlName="siteUrl"
                placeholder="https://alirezarastineh.me"
              />
            </div>
            <div hlmField>
              <label hlmFieldLabel for="primaryCtaHref">Primary button link</label>
              <input hlmInput id="primaryCtaHref" formControlName="primaryCtaHref" />
            </div>
            <div hlmField>
              <label hlmFieldLabel for="secondaryCtaHref">Secondary button link</label>
              <input hlmInput id="secondaryCtaHref" formControlName="secondaryCtaHref" />
            </div>
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
            <div hlmField>
              <label hlmFieldLabel for="timezone">Time zone</label>
              <input
                hlmInput
                id="timezone"
                formControlName="timezone"
                placeholder="Europe/Berlin"
              />
            </div>
            <div hlmField>
              <label hlmFieldLabel for="locationCity">City</label>
              <input
                hlmInput
                id="locationCity"
                formControlName="locationCity"
                placeholder="Berlin"
              />
            </div>
            <div hlmField>
              <label hlmFieldLabel for="locationCountry">Country code</label>
              <input
                hlmInput
                id="locationCountry"
                formControlName="locationCountry"
                placeholder="DE"
                maxlength="2"
                class="uppercase"
              />
            </div>
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

        <section class="flex flex-col gap-4">
          <h2 class="m-0 font-mono text-sm uppercase tracking-[0.2em] text-muted-foreground">CV</h2>
          <p class="m-0 -mt-2 text-[0.78rem] text-muted-foreground">
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

        <section class="flex flex-col gap-6">
          <h2 class="m-0 font-mono text-sm uppercase tracking-[0.2em] text-muted-foreground">
            Hero copy
          </h2>
          <form [formGroup]="form" class="flex flex-col gap-6">
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

            <hlm-separator />
            <h2 class="m-0 font-mono text-sm uppercase tracking-[0.2em] text-muted-foreground">
              Navigation labels
            </h2>

            @for (field of navFields; track field.key) {
              <app-field-pair
                [id]="'nav-' + field.key"
                [label]="field.label"
                [view]="view()"
                [controlEn]="control('nav', 'en', field.key)"
                [controlDe]="control('nav', 'de', field.key)"
              />
            }
          </form>
        </section>

        <app-save-bar [dirty]="dirty()" [saving]="saving()" (save)="save()" (discard)="discard()" />
      }
    </div>
  `,
})
export default class AdminHeroPage implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly api = inject(AdminApiService);
  private readonly ui = inject(UiSectionService);
  private readonly unsaved = inject(UnsavedChangesService);

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

  private uiUpdatedAt: string | null = null;
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

  protected readonly dirty = computed(() => {
    this.revision();
    return (
      this.form.dirty ||
      this.identity.dirty ||
      (this.pristine !== null && this.avatarId() !== this.pristine.avatar.id)
    );
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

    if (!profileResult.ok || !profileGroup || !heroGroup || !navGroup) {
      toast.error("Could not load hero section");
      return;
    }
    if (resumes.ok) this.resumes.set(resumes.data.resumes);

    const p = profileResult.data.profile;
    this.uiUpdatedAt = profileGroup.updatedAt;
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

  protected async save(): Promise<void> {
    if (this.saving()) return;
    this.saving.set(true);

    const raw = this.form.getRawValue();
    const identity = this.identity.getRawValue();
    const value = {
      profile: { en: raw.profileEn as ProfileGroup, de: raw.profileDe as ProfileGroup },
      hero: { en: raw.heroEn as HeroGroup, de: raw.heroDe as HeroGroup },
      nav: { en: raw.navEn as NavGroup, de: raw.navDe as NavGroup },
    };

    // All three groups live in the same document, so each save must use the
    // token the previous one just produced.
    let token = this.uiUpdatedAt;
    for (const group of ["profile", "hero", "nav"] as const) {
      const saved = await this.ui.saveGroup(group, value[group] as never, token);
      if (!saved.ok) {
        this.saving.set(false);
        this.reportSaveFailure(saved.reason);
        return;
      }
      token = saved.updatedAt;
    }

    const identitySave = await this.api.putProfile({
      ...identity,
      locationCountry: identity.locationCountry.trim().toUpperCase(),
      avatarId: this.avatarId(),
    });
    this.saving.set(false);

    if (!identitySave.ok) {
      toast.error("Identity not saved", {
        description:
          identitySave.error === "invalid_input"
            ? "Check the site address (an origin without a path), the country code and the time zone."
            : identitySave.error,
      });
      return;
    }

    this.uiUpdatedAt = token;
    this.pristine = {
      identity: { ...identity, locationCountry: identity.locationCountry.trim().toUpperCase() },
      avatar: { id: this.avatarId(), path: this.avatarPath() },
      ...value,
    };
    this.form.markAsPristine();
    this.identity.markAsPristine();
    this.revision.update((v) => v + 1);
    this.unsaved.clear("hero");
    toast.success("Draft saved");
  }

  private reportSaveFailure(reason: "stale" | "invalid" | "failed"): void {
    if (reason === "stale") {
      toast.error("Saved elsewhere", {
        description: "This section changed in another tab. Reload before saving.",
      });
    } else if (reason === "invalid") {
      toast.error("Check the form", { description: "Some fields are empty or too long." });
    } else {
      toast.error("Save failed");
    }
  }
}

function blank(fields: { key: string }[]): Record<string, string> {
  return Object.fromEntries(fields.map((f) => [f.key, ""]));
}
