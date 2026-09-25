import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  OnInit,
  signal,
  viewChild,
} from "@angular/core";
import type { RouteMeta } from "@analogjs/router";
import { FormsModule } from "@angular/forms";
import { toast } from "@spartan-ng/brain/sonner";
import { NgIcon, provideIcons } from "@ng-icons/core";
import { lucidePlus, lucideTrash2 } from "@ng-icons/lucide";
import { HlmBadge } from "@spartan-ng/helm/badge";
import { HlmButton } from "@spartan-ng/helm/button";
import { HlmInput } from "@spartan-ng/helm/input";
import { HlmSeparator } from "@spartan-ng/helm/separator";
import { HlmSkeleton } from "@spartan-ng/helm/skeleton";
import { HlmSwitch } from "@spartan-ng/helm/switch";
import { HlmTextarea } from "@spartan-ng/helm/textarea";

import { UnsavedChangesService, unsavedChangesGuard } from "../../admin/unsaved-changes.service";

import {
  AdminApiService,
  type ApiIssue,
  type SkillInput,
  type SkillRow,
} from "../../admin/admin-api.service";
import { ICON_KEYS } from "../../icons/icon-registry";
import { ConfirmService } from "../../admin/components/confirm-dialog.component";
import {
  FieldIssueComponent,
  LocaleToggleComponent,
  SaveBarComponent,
} from "../../admin/components/editor-chrome.component";
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
import { FieldIssues, focusFirstInvalid } from "../../admin/issues";
import { toastIssues } from "../../admin/save-feedback";
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

function toInput(row: SkillRow): SkillInput {
  return {
    id: row.id,
    icon: row.icon,
    span: row.span,
    items: row.items.filter((item) => item.trim() !== ""),
    isVisible: row.isVisible,
    translations: row.translations,
  };
}

