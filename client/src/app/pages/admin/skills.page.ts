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
import { FormControl } from "@angular/forms";
import { NgIcon, provideIcons } from "@ng-icons/core";
import { lucidePlus, lucideTrash2 } from "@ng-icons/lucide";
import { HlmButton } from "@spartan-ng/helm/button";
import { HlmSwitch } from "@spartan-ng/helm/switch";

import {
  AdminApiService,
  type ApiIssue,
  type ApiResult,
  type SkillInput,
  type SkillRow,
} from "../../admin/admin-api.service";
import { ChangedElsewhere } from "../../admin/changed-elsewhere";
import { countChangedFields } from "../../admin/changed-fields";
import {
  inDraft,
  rollUp,
  stateOf,
  TRACE_WORDS,
  type DraftMarks,
  type TraceState,
} from "../../admin/change-trace";
import { BilingualFieldComponent } from "../../admin/components/bilingual-field.component";
import { ConfirmService } from "../../admin/components/confirm-dialog.component";
import { LocaleToggleComponent } from "../../admin/components/editor-chrome.component";
import { EditorHeaderComponent } from "../../admin/components/editor-header.component";
import { EditorLayoutComponent } from "../../admin/components/editor-layout.component";
import type { LocaleView } from "../../admin/components/field-pair.component";
import {
  FormSkeletonComponent,
  LoadErrorComponent,
} from "../../admin/components/load-state.component";
import {
  SortableListComponent,
  SortableRowDirective,
} from "../../admin/components/sortable-list.component";
import { TokenFieldComponent } from "../../admin/components/token-field.component";
import type { OutlineItem } from "../../admin/editor-outline";
import { FieldIssues, focusFirstInvalid } from "../../admin/issues";
import { storedView, storeView } from "../../admin/language-view";
import { withSkills, type LiveCompose } from "../../admin/preview/live-content";
import { LivePreviewService } from "../../admin/preview/live-preview.service";
import { LivePreviewToggleComponent } from "../../admin/preview/live-preview-toggle.component";
import { AdminPulseService } from "../../admin/pulse.service";
import { RecoveryService } from "../../admin/recovery.service";
import { toastDiscarded, toastIssues, toastNotSaved } from "../../admin/save-feedback";
import { UnsavedChangesService, unsavedChangesGuard } from "../../admin/unsaved-changes.service";
import { isLocale } from "../../content/locale";
import type { Locale, Skill } from "../../content/schema";

export const routeMeta: RouteMeta = { canDeactivate: [unsavedChangesGuard] };

const LOCALES: Locale[] = ["en", "de"];
const TEXT_KEYS = ["title", "narrative"] as const;
type TextKey = (typeof TEXT_KEYS)[number];
/** A group's fields with a trace, as the review names them under `skills[<id>]`. */
const TRACED = ["title", "items", "narrative", "isVisible"] as const;
type Traced = (typeof TRACED)[number];

interface SkillSaveResult {
  row: SkillRow;
  result: ApiResult<{ ok: true }>;
}

/** What a save sends: every field as loaded, the hidden icon, size and captions too. */
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

/** A group as the page names it: its English title, else its German one. */
function nameOf(row: SkillRow): string {
  return row.translations.en.title.trim() || row.translations.de.title.trim() || "Untitled group";
}

/** A traced field's value, in both languages where it has two. */
function valueOf(row: SkillRow, key: Traced): unknown {
  if (key === "title" || key === "narrative") {
    return [row.translations.en[key], row.translations.de[key]];
  }
  return key === "items" ? row.items : row.isVisible;
}

/** What the live site lists: nothing before the first publish; unknown when the review carries no list. */
function liveSkills(marks: DraftMarks | null): readonly Skill[] | null {
  if (!marks) {
    return null;
  }
  if (marks.live.en === null) {
    return [];
  }
  return marks.live.en?.skills ?? null;
}

/**
 * Skills (plan 5, U14) on Part G's pieces: the editor header (Save, Ctrl/⌘ S, ⋯ with Discard), a
 * ruled row per group (its name, Shown and Delete, then the title and summary as bilingual fields
 * and the skills as tokens), the outline with a dot per group. The icon, size and captions nothing
 * on the site reads stay in the rows, so every save sends them as loaded.
 */
