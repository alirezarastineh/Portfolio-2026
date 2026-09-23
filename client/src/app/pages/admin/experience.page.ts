import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { NgIcon, provideIcons } from "@ng-icons/core";
import { lucidePencil, lucidePlus, lucideTrash2 } from "@ng-icons/lucide";
import { toast } from "@spartan-ng/brain/sonner";
import { HlmBadge } from "@spartan-ng/helm/badge";
import { HlmButton } from "@spartan-ng/helm/button";
import { HlmField, HlmFieldLabel } from "@spartan-ng/helm/field";
import { HlmInput } from "@spartan-ng/helm/input";
import { HlmSeparator } from "@spartan-ng/helm/separator";
import { HlmSheetImports } from "@spartan-ng/helm/sheet";
import { HlmSkeleton } from "@spartan-ng/helm/skeleton";
import { HlmSwitch } from "@spartan-ng/helm/switch";
import { HlmTextarea } from "@spartan-ng/helm/textarea";

import {
  AdminApiService,
  type ExperienceInput,
  type ExperienceRow,
  type MediaAsset,
} from "../../admin/admin-api.service";
import { ConfirmService } from "../../admin/components/confirm-dialog.component";
import { MediaFieldComponent } from "../../admin/components/media-field.component";
import {
  SortableListComponent,
  SortableRowDirective,
} from "../../admin/components/sortable-list.component";
import { StringListComponent } from "../../admin/components/string-list.component";
import {
  UiGroupEditorComponent,
  type UiFieldDef,
} from "../../admin/components/ui-group-editor.component";
import type { Locale } from "../../content/schema";

const COPY_FIELDS: UiFieldDef[] = [
  { key: "heading", label: "Section heading" },
  { key: "subtitle", label: "Section subtitle" },
  { key: "work", label: "Group — work" },
  { key: "education", label: "Group — education" },
  { key: "certifications", label: "Group — certifications" },
  { key: "present", label: "“Present” (an open end date)" },
  { key: "credential", label: "Credential link label" },
  { key: "years", label: "Years (keep {n})" },
  { key: "months", label: "Months (keep {n})" },
  { key: "fullTime", label: "Full-time" },
  { key: "partTime", label: "Part-time" },
  { key: "contract", label: "Contract" },
  { key: "freelance", label: "Freelance" },
  { key: "internship", label: "Internship" },
];

const KINDS: { value: ExperienceInput["kind"]; label: string }[] = [
  { value: "work", label: "Work" },
  { value: "education", label: "Education" },
  { value: "certification", label: "Certification" },
];

const EMPLOYMENT: { value: ExperienceInput["employmentType"]; label: string }[] = [
  { value: "", label: "—" },
  { value: "full-time", label: "Full-time" },
  { value: "part-time", label: "Part-time" },
  { value: "contract", label: "Contract" },
  { value: "freelance", label: "Freelance" },
  { value: "internship", label: "Internship" },
];

/** What the sheet edits: the input plus, for an existing entry, its id and logo preview. */
type Draft = ExperienceInput & { id: string | null; logoPath: string | null };

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

