import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from "@angular/core";
import type { RouteMeta } from "@analogjs/router";
import { FormsModule } from "@angular/forms";
import { toast } from "@spartan-ng/brain/sonner";
import { NgIcon, provideIcons } from "@ng-icons/core";
import { lucidePlus, lucideTrash2 } from "@ng-icons/lucide";
import { HlmButton } from "@spartan-ng/helm/button";
import { HlmInput } from "@spartan-ng/helm/input";
import { HlmSeparator } from "@spartan-ng/helm/separator";
import { HlmSkeleton } from "@spartan-ng/helm/skeleton";
import { HlmSwitch } from "@spartan-ng/helm/switch";
import { HlmTextarea } from "@spartan-ng/helm/textarea";

import { unsavedChangesGuard } from "../../admin/unsaved-changes.service";

import { AdminApiService, type SkillInput, type SkillRow } from "../../admin/admin-api.service";
import { ICON_KEYS } from "../../icons/icon-registry";
import { ConfirmService } from "../../admin/components/confirm-dialog.component";
import { LocaleToggleComponent } from "../../admin/components/editor-chrome.component";
import type { LocaleView } from "../../admin/components/field-pair.component";
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

/** Any registry key; the capability icons first. */
const ICONS = [
  "cpu",
  "brain-circuit",
  "container",
  "database",
  ...ICON_KEYS.filter((k) => !["cpu", "brain-circuit", "container", "database"].includes(k)),
];
const SPANS: SkillInput["span"][] = ["lg", "tall", "sm"];

const HEADING_FIELDS: UiFieldDef[] = [
  { key: "heading", label: "Section heading" },
  { key: "subtitle", label: "Section subtitle" },
];

export const routeMeta: RouteMeta = { canDeactivate: [unsavedChangesGuard] };

@Component({
  selector: "app-admin-skills",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    HlmButton,
    HlmInput,
    HlmSeparator,
    HlmSkeleton,
    HlmSwitch,
    HlmTextarea,
    LocaleToggleComponent,
    NgIcon,
    SortableListComponent,
    SortableRowDirective,
    StringListComponent,
    UiGroupEditorComponent,
  ],
  viewProviders: [provideIcons({ lucidePlus, lucideTrash2 })],
  host: { class: "block" },
  template: `
    <app-ui-group-editor
      group="skills"
      title="Skills"
      description="Section heading and the bento cards."
      [fields]="headingFields"
    />

    <div class="mx-auto flex max-w-4xl flex-col gap-6 pb-28">
      <hlm-separator />

      <header class="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 class="m-0 font-mono text-lg tracking-tight">Cards</h2>
          <p class="mt-1 text-sm text-muted-foreground">
            Drag to reorder. Card edits save automatically.
          </p>
        </div>
        <div class="flex items-center gap-3">
          <app-locale-toggle [(view)]="view" />
          <button hlmBtn variant="outline" (click)="add()">
            <ng-icon name="lucidePlus" size="14" aria-hidden="true" />
            <span class="ml-1.5">Add card</span>
          </button>
        </div>
      </header>

      @if (loading()) {
        <hlm-skeleton class="h-96 w-full" />
      } @else {
        <app-sortable-list
          [items]="rows()"
          [trackBy]="trackRow"
          label="skill card"
          emptyText="No skill cards yet."
          (reordered)="onReorder($event)"
        >
          <ng-template appSortableRow let-row>
            <div class="flex flex-col gap-4">
              <div class="flex flex-wrap items-center gap-3">
                <code class="rounded bg-muted px-2 py-1 font-mono text-[0.72rem]">{{
                  row.id
                }}</code>
                <select
                  class="h-8 rounded-md border border-border bg-card px-2 font-mono text-[0.75rem]"
                  [ngModel]="row.icon"
                  (ngModelChange)="patch(row.id, { icon: $event })"
                  aria-label="Icon"
                >
                  @for (icon of icons; track icon) {
                    <option [value]="icon">{{ icon }}</option>
                  }
                </select>
                <select
                  class="h-8 rounded-md border border-border bg-card px-2 font-mono text-[0.75rem]"
                  [ngModel]="row.span"
                  (ngModelChange)="patch(row.id, { span: $event })"
                  aria-label="Card size"
                >
                  @for (span of spans; track span) {
                    <option [value]="span">{{ span }}</option>
                  }
                </select>
                <label
                  class="flex items-center gap-2 font-mono text-[0.72rem] text-muted-foreground"
                >
                  <hlm-switch
                    [checked]="row.isVisible"
                    (checkedChange)="patch(row.id, { isVisible: $event })"
                  />
                  <span>{{ row.isVisible ? "shown" : "hidden" }}</span>
                </label>
                <button
                  hlmBtn
                  variant="ghost"
                  size="sm"
                  class="ml-auto text-muted-foreground hover:text-destructive"
                  [attr.aria-label]="'Delete ' + row.id"
                  (click)="remove(row)"
                >
                  <ng-icon name="lucideTrash2" size="14" aria-hidden="true" />
                </button>
              </div>

              <div [class]="view() === 'both' ? 'grid gap-4 lg:grid-cols-2' : 'grid gap-4'">
                @for (locale of visibleLocales(); track locale) {
                  <div class="flex flex-col gap-2 rounded-lg border border-border/60 p-3">
                    <span
                      class="font-mono text-[0.65rem] uppercase tracking-[0.2em] text-muted-foreground"
                    >
                      {{ locale }}
                    </span>
                    <input
                      hlmInput
                      class="h-8"
                      [ngModel]="row.translations[locale].title"
                      (ngModelChange)="patchTranslation(row.id, locale, { title: $event })"
                      [attr.aria-label]="'Title (' + locale + ')'"
                      placeholder="Title"
                    />
                    <input
                      hlmInput
                      class="h-8"
                      [ngModel]="row.translations[locale].caption"
                      (ngModelChange)="patchTranslation(row.id, locale, { caption: $event })"
                      [attr.aria-label]="'Caption (' + locale + ')'"
                      placeholder="// caption"
                    />
                    <textarea
                      hlmTextarea
                      rows="3"
                      [ngModel]="row.translations[locale].narrative"
                      (ngModelChange)="patchTranslation(row.id, locale, { narrative: $event })"
                      [attr.aria-label]="'Narrative (' + locale + ')'"
                      placeholder="Narrative"
                    ></textarea>
                  </div>
                }
              </div>

              <app-string-list
                label="Tech tags"
                singular="tag"
                emptyText="No tags yet."
                [max]="40"
                [value]="row.items"
                (valueChange)="patch(row.id, { items: $event })"
              />
            </div>
          </ng-template>
        </app-sortable-list>
      }
    </div>
  `,
})
export default class AdminSkillsPage implements OnInit {
  private readonly api = inject(AdminApiService);
  private readonly confirm = inject(ConfirmService);

