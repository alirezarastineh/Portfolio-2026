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
  linkedSignal,
  OnInit,
  signal,
  untracked,
} from "@angular/core";
import { toSignal } from "@angular/core/rxjs-interop";
import { FormControl, FormGroup, ReactiveFormsModule } from "@angular/forms";
import { ActivatedRoute, Router, type Params } from "@angular/router";
import type { RouteMeta } from "@analogjs/router";
import { HlmButton } from "@spartan-ng/helm/button";
import { HlmInput } from "@spartan-ng/helm/input";
import { HlmToggle } from "@spartan-ng/helm/toggle";

import type { ApiIssue } from "../../admin/admin-api.service";
import { liveText, traceOf } from "../../admin/change-trace";
import { countChangedFields } from "../../admin/changed-fields";
import { BilingualFieldComponent } from "../../admin/components/bilingual-field.component";
import { ConfirmService } from "../../admin/components/confirm-dialog.component";
import { LocaleToggleComponent } from "../../admin/components/editor-chrome.component";
import { EditorHeaderComponent } from "../../admin/components/editor-header.component";
import type { LocaleView } from "../../admin/components/field-pair.component";
import {
  FormSkeletonComponent,
  LoadErrorComponent,
} from "../../admin/components/load-state.component";
import { applyIssues, countServerErrors, focusFirstInvalid } from "../../admin/issues";
import { storedView, storeView } from "../../admin/language-view";
import { AdminPulseService } from "../../admin/pulse.service";
import { RecoveryService } from "../../admin/recovery.service";
import { askStale, toastDiscarded, toastIssues, toastNotSaved } from "../../admin/save-feedback";
import { UiSectionService } from "../../admin/ui-section.service";
import { UnsavedChangesService, unsavedChangesGuard } from "../../admin/unsaved-changes.service";
import {
  matchesWord,
  sectionId,
  tokenIssues,
  WORD_GROUPS,
  WORD_HEADINGS,
  type WordFilters,
  type WordGroup,
  type WordRow,
} from "../../admin/words";
import { ROWS } from "../../admin/word-rows";
import { isLocale } from "../../content/locale";
import type { Locale } from "../../content/schema";

/** A line under a heading, where the page these words came from said where they show. */
const NOTES: Partial<Record<string, string>> = {
  Contact:
    "Every label, placeholder and error message on the contact form, and the reply time beside it.",
  Work: "The section's heading, then the labels on the home page's project plates; the case studies use the same section names and link labels.",
  "Case study": "Labels on each case study page.",
  Experience: "The section's heading and the labels around each entry.",
  Writing: "Labels on the writing index and around each post.",
  "Footer and legal": "The footer links and the “last updated” label.",
  "404": "The 404 page inside the site.",
  Assistant:
    "The assistant: on the home page's stage, and in its panel on every page. Tell visitors it is an AI (EU AI Act, Art. 50).",
};

interface Section {
  id: string;
  title: string;
  note: string | undefined;
  rows: WordRow[];
}

/** Consecutive rows under one heading share a section. */
const SECTIONS = ROWS.reduce<Section[]>((sections, row) => {
  const title = WORD_HEADINGS[row.group];
  const last = sections.at(-1);
  if (last?.title === title) {
    last.rows.push(row);
  } else {
    sections.push({ id: sectionId(title), title, note: NOTES[title], rows: [row] });
  }
  return sections;
}, []);

const rowKey = (row: WordRow): string => `${row.group}.${row.key}`;

type Words = Record<Locale, Record<WordGroup, Record<string, string>>>;

/**
 * A language's fields: a group of controls per `ui` group, one per row. `FormGroup` keyed by record, not
 * `FormRecord`: that class would be a new export of the forms chunk the public contact form loads.
 */
const controls = () =>
  new FormGroup<Record<string, FormGroup<Record<string, FormControl<string>>>>>(
    Object.fromEntries(
      WORD_GROUPS.map((group) => [
        group,
        new FormGroup<Record<string, FormControl<string>>>(
          Object.fromEntries(
            ROWS.filter((row) => row.group === group).map((row) => [
              row.key,
              new FormControl("", { nonNullable: true }),
            ]),
          ),
        ),
      ]),
    ),
  );

const NO_FILTERS: Params = { q: null, group: null, missing: null, unsaved: null };

export const routeMeta: RouteMeta = { canDeactivate: [unsavedChangesGuard] };

/**
 * Words (plan 5, U12): every `ui` group but Profile's and About's in one table, English and German
 * side by side, filters in the address, and one Save across the groups: one request, one version.
 */