@Component({
  selector: "app-admin-experience",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    HlmBadge,
    HlmButton,
    HlmField,
    HlmFieldLabel,
    HlmInput,
    HlmSeparator,
    HlmSheetImports,
    HlmSkeleton,
    HlmSwitch,
    HlmTextarea,
    MediaFieldComponent,
    NgIcon,
    SortableListComponent,
    SortableRowDirective,
    StringListComponent,
    UiGroupEditorComponent,
  ],
  viewProviders: [provideIcons({ lucidePencil, lucidePlus, lucideTrash2 })],
  host: { class: "block" },
  template: `
    <div class="mx-auto flex max-w-4xl flex-col gap-6 pb-12">
      <header class="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 class="m-0 font-mono text-2xl tracking-tight">Experience</h1>
          <p class="mt-1 text-sm text-muted-foreground">
            Work, education and certifications for the timeline. Drag to reorder — saved
            immediately; the site shows them after the next publish.
          </p>
        </div>
        <button hlmBtn variant="outline" (click)="edit(null)">
          <ng-icon name="lucidePlus" size="14" aria-hidden="true" />
          <span class="ml-1.5">Add entry</span>
        </button>
      </header>

      @if (loading()) {
        <hlm-skeleton class="h-64 w-full" />
      } @else {
        <app-sortable-list
          [items]="rows()"
          [trackBy]="trackRow"
          label="experience entry"
          emptyText="No entries yet."
          (reordered)="onReorder($event)"
        >
          <ng-template appSortableRow let-row>
            <div class="flex flex-wrap items-center gap-3">
              <div class="min-w-0 flex-1">
                <p class="m-0 truncate font-mono text-sm">
                  {{ row.translations.en.title || "(untitled)" }} · {{ row.orgName }}
                </p>
                <p class="m-0 mt-0.5 font-mono text-[0.72rem] text-muted-foreground">
                  {{ row.startDate }} – {{ row.endDate ?? "present" }}
                </p>
              </div>
              <span hlmBadge variant="outline" class="font-mono text-[0.65rem]">{{
                row.kind
              }}</span>
              <label class="flex items-center gap-2 font-mono text-[0.72rem] text-muted-foreground">
                <hlm-switch
                  [checked]="row.isVisible"
                  (checkedChange)="toggleVisible(row, $event)"
                />
                <span>{{ row.isVisible ? "shown" : "hidden" }}</span>
              </label>
              <button hlmBtn variant="outline" size="sm" (click)="edit(row)">
                <ng-icon name="lucidePencil" size="14" aria-hidden="true" />
                <span class="ml-1.5">Edit</span>
              </button>
              <button
                hlmBtn
                variant="ghost"
                size="sm"
                class="text-muted-foreground hover:text-destructive"
                [attr.aria-label]="'Delete ' + row.orgName"
                (click)="remove(row)"
              >
                <ng-icon name="lucideTrash2" size="14" aria-hidden="true" />
              </button>
            </div>
          </ng-template>
        </app-sortable-list>
      }

      <hlm-separator />
    </div>

    <app-ui-group-editor
      group="experience"
      title="Timeline copy"
      description="The section's heading and the labels around each entry."
      [fields]="copyFields"
    />

    <hlm-sheet side="right" [state]="draft() ? 'open' : 'closed'" (stateChanged)="onSheet($event)">
      <hlm-sheet-content *hlmSheetPortal="let ctx" class="w-full overflow-y-auto sm:max-w-2xl">
        @if (draft(); as d) {
          <hlm-sheet-header>
            <h2 hlmSheetTitle>{{ d.id ? "Edit entry" : "New entry" }}</h2>
            <p hlmSheetDescription>Saved to the draft; publish from the dashboard.</p>
          </hlm-sheet-header>
          <form class="flex flex-col gap-4 px-4 pb-6" (ngSubmit)="save()">
            <div class="grid gap-4 sm:grid-cols-2">
              <div hlmField>
                <label hlmFieldLabel for="exp-kind">Kind</label>
                <select
                  id="exp-kind"
                  name="kind"
                  class="h-9 rounded-md border border-border bg-card px-2 text-sm"
                  [ngModel]="d.kind"
                  (ngModelChange)="patch({ kind: $event })"
                >
                  @for (kind of kinds; track kind.value) {
                    <option [value]="kind.value">{{ kind.label }}</option>
                  }
                </select>
              </div>
              <div hlmField>
                <label hlmFieldLabel for="exp-type">Employment</label>
                <select
                  id="exp-type"
                  name="employmentType"
                  class="h-9 rounded-md border border-border bg-card px-2 text-sm"
                  [ngModel]="d.employmentType"
                  (ngModelChange)="patch({ employmentType: $event })"
                >
                  @for (type of employment; track type.value) {
                    <option [value]="type.value">{{ type.label }}</option>
                  }
                </select>
              </div>
              <div hlmField>
                <label hlmFieldLabel for="exp-org">Organisation</label>
                <input
                  hlmInput
                  id="exp-org"
                  name="orgName"
                  required
                  [ngModel]="d.orgName"
                  (ngModelChange)="patch({ orgName: $event })"
                />
              </div>
              <div hlmField>
                <label hlmFieldLabel for="exp-url">Organisation URL</label>
                <input
                  hlmInput
                  id="exp-url"
                  name="orgUrl"
                  [ngModel]="d.orgUrl"
                  (ngModelChange)="patch({ orgUrl: $event })"
                />
              </div>
              <div hlmField>
                <label hlmFieldLabel for="exp-start">Start</label>
                <input
                  hlmInput
                  id="exp-start"
                  name="startDate"
                  type="date"
                  required
                  [ngModel]="d.startDate"
                  (ngModelChange)="patch({ startDate: $event })"
                />
              </div>
              <div hlmField>
                <label hlmFieldLabel for="exp-end">End (empty = present)</label>
                <input
                  hlmInput
                  id="exp-end"
                  name="endDate"
                  type="date"
                  [ngModel]="d.endDate ?? ''"
                  (ngModelChange)="patch({ endDate: $event || null })"
                />
              </div>
              <div hlmField>
                <label hlmFieldLabel for="exp-precision">Dates mean</label>
                <select
                  id="exp-precision"
                  name="datePrecision"
                  class="h-9 rounded-md border border-border bg-card px-2 text-sm"
                  [ngModel]="d.datePrecision"
                  (ngModelChange)="patch({ datePrecision: $event })"
                >
                  <option value="month">a month</option>
                  <option value="year">a year only</option>
                </select>
              </div>
              <div hlmField>
                <label hlmFieldLabel for="exp-location">Location</label>
                <input
                  hlmInput
                  id="exp-location"
                  name="location"
                  [ngModel]="d.location"
                  (ngModelChange)="patch({ location: $event })"
                />
              </div>
              <div hlmField>
                <label hlmFieldLabel for="exp-cred-id">Credential ID</label>
                <input
                  hlmInput
                  id="exp-cred-id"
                  name="credentialId"
                  [ngModel]="d.credentialId"
                  (ngModelChange)="patch({ credentialId: $event })"
                />
              </div>
              <div hlmField>
                <label hlmFieldLabel for="exp-cred-url">Credential URL</label>
                <input
                  hlmInput
                  id="exp-cred-url"
                  name="credentialUrl"
                  [ngModel]="d.credentialUrl"
                  (ngModelChange)="patch({ credentialUrl: $event })"
                />
              </div>
            </div>

            <app-media-field
              id="exp-logo"
              label="Logo"
              [path]="d.logoPath"
              (chosen)="chooseLogo($event)"
            />

            <app-string-list
              label="Skills"
              singular="skill"
              emptyText="No skills yet."
              [max]="30"
              [value]="d.skills"
              (valueChange)="patch({ skills: $event })"
            />

            @for (locale of locales; track locale) {
              <hlm-separator />
              <p
                class="m-0 font-mono text-[0.7rem] uppercase tracking-[0.2em] text-muted-foreground"
              >
                {{ locale }}
              </p>
              <div hlmField>
                <label hlmFieldLabel [for]="'exp-title-' + locale">Title</label>
                <input
                  hlmInput
                  [id]="'exp-title-' + locale"
                  [name]="'title-' + locale"
                  required
                  [ngModel]="d.translations[locale].title"
                  (ngModelChange)="patchText(locale, { title: $event })"
                />
              </div>
              <div hlmField>
                <label hlmFieldLabel [for]="'exp-summary-' + locale">Summary</label>
                <textarea
                  hlmTextarea
                  rows="3"
                  [id]="'exp-summary-' + locale"
                  [name]="'summary-' + locale"
                  [ngModel]="d.translations[locale].summary"
                  (ngModelChange)="patchText(locale, { summary: $event })"
                ></textarea>
              </div>
              <app-string-list
                [label]="'Highlights (' + locale + ')'"
                singular="highlight"
                emptyText="No highlights yet."
                [max]="12"
                [value]="d.translations[locale].highlights"
                (valueChange)="patchText(locale, { highlights: $event })"
              />
            }

            <div class="flex justify-end gap-2 pt-2">
              <button hlmBtn variant="ghost" type="button" (click)="draft.set(null)">Cancel</button>
              <button hlmBtn type="submit" [disabled]="saving()">
                {{ d.id ? "Save entry" : "Add entry" }}
              </button>
            </div>
          </form>
        }
      </hlm-sheet-content>
    </hlm-sheet>
  `,
})
export default class AdminExperiencePage implements OnInit {
  private readonly api = inject(AdminApiService);
  private readonly confirm = inject(ConfirmService);