  protected readonly icons = ICONS;
  protected readonly spans = SPANS;
  protected readonly headingFields = HEADING_FIELDS;
  protected readonly view = signal<LocaleView>("both");

  protected readonly rows = signal<SkillRow[]>([]);
  protected readonly loading = signal(true);

  private readonly pending = new Map<string, ReturnType<typeof setTimeout>>();

  ngOnInit(): void {
    void this.load();
  }

  protected readonly trackRow = (row: SkillRow): string => row.id;

  protected visibleLocales(): Locale[] {
    return this.view() === "both" ? ["en", "de"] : [this.view() as Locale];
  }

  private async load(): Promise<void> {
    const result = await this.api.listSkills();
    this.loading.set(false);

    if (!result.ok) {
      toast.error("Could not load skills", { description: result.error });
      return;
    }
    this.rows.set(result.data.skills);
  }

  protected patch(id: string, change: Partial<SkillInput>): void {
    this.rows.update((list) => list.map((r) => (r.id === id ? { ...r, ...change } : r)));
    this.schedule(id);
  }

  protected patchTranslation(
    id: string,
    locale: Locale,
    change: Partial<SkillRow["translations"][Locale]>,
  ): void {
    this.rows.update((list) =>
      list.map((r) =>
        r.id === id
          ? {
              ...r,
              translations: {
                ...r.translations,
                [locale]: { ...r.translations[locale], ...change },
              },
            }
          : r,
      ),
    );
    this.schedule(id);
  }

  /** Debounced so typing a narrative is one request, not one per keystroke. */
  private schedule(id: string): void {
    clearTimeout(this.pending.get(id));
    this.pending.set(
      id,
      setTimeout(() => void this.persist(id), 700),
    );
  }

  private async persist(id: string): Promise<void> {
    const row = this.rows().find((r) => r.id === id);
    if (!row) return;

    const result = await this.api.updateSkill(id, {
      id: row.id,
      icon: row.icon,
      span: row.span,
      items: row.items,
      isVisible: row.isVisible,
      translations: row.translations,
    });

    if (!result.ok) {
      toast.error("Not saved", { description: result.error });
    }
  }

  protected async add(): Promise<void> {
    const id = `skill-${Date.now().toString(36)}`;
    const blank = { title: "New card", caption: "// caption", narrative: "" };

    const result = await this.api.createSkill({
      id,
      icon: "cpu",
      span: "sm",
      items: [],
      isVisible: true,
      translations: { en: { ...blank }, de: { ...blank } },
    });

    if (!result.ok) {
      toast.error("Could not add card", { description: result.error });
      return;
    }
    await this.load();
  }

  protected async remove(row: SkillRow): Promise<void> {
    // Deletion is immediate and has no undo, unlike edits which stay in draft
    // until published — so it always asks first.
    const go = await this.confirm.ask({
      title: `Delete ${row.id}?`,
      description: "Its text in both languages is deleted. This cannot be undone.",
      confirmLabel: "Delete skill card",
      destructive: true,
    });
    if (!go) return;

    const previous = this.rows();
    this.rows.update((list) => list.filter((r) => r.id !== row.id));

    const result = await this.api.deleteSkill(row.id);
    if (!result.ok) {
      this.rows.set(previous);
      toast.error("Could not delete", { description: result.error });
    }
  }

  protected async onReorder(next: SkillRow[]): Promise<void> {
    const previous = this.rows();
    this.rows.set(next);

    const result = await this.api.reorder(
      "skills",
      next.map((r) => r.id),
    );

    if (!result.ok) {
      this.rows.set(previous);
      toast.error("Could not reorder", { description: result.error });
    }
  }
}
