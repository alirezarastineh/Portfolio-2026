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

import { AdminApiService, type ProfileInput } from "../../admin/admin-api.service";
import { UnsavedChangesService, unsavedChangesGuard } from "../../admin/unsaved-changes.service";
import {
  LocaleToggleComponent,
  SaveBarComponent,
} from "../../admin/components/editor-chrome.component";
import { FieldPairComponent, type LocaleView } from "../../admin/components/field-pair.component";
import { UiSectionService } from "../../admin/ui-section.service";
import type { AppTranslations, Locale } from "../../content/schema";

type ProfileGroup = AppTranslations["profile"];
type NavGroup = AppTranslations["nav"];

const PROFILE_FIELDS: { key: keyof ProfileGroup; label: string; multiline?: boolean; hint?: string }[] =
  [
    { key: "role", label: "Role", hint: "Shown next to your handle and in the footer." },
    { key: "heroHeadline", label: "Hero headline", multiline: true },
    { key: "heroSubheadline", label: "Hero subheadline", multiline: true },
    { key: "primaryCta", label: "Primary button label" },
    { key: "secondaryCta", label: "Secondary button label" },
    { key: "location", label: "Location", hint: "Rendered in the footer." },
  ];

const NAV_FIELDS: { key: keyof NavGroup; label: string }[] = [
  { key: "skills", label: "Nav — skills" },
  { key: "projects", label: "Nav — projects" },
  { key: "about", label: "Nav — about" },
  { key: "contact", label: "Nav — contact" },
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
            The headline, call-to-action labels and navigation wording.
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
              <label hlmFieldLabel for="primaryCtaHref">Primary button link</label>
              <input hlmInput id="primaryCtaHref" formControlName="primaryCtaHref" />
            </div>
            <div hlmField>
              <label hlmFieldLabel for="secondaryCtaHref">Secondary button link</label>
              <input hlmInput id="secondaryCtaHref" formControlName="secondaryCtaHref" />
            </div>
          </form>
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
                [controlEn]="profileControl('en', field.key)"
                [controlDe]="profileControl('de', field.key)"
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
                [controlEn]="navControl('en', field.key)"
                [controlDe]="navControl('de', field.key)"
              />
            }
          </form>
        </section>

        <app-save-bar
          [dirty]="dirty()"
          [saving]="saving()"
          (save)="save()"
          (discard)="discard()"
        />
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
  protected readonly navFields = NAV_FIELDS;
  protected readonly view = signal<LocaleView>("both");

  protected readonly loading = signal(true);
  protected readonly loaded = signal(false);
  protected readonly saving = signal(false);
  private readonly revision = signal(0);

  private profileUpdatedAt: string | null = null;
  private pristine: {
    identity: ProfileInput;
    profile: Record<Locale, ProfileGroup>;
    nav: Record<Locale, NavGroup>;
  } | null = null;

  protected readonly identity = this.fb.nonNullable.group({
    name: "",
    handle: "",
    contactEmail: "",
    primaryCtaHref: "",
    secondaryCtaHref: "",
  });

  protected readonly form = this.fb.nonNullable.group({
    profileEn: this.fb.nonNullable.group(this.blank(PROFILE_FIELDS)),
    profileDe: this.fb.nonNullable.group(this.blank(PROFILE_FIELDS)),
    navEn: this.fb.nonNullable.group(this.blank(NAV_FIELDS)),
    navDe: this.fb.nonNullable.group(this.blank(NAV_FIELDS)),
  });

  protected readonly dirty = computed(() => {
    this.revision();
    return this.form.dirty || this.identity.dirty;
  });

  constructor() {
    const bump = () => {
      this.revision.update((v) => v + 1);
      this.unsaved.set("hero", this.form.dirty || this.identity.dirty);
    };
    this.form.valueChanges.subscribe(bump);
    this.identity.valueChanges.subscribe(bump);
    inject(DestroyRef).onDestroy(() => this.unsaved.clear("hero"));
  }

  ngOnInit(): void {
    void this.load();
  }

  private blank(fields: { key: string }[]): Record<string, string> {
    return Object.fromEntries(fields.map((f) => [f.key, ""]));
  }

  protected profileControl(locale: Locale, key: keyof ProfileGroup): FormControl<string> {
    const group = locale === "en" ? this.form.controls.profileEn : this.form.controls.profileDe;
    return (group.controls as Record<string, FormControl<string>>)[key];
  }

  protected navControl(locale: Locale, key: keyof NavGroup): FormControl<string> {
    const group = locale === "en" ? this.form.controls.navEn : this.form.controls.navDe;
    return (group.controls as Record<string, FormControl<string>>)[key];
  }

  private async load(): Promise<void> {
    const [profileResult, profileGroup, navGroup] = await Promise.all([
      this.api.getProfile(),
      this.ui.loadGroup("profile"),
      this.ui.loadGroup("nav"),
    ]);
    this.loading.set(false);

    if (!profileResult.ok || !profileGroup || !navGroup) {
      toast.error("Could not load hero section");
      return;
    }

    const p = profileResult.data.profile;
    const identity: ProfileInput = {
      name: p.name,
      handle: p.handle,
      contactEmail: p.contactEmail,
      primaryCtaHref: p.primaryCtaHref,
      secondaryCtaHref: p.secondaryCtaHref,
    };
    this.profileUpdatedAt = profileGroup.updatedAt;
    this.pristine = { identity, profile: profileGroup.value, nav: navGroup.value };

    this.applyPristine();
    this.loaded.set(true);
  }

  private applyPristine(): void {
    if (!this.pristine) return;

    this.identity.reset(this.pristine.identity);
    this.form.reset({
      profileEn: this.pristine.profile.en,
      profileDe: this.pristine.profile.de,
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

  protected async save(): Promise<void> {
    if (this.saving()) return;
    this.saving.set(true);

    const raw = this.form.getRawValue();
    const identity = this.identity.getRawValue();

    const profileSave = await this.ui.saveGroup(
      "profile",
      { en: raw.profileEn as ProfileGroup, de: raw.profileDe as ProfileGroup },
      this.profileUpdatedAt,
    );

    if (!profileSave.ok) {
      this.saving.set(false);
      this.reportSaveFailure(profileSave.reason);
      return;
    }

    // Both groups live in the same document, so the second save must use the
    // token the first one just produced.
    const navSave = await this.ui.saveGroup(
      "nav",
      { en: raw.navEn as NavGroup, de: raw.navDe as NavGroup },
      profileSave.updatedAt,
    );

    if (!navSave.ok) {
      this.saving.set(false);
      this.reportSaveFailure(navSave.reason);
      return;
    }

    const identitySave = await this.api.putProfile(identity);
    this.saving.set(false);

    if (!identitySave.ok) {
      toast.error("Identity not saved", { description: identitySave.error });
      return;
    }

    this.profileUpdatedAt = navSave.updatedAt;
    this.pristine = {
      identity,
      profile: { en: raw.profileEn as ProfileGroup, de: raw.profileDe as ProfileGroup },
      nav: { en: raw.navEn as NavGroup, de: raw.navDe as NavGroup },
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