  protected readonly copyFields = COPY_FIELDS;
  protected readonly kinds = KINDS;
  protected readonly employment = EMPLOYMENT;
  protected readonly locales: Locale[] = ["en", "de"];

  protected readonly rows = signal<ExperienceRow[]>([]);
  protected readonly loading = signal(true);
  protected readonly saving = signal(false);
  protected readonly draft = signal<Draft | null>(null);

  protected readonly trackRow = (row: ExperienceRow): string => row.id;

  ngOnInit(): void {
    void this.load();
  }

  private async load(): Promise<void> {
    const result = await this.api.listExperiences();
    this.loading.set(false);
    if (!result.ok) {
      toast.error("Could not load experience", { description: result.error });
      return;
    }
    this.rows.set(result.data.experiences);
  }

  protected edit(row: ExperienceRow | null): void {
    if (!row) {
      this.draft.set(blankDraft());
      return;
    }
    const empty = { title: "", summary: "", highlights: [] as string[] };
    this.draft.set({
      ...structuredClone(row),
      translations: {
        en: row.translations.en ?? { ...empty },
        de: row.translations.de ?? { ...empty },
      },
    });
  }

  protected onSheet(state: string): void {
    if (state !== "open") this.draft.set(null);
  }

  protected patch(change: Partial<Draft>): void {
    this.draft.update((d) => (d ? { ...d, ...change } : d));
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
  }