@Component({
  selector: "app-admin-skills",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FieldIssueComponent,
    FormsModule,
    HlmBadge,
    HlmButton,
    HlmInput,
    HlmSeparator,
    HlmSkeleton,
    HlmSwitch,
    HlmTextarea,
    LocaleToggleComponent,
    NgIcon,
    SaveBarComponent,
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
      [saveBar]="false"
    />

    <div class="mx-auto flex max-w-4xl flex-col gap-6 pb-28 pt-6">
      <hlm-separator />

      <header class="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 class="m-0 font-mono text-lg tracking-tight">Cards</h2>
          <p class="mt-1 text-sm text-muted-foreground">
            Edits are kept until you save. Adding, deleting and reordering a card take effect at
            once.
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
                @if (isChanged(row.id)) {
                  <span
                    hlmBadge
                    variant="outline"
                    class="border-accent-orange/50 font-mono text-[0.6rem] text-accent-orange"
                    >unsaved</span
                  >
                }
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
                      maxlength="120"
                      [ngModel]="row.translations[locale].title"
                      (ngModelChange)="patchTranslation(row.id, locale, { title: $event })"
                      [attr.aria-label]="'Title (' + locale + ')'"
                      [attr.aria-invalid]="issue(row.id, locale, 'title') ? true : null"
                      [attr.aria-describedby]="
                        issue(row.id, locale, 'title') ? issueId(row.id, locale, 'title') : null
                      "
                      placeholder="Title"
                    />
                    <app-field-issue
                      [id]="issueId(row.id, locale, 'title')"
                      [message]="issue(row.id, locale, 'title')"
                    />
                    <input
                      hlmInput
                      class="h-8"
                      maxlength="160"
                      [ngModel]="row.translations[locale].caption"
                      (ngModelChange)="patchTranslation(row.id, locale, { caption: $event })"
                      [attr.aria-label]="'Caption (' + locale + ')'"
                      [attr.aria-invalid]="issue(row.id, locale, 'caption') ? true : null"
                      [attr.aria-describedby]="
                        issue(row.id, locale, 'caption') ? issueId(row.id, locale, 'caption') : null
                      "
                      placeholder="// caption"
                    />
                    <app-field-issue
                      [id]="issueId(row.id, locale, 'caption')"
                      [message]="issue(row.id, locale, 'caption')"
                    />
                    <textarea
                      hlmTextarea
                      rows="3"
                      maxlength="2000"
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
              <app-field-issue [id]="row.id + '-items-issue'" [message]="itemsIssue(row.id)" />
            </div>
          </ng-template>
        </app-sortable-list>
      }
    </div>

    @if (!loading()) {
      <app-save-bar
        [dirty]="dirty()"
        [saving]="saving()"
        [problems]="problems()"
        (save)="save()"
        (discard)="discard()"
      />
    }
  `,
})
export default class AdminSkillsPage implements OnInit {
  private readonly api = inject(AdminApiService);
  private readonly confirm = inject(ConfirmService);
  private readonly unsaved = inject(UnsavedChangesService);
  private readonly host = inject(ElementRef<HTMLElement>);
  private readonly heading = viewChild.required(UiGroupEditorComponent);

  protected readonly icons = ICONS;
  protected readonly spans = SPANS;
  protected readonly headingFields = HEADING_FIELDS;
  protected readonly view = signal<LocaleView>("both");

  protected readonly rows = signal<SkillRow[]>([]);
  /** Each card as last saved, by id: what Discard restores and what "changed" compares with. */
  private readonly saved = signal<ReadonlyMap<string, SkillRow>>(new Map());
  protected readonly loading = signal(true);
  private readonly savingCards = signal(false);
  /** Keyed `<card id>.<path of the skill input>`. */
  private readonly issues = new FieldIssues();

  protected readonly changedIds = computed(() => {
    const saved = this.saved();
    return this.rows()
      .filter((row) => {
        const before = saved.get(row.id);
        return !before || JSON.stringify(toInput(row)) !== JSON.stringify(toInput(before));
      })
      .map((row) => row.id);
  });

  protected readonly dirty = computed(() => this.changedIds().length > 0 || this.heading().dirty());
  protected readonly saving = computed(() => this.savingCards() || this.heading().saving());
  protected readonly problems = computed(() => this.issues.count() + this.heading().problems());

  constructor() {
    effect(() => this.unsaved.set("skills", this.changedIds().length > 0));
    inject(DestroyRef).onDestroy(() => this.unsaved.clear("skills"));
  }

  ngOnInit(): void {
    void this.load();
  }

  protected readonly trackRow = (row: SkillRow): string => row.id;

  protected visibleLocales(): Locale[] {
    return this.view() === "both" ? ["en", "de"] : [this.view() as Locale];
  }

  protected isChanged(id: string): boolean {
    return this.changedIds().includes(id);
  }

  protected issue(id: string, locale: Locale, field: string): string | null {
    return this.issues.get(`${id}.translations.${locale}.${field}`);
  }

  protected issueId(id: string, locale: Locale, field: string): string {
    return `${id}-${locale}-${field}-issue`;
  }

  protected itemsIssue(id: string): string | null {
    return this.issues.under(`${id}.items`);
  }

  private async load(): Promise<void> {
    const result = await this.api.listSkills();
    this.loading.set(false);

    if (!result.ok) {
      toast.error("Could not load skills", { description: result.error });
      return;
    }
    this.rows.set(result.data.skills);
    this.saved.set(new Map(result.data.skills.map((row) => [row.id, structuredClone(row)])));
  }

  protected patch(id: string, change: Partial<SkillInput>): void {
    this.rows.update((list) => list.map((r) => (r.id === id ? { ...r, ...change } : r)));
    for (const key of Object.keys(change)) this.issues.resolve(`${id}.${key}`);
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
    for (const key of Object.keys(change)) {
      this.issues.resolve(`${id}.translations.${locale}.${key}`);
    }
  }

  protected discard(): void {
    const saved = this.saved();
    this.rows.update((list) => list.map((row) => structuredClone(saved.get(row.id) ?? row)));
    this.issues.clear();
    this.heading().discard();
  }

  /** Every changed card, then the heading. A card that fails keeps its edits. */
  protected async save(): Promise<void> {
    if (this.saving()) return;
    this.savingCards.set(true);

    const failed: { id: string; issues: ApiIssue[] }[] = [];
    let error = "";
    for (const id of this.changedIds()) {
      const row = this.rows().find((r) => r.id === id);
      if (!row) continue;
      const result = await this.api.updateSkill(id, toInput(row));
      if (result.ok) {
        this.saved.update((map) => new Map(map).set(id, structuredClone(row)));
      } else if (result.issues?.length) {
        failed.push({ id, issues: result.issues });
      } else {
        error = result.error;
      }
    }
    this.savingCards.set(false);

    if (failed.length > 0) {
      this.issues.set(
        failed.flatMap(({ id, issues }) => issues.map((i) => ({ ...i, path: [id, ...i.path] }))),
      );
      if (this.view() !== "both") this.view.set("both");
      toastIssues(failed.flatMap((f) => f.issues));
      focusFirstInvalid(this.host.nativeElement);
      return;
    }
    if (error) {
      toast.error("Not saved", { description: error });
      return;
    }
    this.issues.clear();
    if (await this.heading().save()) toast.success("Draft saved");
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
    // Only the new card: edits waiting on the others stay as they are.
    const list = await this.api.listSkills();
    const added = list.ok ? list.data.skills.find((row) => row.id === id) : undefined;
    if (!added) return;
    this.rows.update((rows) => [...rows, added]);
    this.saved.update((map) => new Map(map).set(id, structuredClone(added)));
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
      return;
    }
    this.issues.resolve(row.id);
    this.saved.update((map) => {
      const next = new Map(map);
      next.delete(row.id);
      return next;
    });
  }

  /** Optimistic and immediate: reorder is idempotent and trivially reversible. */
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