@Component({
  selector: "app-admin-words",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    BilingualFieldComponent,
    EditorHeaderComponent,
    FormSkeletonComponent,
    HlmButton,
    HlmInput,
    HlmToggle,
    LoadErrorComponent,
    LocaleToggleComponent,
    ReactiveFormsModule,
  ],
  host: { class: "block" },
  template: `
    <div class="flex flex-col gap-6 pb-12">
      <app-editor-header
        title="Words"
        [changes]="changes()"
        [saving]="saving()"
        [problems]="problems()"
        [notLive]="notLive()"
        [savedAt]="savedAt()"
        (save)="save()"
        (discard)="discard()"
      >
        <!-- On a phone a line of its own, first, as it reads; the filters below scroll away. -->
        <input
          hlmInput
          id="words-search"
          type="search"
          autocomplete="off"
          aria-label="Find a word"
          placeholder="Find a word…"
          class="w-full max-md:order-first md:w-56"
          [value]="query()"
          (input)="find($any($event.target).value)"
        />
        <app-locale-toggle
          class="max-md:order-first"
          [view]="shownView()"
          [both]="wide()"
          (viewChange)="choose($event)"
        />
      </app-editor-header>

      <div class="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div class="flex items-center gap-2">
          <label class="text-sm" for="words-group">Group</label>
          <!-- Each option says whether it is chosen: a value set on the select would come before its options. -->
          <select
            id="words-group"
            class="h-9 rounded-lg border border-input-line bg-card px-2 text-sm pointer-coarse:h-11 pointer-coarse:text-base"
            (change)="go({ group: $any($event.target).value || null })"
          >
            <option value="" [selected]="!filters().section">All</option>
            @for (section of sections; track section.id) {
              <option [value]="section.id" [selected]="section.id === filters().section">
                {{ section.title }}
              </option>
            }
          </select>
        </div>
        <button
          hlmToggle
          variant="outline"
          size="sm"
          type="button"
          [state]="filters().missing ? 'on' : 'off'"
          (stateChange)="go({ missing: $event === 'on' ? '' : null })"
        >
          Missing in German
        </button>
        <button
          hlmToggle
          variant="outline"
          size="sm"
          type="button"
          [state]="filters().unsaved ? 'on' : 'off'"
          (stateChange)="go({ unsaved: $event === 'on' ? '' : null })"
        >
          Changed, not saved
        </button>
        <p
          class="m-0 ml-auto text-hint text-muted-foreground"
          aria-live="polite"
          [textContent]="countWords()"
        ></p>
      </div>

      @if (loading()) {
        <app-form-skeleton [rows]="6" />
      } @else if (!loaded()) {
        <app-load-error (retry)="reload()" />
      } @else {
        <form [formGroup]="form" class="flex flex-col gap-10">
          @for (section of sections; track section.id) {
            <section
              class="flex flex-col"
              [id]="section.id"
              [attr.aria-labelledby]="section.id + '-title'"
              [hidden]="!sectionShown(section)"
            >
              <h2 class="m-0 text-section-title" [id]="section.id + '-title'">
                {{ section.title }}
              </h2>
              @if (section.note) {
                <p class="m-0 mt-1 text-hint text-muted-foreground">{{ section.note }}</p>
              }
              @if (shownView() === "both") {
                <div
                  class="mt-4 grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)_minmax(0,3fr)] gap-x-3 text-hint text-muted-foreground"
                  aria-hidden="true"
                >
                  <span>Where</span><span>English</span><span>German</span>
                </div>
              }
              @for (row of section.rows; track row.key) {
                @let key = row.group + "." + row.key;
                <app-bilingual-field
                  look="row"
                  class="border-b border-border py-1.5"
                  [hidden]="!shown().has(key)"
                  [id]="row.group + '-' + row.key"
                  [label]="row.label"
                  [hint]="row.hint ?? ''"
                  [multiline]="row.multiline ?? false"
                  [rows]="2"
                  [view]="shownView()"
                  [state]="trace()[key] ?? 'live'"
                  [live]="liveTexts()[key] ?? null"
                  [controlEn]="control('en', row)"
                  [controlDe]="control('de', row)"
                />
              }
            </section>
          }
          @if (shown().size === 0) {
            <div class="flex flex-col items-start gap-3">
              <p class="m-0 text-sm">No words match these filters.</p>
              <button hlmBtn variant="outline" size="sm" type="button" (click)="showAll()">
                Show every word
              </button>
            </div>
          }
        </form>
      }
    </div>
  `,
})
export default class AdminWordsPage implements OnInit {
  private readonly ui = inject(UiSectionService);
  private readonly unsaved = inject(UnsavedChangesService);
  private readonly confirm = inject(ConfirmService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly injector = inject(Injector);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  /** The review, for the trace's draft state. */
  private readonly pulse = inject(AdminPulseService, { optional: true });

  protected readonly sections = SECTIONS;
  protected readonly form = new FormGroup({ en: controls(), de: controls() });

  protected readonly loading = signal(true);
  protected readonly loaded = signal(false);
  protected readonly saving = signal(false);
  /** When Words last saved, for the header's "Saved 14:02". */
  protected readonly savedAt = signal<number | null>(null);
  private readonly revision = signal(0);
  /** Per row, when this page saved it: in the draft until a review asked after that arrives. */
  private readonly savedHere = signal<ReadonlyMap<string, number>>(new Map());
  private updatedAt: string | null = null;
  /** The twelve groups as loaded or last saved, whole, hidden keys too: what a save merges over. */
  private pristine: Words | null = null;
  /** The rows as loaded or last saved: what "changed" compares with. */
  private baseline: Words | null = null;
  private gone = false;

  protected readonly view = signal<LocaleView>(storedView("words") ?? "both");
  /**
   * English and German side by side from 1024 px, the editors' line; one language below it. Its own
   * query: Words has no live preview, and importing that service splits the admin's shared chunks.
   */
  private readonly wideQuery = globalThis.matchMedia?.("(min-width: 1024px)");
  protected readonly wide = signal(this.wideQuery?.matches ?? true);
  protected readonly shownView = computed<LocaleView>(() =>
    this.view() === "both" && !this.wide() ? "en" : this.view(),
  );

  private readonly raw = computed(() => {
    this.revision();
    return this.form.getRawValue() as Words;
  });

  readonly changes = computed(() => {
    // The form first: `baseline` is no signal, and a computed only hears what it read.
    const raw = this.raw();
    return this.baseline ? countChangedFields(this.baseline, raw) : 0;
  });

  protected readonly problems = computed(() => {
    this.revision();
    return countServerErrors(this.form);
  });

  /** The rows whose text differs from what is saved, in either language. */
  private readonly changed = computed(() => {
    const raw = this.raw();
    const base = this.baseline;
    const differs = (row: WordRow) =>
      (["en", "de"] as const).some(
        (l) => raw[l][row.group][row.key] !== base?.[l][row.group][row.key],
      );
    return new Set(base ? ROWS.filter((row) => differs(row)).map((row) => rowKey(row)) : []);
  });

  /** Each row's trace: unsaved over what is saved, else the review's draft against live. */
  protected readonly trace = computed(() => {
    const marks = this.pulse?.marks() ?? null;
    const saved = this.savedHere();
    const changed = this.changed();
    return Object.fromEntries(
      ROWS.map((row) => {
        const key = rowKey(row);
        return [key, traceOf(changed.has(key), marks, `ui.${key}`, saved.get(key))] as const;
      }),
    );
  });

  /** The live site's text per row, for the German's notes. */
  protected readonly liveTexts = computed(() => {
    const marks = this.pulse?.marks() ?? null;
    return Object.fromEntries(
      ROWS.map((row) => [rowKey(row), liveText(marks, `ui.${rowKey(row)}`)]),
    );
  });

  /** Rows saved to the draft and not live; null until the review or a save here says. */
  protected readonly notLive = computed(() => {
    if (!this.pulse?.marks() && this.savedHere().size === 0) {
      return null;
    }
    return Object.values(this.trace()).filter((state) => state === "draft").length;
  });

  private readonly params = toSignal(this.route.queryParamMap, { requireSync: true });
  protected readonly filters = computed<WordFilters>(() => {
    const params = this.params();
    return {
      q: params.get("q") ?? "",
      section: params.get("group") ?? "",
      missing: params.has("missing"),
      unsaved: params.has("unsaved"),
    };
  });
  /** The search box's own text: the address follows it as you type, and it follows the address. */
  protected readonly query = linkedSignal(() => this.filters().q);

  /**
   * The rows the filters show, worked out when the filters change or the words load, not as you
   * type: a row you are fixing stays until the next filter.
   */
  protected readonly shown = computed(() => {
    const filters = this.filters();
    if (!this.loaded()) {
      return new Set<string>();
    }
    return untracked(() => {
      const raw = this.raw();
      const changed = this.changed();
      const text = (row: WordRow) => ({
        en: raw.en[row.group][row.key] ?? "",
        de: raw.de[row.group][row.key] ?? "",
      });
      return new Set(
        ROWS.filter((row) => matchesWord(row, text(row), changed.has(rowKey(row)), filters)).map(
          (row) => rowKey(row),
        ),
      );
    });
  });

  protected readonly countWords = computed(() => {
    const shown = this.shown().size;
    if (!this.loaded()) {
      return "";
    }
    return shown === ROWS.length ? `${shown} words` : `${shown} of ${ROWS.length} words`;
  });

  constructor() {
    this.form.valueChanges.subscribe(() => {
      this.revision.update((v) => v + 1);
      this.unsaved.set("words", this.changes() > 0);
    });
    const follow = (event: MediaQueryListEvent) => this.wide.set(event.matches);
    this.wideQuery?.addEventListener("change", follow);
    inject(DestroyRef).onDestroy(() => {
      this.gone = true;
      this.unsaved.clear("words");
      this.wideQuery?.removeEventListener("change", follow);
    });
    // One copy per group, under the editor names the old pages used: their copies come back here.
    const recovery = inject(RecoveryService);
    for (const group of WORD_GROUPS) {
      recovery.track<Record<Locale, Record<string, string>>>({
        editor: `ui:${group}`,
        saved: () => {
          this.revision();
          const base = this.baseline;
          return base ? { en: base.en[group], de: base.de[group] } : null;
        },
        current: () => {
          if (!this.loaded()) {
            return null;
          }
          const raw = this.raw();
          return { en: raw.en[group], de: raw.de[group] };
        },
        restore: (value) => {
          this.form.patchValue({ en: { [group]: value.en }, de: { [group]: value.de } });
          this.form.markAsDirty();
        },
      });
    }
    // Find's way in (`?row=contact.submit`): the row in sight, the focus in it.
    effect(() => {
      const row = this.params().get("row");
      if (row && this.loaded()) {
        untracked(() => void this.land(row));
      }
    });
  }

  ngOnInit(): void {
    void this.load();
  }

  protected control(locale: Locale, row: WordRow): FormControl<string> {
    return this.form.controls[locale].controls[row.group].controls[row.key];
  }

  protected sectionShown(section: Section): boolean {
    const shown = this.shown();
    return section.rows.some((row) => shown.has(rowKey(row)));
  }

  /** The filters into the address, in place: Back leaves Words. */
  protected go(params: Params): Promise<boolean> {
    return this.router.navigate([], {
      relativeTo: this.route,
      queryParams: params,
      queryParamsHandling: "merge",
      replaceUrl: true,
    });
  }

  protected find(text: string): void {
    this.query.set(text);
    void this.go({ q: text || null });
  }

  /** The empty filter's way out; its button goes, so the focus waits in Find a word. */
  protected showAll(): void {
    void this.go(NO_FILTERS);
    document.getElementById("words-search")?.focus();
  }

  /** Words' language view, remembered in this browser. */
  protected choose(view: LocaleView): void {
    this.view.set(view);
    storeView("words", view);
  }

  protected reload(): void {
    this.loading.set(true);
    void this.load();
  }

  /** (Re)loads the twelve groups from one read, dropping local edits. */
  private async load(): Promise<void> {
    const loaded = await this.ui.loadGroups(WORD_GROUPS);
    this.loading.set(false);
    if (!loaded || this.gone) {
      return;
    }
    const pick = (locale: Locale) =>
      Object.fromEntries(
        WORD_GROUPS.map((group) => [
          group,
          { ...(loaded.value[locale][group] as unknown as Record<string, string>) },
        ]),
      ) as Record<WordGroup, Record<string, string>>;
    const loadedPristine = { en: pick("en"), de: pick("de") };
    this.pristine = loadedPristine;
    this.updatedAt = loaded.updatedAt;
    const rows = (locale: Locale) =>
      Object.fromEntries(
        WORD_GROUPS.map((group) => [
          group,
          Object.fromEntries(
            ROWS.filter((row) => row.group === group).map((row) => [
              row.key,
              loadedPristine[locale][group][row.key] ?? "",
            ]),
          ),
        ]),
      );
    this.form.reset({ en: rows("en"), de: rows("de") });
    this.baseline = this.form.getRawValue() as Words;
    this.revision.update((v) => v + 1);
    this.unsaved.clear("words");
    this.loaded.set(true);
  }

  /** The way back from Discard: the toast's Undo, its focus on Save. */
  protected discard(): void {
    if (!this.baseline) {
      return;
    }
    const edits = this.form.getRawValue();
    this.form.reset(this.baseline);
    this.revision.update((v) => v + 1);
    this.unsaved.clear("words");
    toastDiscarded(() => {
      this.form.setValue(edits);
      this.form.markAsDirty();
    });
  }

  /** Every changed group, whole, in one request on the one version; a lost token stops it first. */
  protected async save(): Promise<void> {
    const pristine = this.pristine;
    if (this.saving() || !pristine || !this.changes()) {
      return;
    }
    const raw = this.raw();
    const lost = tokenIssues(ROWS, (row, locale) => raw[locale][row.group][row.key] ?? "");
    if (lost.length) {
      return this.place(lost);
    }

    const changed = WORD_GROUPS.filter((group) =>
      ROWS.some((row) => row.group === group && this.changed().has(rowKey(row))),
    );
    // Over what was loaded: the hidden keys go out with their values.
    const whole = (group: WordGroup) => ({
      en: { ...pristine.en[group], ...raw.en[group] },
      de: { ...pristine.de[group], ...raw.de[group] },
    });
    const groups = Object.fromEntries(changed.map((group) => [group, whole(group)]));
    const owned = Object.fromEntries(
      WORD_GROUPS.map((group) => [group, { en: pristine.en[group], de: pristine.de[group] }]),
    );
    const keys = [...this.changed()];
    this.saving.set(true);
    const result = await this.ui.saveGroups(groups, this.updatedAt, owned);
    this.saving.set(false);

    if (!result.ok) {
      if (result.reason === "stale") {
        const names = [...new Set(result.changed.map((g) => WORD_HEADINGS[g as WordGroup]))];
        const where = names.length ? `Words in ${names.join(" and ")}` : "Words on this page";
        if (await askStale(this.confirm, where)) {
          await this.load();
        } else {
          this.updatedAt = result.version ?? this.updatedAt;
        }
      } else if (result.reason === "invalid") {
        await this.place(result.issues);
      } else {
        toastNotSaved(result.error, "Save failed");
      }
      return;
    }

    this.updatedAt = result.updatedAt;
    for (const group of changed) {
      const value = whole(group);
      pristine.en[group] = value.en;
      pristine.de[group] = value.de;
    }
    this.form.markAsPristine();
    this.baseline = raw;
    const now = Date.now();
    this.savedAt.set(now);
    this.savedHere.update(
      (saved) => new Map([...saved, ...keys.map((key) => [key, now] as const)]),
    );
    this.revision.update((v) => v + 1);
    this.unsaved.clear("words");
  }

  /**
   * A save's problems on their fields (`[group, locale, key]`), named in the toast; a filter or the
   * language view that hides one gives way first, and the focus goes to the first.
   */
  private async place(issues: readonly ApiIssue[]): Promise<void> {
    const unplaced = applyIssues(issues, ([group, locale, key]) =>
      isLocale(locale) && typeof key === "string"
        ? (this.form.controls[locale].controls[String(group)]?.controls[key] ?? null)
        : null,
    );
    this.revision.update((v) => v + 1);
    toastIssues(unplaced.length ? unplaced : issues);
    const shown = this.shown();
    if (issues.some(({ path: [group, , key] }) => !shown.has(`${String(group)}.${String(key)}`))) {
      await this.go(NO_FILTERS);
    }
    const view = this.shownView();
    const hidden = issues
      .map((issue) => issue.path[1])
      .find((l): l is Locale => isLocale(l) && view !== "both" && l !== view);
    if (hidden) {
      this.view.set(this.wide() ? "both" : hidden);
    }
    if (this.gone) {
      return;
    }
    afterNextRender(() => focusFirstInvalid(this.host.nativeElement), { injector: this.injector });
  }

  /** Find's row: no filter over it, the address without `row` (so it can be found again), the focus in its German. */
  private async land(target: string): Promise<void> {
    const row = ROWS.find((r) => rowKey(r) === target);
    await this.go({ ...NO_FILTERS, row: null });
    if (!row || this.gone) {
      return;
    }
    afterNextRender(
      () => {
        // The column being translated, as a translation tool lands in the target.
        const locale = this.shownView() === "en" ? "en" : "de";
        const field = document.getElementById(`${row.group}-${row.key}-${locale}`);
        field?.focus();
        if (field instanceof HTMLInputElement) {
          field.select();
        }
      },
      { injector: this.injector },
    );
  }
}