  protected chooseLogo(asset: MediaAsset | null): void {
    this.patch({ logoId: asset?.id ?? null, logoPath: asset?.path ?? null });
  }

  protected async save(): Promise<void> {
    const d = this.draft();
    if (!d || this.saving()) return;

    const input: ExperienceInput = {
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
        en: {
          ...d.translations.en,
          highlights: d.translations.en.highlights.filter((h) => h.trim() !== ""),
        },
        de: {
          ...d.translations.de,
          highlights: d.translations.de.highlights.filter((h) => h.trim() !== ""),
        },
      },
    };

    this.saving.set(true);
    const result = d.id
      ? await this.api.updateExperience(d.id, input)
      : await this.api.createExperience(input);
    this.saving.set(false);

    if (!result.ok) {
      toast.error("Not saved", {
        description:
          result.error === "invalid_input"
            ? "Check the dates (the end cannot come before the start) and that both titles are filled in."
            : result.error,
      });
      return;
    }
    this.draft.set(null);
    toast.success(d.id ? "Entry saved" : "Entry added");
    await this.load();
  }

  protected async toggleVisible(row: ExperienceRow, isVisible: boolean): Promise<void> {
    const previous = this.rows();
    this.rows.update((list) => list.map((r) => (r.id === row.id ? { ...r, isVisible } : r)));
    const result = await this.api.setVisibility("experiences", row.id, isVisible);
    if (!result.ok) {
      this.rows.set(previous);
      toast.error("Not saved", { description: result.error });
    }
  }

  protected async remove(row: ExperienceRow): Promise<void> {
    const go = await this.confirm.ask({
      title: `Delete ${row.orgName}?`,
      description: "The entry and its text in both languages are deleted. This cannot be undone.",
      confirmLabel: "Delete entry",
      destructive: true,
    });
    if (!go) return;

    const previous = this.rows();
    this.rows.update((list) => list.filter((r) => r.id !== row.id));
    const result = await this.api.deleteExperience(row.id);
    if (!result.ok) {
      this.rows.set(previous);
      toast.error("Could not delete", { description: result.error });
    }
  }

  protected async onReorder(next: ExperienceRow[]): Promise<void> {
    const previous = this.rows();
    this.rows.set(next);
    const result = await this.api.reorder(
      "experiences",
      next.map((r) => r.id),
    );
    if (!result.ok) {
      this.rows.set(previous);
      toast.error("Could not reorder", { description: result.error });
    }
  }
}