@Component({
  selector: "app-admin-skills",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    BilingualFieldComponent,
    EditorHeaderComponent,
    EditorLayoutComponent,
    FormSkeletonComponent,
    HlmButton,
    HlmSwitch,
    LivePreviewToggleComponent,
    LoadErrorComponent,
    LocaleToggleComponent,
    NgIcon,
    SortableListComponent,
    SortableRowDirective,
    TokenFieldComponent,
  ],
  viewProviders: [provideIcons({ lucidePlus, lucideTrash2 })],
  host: { class: "block" },
  template: `
    <app-editor-layout
      anchor="skills"
      [compose]="livePreview()"
      [outline]="outline()"
      [view]="shownView()"
    >
      <div class="flex flex-col gap-6 pb-12">
        <app-editor-header
          title="Skills"
          [changes]="changes()"
          [saving]="saving()"
          [problems]="issues.count()"
          [notLive]="notLive()"
          [savedAt]="savedAt()"
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
          <app-form-skeleton kind="list" [rows]="3" label="Loading the groups…" />
        } @else if (loadError(); as reason) {
          <app-load-error title="Could not load the groups" [reason]="reason" (retry)="reload()" />
        } @else {
          <section aria-labelledby="skills-groups-title" class="flex flex-col gap-4">
            <div class="flex flex-wrap items-start justify-between gap-3">
              <div class="min-w-0">
                <h2 id="skills-groups-title" class="m-0 text-section-title">Groups</h2>
                <p class="m-0 mt-1 max-w-prose text-hint text-muted-foreground">
                  On the home page in this order, two to a row: each group's title, its skills, then
                  its summary, a sentence or two. The skills are the same in both languages; the
                  section's heading is in Words. Adding, deleting and moving a group save at once.
                </p>
              </div>
              <button hlmBtn variant="outline" size="sm" type="button" data-add (click)="add()">
                <ng-icon name="lucidePlus" size="16" aria-hidden="true" />Add group
              </button>
            </div>
            @if (shownView() === "both" && rows().length) {
              <div
                class="-mb-2 grid grid-cols-2 gap-3 pl-12 text-hint text-muted-foreground max-lg:hidden"
                aria-hidden="true"
              >
                <span>English</span><span>German</span>
              </div>
            }
            <app-sortable-list
              label="group"
              emptyText="No groups yet."
              [items]="rows()"
              [trackBy]="trackRow"
              [ruled]="true"
              [tall]="true"
              (reordered)="onReorder($event)"
            >
              <ng-template appSortableRow let-row let-i="index">
                <div class="flex min-w-0 flex-col gap-4 pl-4" [id]="'group-' + row.id">
                  <div
                    class="change-trace flex min-h-8 items-center gap-3"
                    [attr.data-change]="mark(row.id, 'isVisible')"
                  >
                    <h3
                      class="m-0 min-w-0 flex-1 truncate text-section-title"
                      [title]="nameOf(row)"
                    >
                      {{ nameOf(row) }}
                    </h3>
                    <label class="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                      <hlm-switch
                        [checked]="row.isVisible"
                        [aria-describedby]="
                          mark(row.id, 'isVisible') ? 'group-' + row.id + '-shown-state' : null
                        "
                        (checkedChange)="patch(row.id, { isVisible: $event })"
                      />
                      <span aria-hidden="true">{{ row.isVisible ? "Shown" : "Hidden" }}</span>
                      <span class="sr-only">Show {{ nameOf(row) }} on the site</span>
                    </label>
                    <span [id]="'group-' + row.id + '-shown-state'" class="sr-only">{{
                      words(row.id, "isVisible")
                    }}</span>
                    <button
                      hlmBtn
                      variant="ghost"
                      size="icon-sm"
                      type="button"
                      class="shrink-0 text-muted-foreground hover:text-destructive pointer-coarse:size-11"
                      [attr.aria-label]="'Delete ' + nameOf(row)"
                      (click)="remove(row)"
                    >
                      <ng-icon name="lucideTrash2" size="16" aria-hidden="true" />
                    </button>
                  </div>
                  <app-bilingual-field
                    [id]="'skill-' + row.id + '-title'"
                    label="Title"
                    [maxLength]="120"
                    [view]="shownView()"
                    [state]="state(row.id, 'title')"
                    [live]="liveCopies().get(row.id)?.title ?? null"
                    [controlEn]="control(row.id, 'title', 'en')"
                    [controlDe]="control(row.id, 'title', 'de')"
                  />
                  <app-token-field
                    [id]="'skill-' + row.id + '-items'"
                    label="Skills"
                    singular="skill"
                    [max]="40"
                    [quietHint]="i > 0"
                    [value]="row.items"
                    [issue]="issues.under(row.id + '.items')"
                    [state]="state(row.id, 'items')"
                    (valueChange)="patch(row.id, { items: $event })"
                  />
                  <app-bilingual-field
                    [id]="'skill-' + row.id + '-summary'"
                    label="Summary"
                    [multiline]="true"
                    [rows]="3"
                    [maxLength]="2000"
                    [view]="shownView()"
                    [state]="state(row.id, 'narrative')"
                    [live]="liveCopies().get(row.id)?.narrative ?? null"
                    [controlEn]="control(row.id, 'narrative', 'en')"
                    [controlDe]="control(row.id, 'narrative', 'de')"
                  />
                </div>
              </ng-template>
            </app-sortable-list>
          </section>
        }
      </div>
    </app-editor-layout>
  `,
})
export default class AdminSkillsPage implements OnInit {
  private readonly api = inject(AdminApiService);
  private readonly confirm = inject(ConfirmService);
  private readonly unsaved = inject(UnsavedChangesService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  /** The review, for the trace's draft state; absent in unit tests. */
  private readonly pulse = inject(AdminPulseService, { optional: true });
  private readonly preview = inject(LivePreviewService, { optional: true });
  private readonly versions = new ChangedElsewhere(this.confirm, async () => {
    const list = await this.api.listSkills();
    return list.ok ? list.data.skills : null;
  });

  protected readonly nameOf = nameOf;
  protected readonly view = signal<LocaleView>(storedView("skills") ?? "both");
  /** English and German side by side from 1024 px; one language below it. */
  protected readonly wide = computed(() => this.preview?.wide() ?? true);
  protected readonly shownView = computed<LocaleView>(() =>
    this.view() === "both" && !this.wide() ? "en" : this.view(),
  );

  protected readonly rows = signal<SkillRow[]>([]);
  /** Each group as last saved, by id: what Discard restores and what "changed" compares with. */
  private readonly saved = signal<ReadonlyMap<string, SkillRow>>(new Map());
  protected readonly loading = signal(true);
  /** The API's reason when the groups did not arrive. */
  protected readonly loadError = signal<string | null>(null);
  protected readonly saving = signal(false);
  /** When this page last saved, for the header's "Saved 14:02". */
  protected readonly savedAt = signal<number | null>(null);
  /** Per `<id>.<field>`, when this page saved it: in the draft until a review asked after that arrives. */
  private readonly savedHere = signal<ReadonlyMap<string, number>>(new Map());
  /** Keyed `<group id>.<path of the skill input>`. */
  protected readonly issues = new FieldIssues();
  private gone = false;

  /** One control per group, text and language, mirroring the rows: the bilingual field's. */
  private readonly controls = new Map<
    string,
    Record<TextKey, Record<Locale, FormControl<string>>>
  >();

  protected readonly changedIds = computed(() => {
    const saved = this.saved();
    return this.rows()
      .filter((row) => {
        const before = saved.get(row.id);
        return !before || JSON.stringify(toInput(row)) !== JSON.stringify(toInput(before));
      })
      .map((row) => row.id);
  });

  /** Changed fields across the groups. */
  protected readonly changes = computed(() => {
    const saved = this.saved();
    return this.rows().reduce((sum, row) => {
      const before = saved.get(row.id);
      return sum + (before ? countChangedFields(toInput(before), toInput(row)) : 0);
    }, 0);
  });

  /** Each group's traced fields: unsaved here, in the draft, or live. */
  private readonly trace = computed(() => {
    const marks = this.pulse?.marks() ?? null;
    const saved = this.saved();
    const here = this.savedHere();
    const live = liveSkills(marks);
    const out = new Map<string, Record<Traced, TraceState>>();
    for (const row of this.rows()) {
      const before = saved.get(row.id);
      const states = {} as Record<Traced, TraceState>;
      for (const key of TRACED) {
        const unsaved =
          !!before && JSON.stringify(valueOf(row, key)) !== JSON.stringify(valueOf(before, key));
        const savedLater = (here.get(`${row.id}.${key}`) ?? 0) > (marks?.asked ?? 0);
        // A hidden group is on no page: only its switch can wait for a publish.
        const draft =
          key === "isVisible"
            ? savedLater ||
              (live !== null && live.some((s) => s.id === row.id) !== !!before?.isVisible)
            : !!before?.isVisible && (savedLater || inDraft(marks, `skills[${row.id}].${key}`));
        states[key] = stateOf(unsaved, draft);
      }
      out.set(row.id, states);
    }
    return out;
  });

  /** The live site's title and summary of each group, for "English changed, German not". */
  protected readonly liveCopies = computed(() => {
    const live = this.pulse?.marks()?.live;
    const out = new Map<string, Record<TextKey, Record<Locale, string> | null>>();
    for (const row of this.rows()) {
      const at = (locale: Locale) => live?.[locale]?.skills?.find((s) => s.id === row.id);
      const [en, de] = [at("en"), at("de")];
      out.set(row.id, {
        title: en && de ? { en: en.title, de: de.title } : null,
        narrative: en && de ? { en: en.narrative, de: de.narrative } : null,
      });
    }
    return out;
  });

  /** Fields saved to the draft and not live; null until the review or a save here says. */
  protected readonly notLive = computed(() => {
    if (!this.pulse?.marks() && this.savedHere().size === 0) {
      return null;
    }
    let count = 0;
    for (const states of this.trace().values()) {
      count += Object.values(states).filter((state) => state === "draft").length;
    }
    return count;
  });

  /** A section per group: its name, the trace rolled up, and the last save's problems in it. */
  protected readonly outline = computed<OutlineItem[]>(() => {
    if (this.loading() || this.loadError()) {
      return [];
    }
    const trace = this.trace();
    const problems = this.issues.entries().map(([path]) => path);
    return this.rows().map((row) => ({
      id: `group-${row.id}`,
      label: nameOf(row),
      problems: problems.filter((path) => path.startsWith(`${row.id}.`)).length,
      change: rollUp(Object.values(trace.get(row.id) ?? {})),
    }));
  });

  /** The section as it would be published: these groups, in this order. */
  protected readonly livePreview = computed<LiveCompose | null>(() => {
    if (this.loading() || this.loadError()) {
      return null;
    }
    const rows = this.rows();
    return (base, locale) => withSkills(base, locale, rows);
  });

  constructor() {
    effect(() => this.unsaved.set("skills", this.changedIds().length > 0));
    inject(DestroyRef).onDestroy(() => {
      this.gone = true;
      this.unsaved.clear("skills");
    });
    // Each group's copy by its id (the old cards' key and shape): add, delete and reorder save at once.
    inject(RecoveryService).track({
      editor: "skills",
      rows: true,
      saved: () =>
        this.loading() || this.loadError() !== null
          ? null
          : Object.fromEntries([...this.saved().values()].map((row) => [row.id, toInput(row)])),
      current: () => Object.fromEntries(this.rows().map((row) => [row.id, toInput(row)])),
      restore: (copy) => {
        this.rows.update((list) => list.map((row) => ({ ...row, ...copy[row.id] })));
        this.fill();
      },
    });
  }

  ngOnInit(): void {
    void this.load();
  }

  protected readonly trackRow = (row: SkillRow): string => row.id;

  /** Skills' language view, remembered in this browser. */
  protected choose(view: LocaleView): void {
    this.view.set(view);
    storeView("skills", view);
  }

  protected state(id: string, key: Traced): TraceState {
    return this.trace().get(id)?.[key] ?? "live";
  }

  protected mark(id: string, key: Traced): TraceState | null {
    const state = this.state(id, key);
    return state === "live" ? null : state;
  }

  protected words(id: string, key: Traced): string {
    return TRACE_WORDS[this.state(id, key)];
  }

  protected control(id: string, key: TextKey, locale: Locale): FormControl<string> {
    return this.controlsOf(id)[key][locale];
  }

  /** A group's controls, made on first use: a text typed, or put there by a field's ⋯, goes into its row. */
  private controlsOf(id: string): Record<TextKey, Record<Locale, FormControl<string>>> {
    const known = this.controls.get(id);
    if (known) {
      return known;
    }
    const make = (key: TextKey, locale: Locale) => {
      const control = new FormControl(this.textOf(id, key, locale), { nonNullable: true });
      control.valueChanges.subscribe((text) => {
        if (text !== this.textOf(id, key, locale)) {
          this.patchText(id, locale, { [key]: text });
        }
      });
      return control;
    };
    const made = {
      title: { en: make("title", "en"), de: make("title", "de") },
      narrative: { en: make("narrative", "en"), de: make("narrative", "de") },
    };
    this.controls.set(id, made);
    return made;
  }

  private textOf(id: string, key: TextKey, locale: Locale): string {
    return this.rows().find((row) => row.id === id)?.translations[locale][key] ?? "";
  }

  /** The controls take the rows' text: after a load, a discard, a recovery copy or an Undo. */
  private fill(): void {
    for (const row of this.rows()) {
      const set = this.controlsOf(row.id);
      for (const key of TEXT_KEYS) {
        for (const locale of LOCALES) {
          const text = row.translations[locale][key];
          // A reset drops the field's own drafts and its Undo: only where the text moved.
          if (set[key][locale].value !== text) {
            set[key][locale].reset(text);
          }
        }
      }
    }
  }

  protected reload(): void {
    this.loading.set(true);
    void this.load();
  }

  private async load(): Promise<void> {
    const result = await this.api.listSkills();
    this.loading.set(false);
    this.loadError.set(result.ok ? null : result.error);
    if (!result.ok) {
      return;
    }
    this.rows.set(result.data.skills);
    this.saved.set(new Map(result.data.skills.map((row) => [row.id, structuredClone(row)])));
    this.versions.remember(result.data.skills);
    this.fill();
  }

  protected patch(id: string, change: Partial<SkillInput>): void {
    this.rows.update((list) => list.map((r) => (r.id === id ? { ...r, ...change } : r)));
    for (const key of Object.keys(change)) {
      this.issues.resolve(`${id}.${key}`);
    }
  }

  private patchText(
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
    const edits = this.rows();
    const saved = this.saved();
    this.rows.update((list) => list.map((row) => structuredClone(saved.get(row.id) ?? row)));
    this.issues.clear();
    this.fill();
    toastDiscarded(() => {
      this.rows.set(edits);
      this.fill();
    });
  }

  /** Every changed group. One that fails keeps its edits and says why. */
  protected async save(): Promise<void> {
    if (this.saving()) {
      return;
    }
    const changedRows = this.rows().filter((row) => this.changedIds().includes(row.id));
    if (!changedRows.length) {
      return;
    }
    this.saving.set(true);
    const ids = changedRows.map((row) => row.id);
    if (!(await this.versions.mayOverwrite(ids, "A group on this page"))) {
      this.saving.set(false);
      return;
    }
    const before = this.trace();
    const results = await Promise.all(
      changedRows.map(async (row) => ({
        row,
        result: await this.api.updateSkill(row.id, toInput(row)),
      })),
    );
    await this.versions.refresh();

    const { done, failed, error } = this.collectSaveOutcomes(results);
    const at = Date.now();
    this.recordSaved(done, before, at);
    this.saving.set(false);
    if (this.gone) {
      return;
    }
    this.finishSave(done, failed, error, at);
  }

  /** Split save responses into succeeded rows, field issues, and any non-field error. */
  private collectSaveOutcomes(results: SkillSaveResult[]): {
    done: SkillRow[];
    failed: ApiIssue[];
    error: string;
  } {
    const done: SkillRow[] = [];
    const failed: ApiIssue[] = [];
    let error = "";
    for (const { row, result } of results) {
      if (result.ok) {
        done.push(row);
      } else if (result.issues?.length) {
        failed.push(...result.issues.map((i) => ({ ...i, path: [row.id, ...i.path] })));
      } else {
        error = result.error;
      }
    }
    return { done, failed, error };
  }

  /** Persist succeeded rows as the new saved baseline and mark their edited fields in the draft. */
  private recordSaved(
    done: SkillRow[],
    before: ReadonlyMap<string, Record<Traced, TraceState>>,
    at: number,
  ): void {
    if (!done.length) {
      return;
    }
    this.saved.update((savedMap) => {
      const next = new Map(savedMap);
      for (const row of done) {
        next.set(row.id, structuredClone(row));
      }
      return next;
    });
    this.savedHere.update((marks) => {
      const next = new Map(marks);
      for (const row of done) {
        this.markRowSavedHere(next, row.id, before.get(row.id), at);
      }
      return next;
    });
  }

  /** Record draft timestamps only for fields that were unsaved when the request started. */
  private markRowSavedHere(
    marks: Map<string, number>,
    id: string,
    prior: Record<Traced, TraceState> | undefined,
    at: number,
  ): void {
    for (const key of TRACED) {
      if (prior?.[key] === "unsaved") {
        marks.set(`${id}.${key}`, at);
      }
    }
  }

  /** Update UI state and surface any remaining validation or request errors after a save. */
  private finishSave(done: SkillRow[], failed: ApiIssue[], error: string, at: number): void {
    if (done.length) {
      this.savedAt.set(at);
      for (const row of done) {
        this.markGroupPristine(row.id);
      }
    }
    if (failed.length) {
      this.refused(failed);
    } else if (error) {
      toastNotSaved(error);
    } else {
      this.issues.clear();
    }
  }

  /** Mark a saved group's text controls pristine so field state matches the new baseline. */
  private markGroupPristine(id: string): void {
    const set = this.controls.get(id);
    if (!set) {
      return;
    }
    for (const key of TEXT_KEYS) {
      for (const locale of LOCALES) {
        set[key][locale].markAsPristine();
      }
    }
  }

  /** A refused save: its problems on their fields, the first focused, in the language that shows them. */
  private refused(issues: ApiIssue[]): void {
    this.issues.set(issues);
    toastIssues(issues);
    const shown = this.shownView();
    const other = issues
      .map((issue) => issue.path[2])
      .find((locale): locale is Locale => isLocale(locale) && shown !== "both" && locale !== shown);
    if (other) {
      this.view.set(this.wide() ? "both" : other);
    }
    this.afterRender((root) => {
      for (const [id, set] of this.controls) {
        for (const key of TEXT_KEYS) {
          for (const locale of LOCALES) {
            const message = this.issues.get(`${id}.translations.${locale}.${key}`);
            if (message) {
              set[key][locale].setErrors({ server: message });
            }
          }
        }
      }
      focusFirstInvalid(root);
    });
  }

  /** Saved at once with the defaults the server needs (icon, size, caption: none shown); its title takes the focus. */
  protected async add(): Promise<void> {
    const id = `skill-${Date.now().toString(36)}`;
    const blank = { title: "New group", caption: "// caption", narrative: "" };
    const result = await this.api.createSkill({
      id,
      icon: "cpu",
      span: "sm",
      items: [],
      isVisible: true,
      translations: { en: { ...blank }, de: { ...blank } },
    });
    if (!result.ok) {
      toastNotSaved(result.error, "Could not add");
      return;
    }
    // Only the new group: edits waiting on the others stay as they are.
    const list = await this.api.listSkills();
    const added = list.ok ? list.data.skills.find((row) => row.id === id) : undefined;
    if (!added || this.gone) {
      return;
    }
    this.rows.update((rows) => [...rows, added]);
    this.saved.update((map) => new Map(map).set(id, structuredClone(added)));
    this.fill();
    const locale = this.shownView() === "de" ? "de" : "en";
    this.afterRender((root) => {
      const title = root.querySelector<HTMLInputElement>(
        `#skill-${CSS.escape(id)}-title-${locale}`,
      );
      title?.focus();
      title?.select();
    });
  }

  /** Deleted on the server at once, so it asks by name first; Add group takes the focus. */
  protected async remove(row: SkillRow): Promise<void> {
    const name = nameOf(row);
    const go = await this.confirm.ask({
      title: `Delete ${name}?`,
      description: "The group and its text in both languages are deleted. This cannot be undone.",
      confirmLabel: "Delete group",
      destructive: true,
    });
    if (!go) {
      return;
    }

    const previous = this.rows();
    this.rows.update((list) => list.filter((r) => r.id !== row.id));
    this.afterRender((root) => root.querySelector<HTMLElement>("button[data-add]")?.focus());
    const result = await this.api.deleteSkill(row.id);
    if (!result.ok) {
      this.rows.set(previous);
      toastNotSaved(result.error, "Could not delete");
      return;
    }
    this.issues.resolve(row.id);
    this.controls.delete(row.id);
    this.saved.update((map) => {
      const next = new Map(map);
      next.delete(row.id);
      return next;
    });
  }

  /** Saved at once: a move is undone by another. */
  protected async onReorder(next: SkillRow[]): Promise<void> {
    const previous = this.rows();
    this.rows.set(next);
    const result = await this.api.reorder(
      "skills",
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
