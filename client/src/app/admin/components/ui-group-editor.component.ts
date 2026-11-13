import { NgTemplateOutlet } from "@angular/common";
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  ElementRef,
  inject,
  input,
  OnInit,
  signal,
} from "@angular/core";
import { FormBuilder, FormControl, ReactiveFormsModule } from "@angular/forms";
import { toast } from "@spartan-ng/brain/sonner";
import { HlmSeparator } from "@spartan-ng/helm/separator";

import { ConfirmService } from "./confirm-dialog.component";

import { countChangedFields } from "../changed-fields";
import { liveText, rollUp, traceOf, type TraceState } from "../change-trace";
import { storedView, storeView } from "../language-view";
import type { OutlineItem } from "../editor-outline";
import { withUi, type LiveCompose } from "../preview/live-content";
import { LivePreviewService } from "../preview/live-preview.service";
import { LivePreviewToggleComponent } from "../preview/live-preview-toggle.component";
import { EditorLayoutComponent } from "./editor-layout.component";
import { applyIssues, countServerErrors, focusFirstInvalid } from "../issues";
import { isHidden } from "../hidden-fields";
import { AdminPulseService } from "../pulse.service";
import { RecoveryService } from "../recovery.service";
import { askStale, toastDiscarded, toastIssues, toastNotSaved } from "../save-feedback";
import { UiSectionService, type UiGroup } from "../ui-section.service";
import { UnsavedChangesService } from "../unsaved-changes.service";
import { isLocale } from "../../content/locale";
import type { Locale } from "../../content/schema";
import { BilingualFieldComponent } from "./bilingual-field.component";
import { LocaleToggleComponent, SaveBarComponent } from "./editor-chrome.component";
import { EditorHeaderComponent } from "./editor-header.component";
import { FieldPairComponent, type LocaleView } from "./field-pair.component";
import { FormSkeletonComponent, LoadErrorComponent } from "./load-state.component";
import { AdminPageHeaderComponent } from "./page-header.component";

export interface UiFieldDef {
  key: string;
  label: string;
  multiline?: boolean;
  rows?: number;
  hint?: string;
  /** A hard cap: the counter shows it and the browser stops input there. */
  maxLength?: number;
  /** A recommended length: the counter turns orange past it. */
  softMax?: number;
  /** Offer the AI copilot (default on); off for codes and tokens. */
  ai?: boolean;
  /** In the editor look: the section the field sits in, by its heading; fields in a row share one. */
  section?: string;
}

type StringRecord = Record<string, string>;

interface UiSection {
  id: string;
  title: string;
  fields: UiFieldDef[];
}

/**
 * Drives any editor over a single group of the `ui` translation document.
 *
 * About, Contact and the section headings differ only by which fields they
 * show, so they are configuration rather than three near-identical pages.
 *
 * With `[saveBar]="false"` it leaves saving to the page that holds it (which
 * calls `save()` / `discard()` and reads `dirty()`), so a page editing a `ui`
 * group next to something else still has one save bar.
 *
 * `look="editor"` is the redesigned editor (plan 5, U10): the editor header, the bilingual
 * fields with the change trace in sections, the outline with its dots. About's; the other groups
 * keep the page header and the save bar until their Parts move them.
 */
@Component({
  selector: "app-ui-group-editor",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    AdminPageHeaderComponent,
    BilingualFieldComponent,
    EditorHeaderComponent,
    EditorLayoutComponent,
    FieldPairComponent,
    FormSkeletonComponent,
    HlmSeparator,
    LivePreviewToggleComponent,
    LoadErrorComponent,
    LocaleToggleComponent,
    NgTemplateOutlet,
    ReactiveFormsModule,
    SaveBarComponent,
  ],
  host: { class: "block" },
  template: `
    @if (look() === "editor") {
      <app-editor-layout
        [anchor]="live() ?? 'hero'"
        [compose]="livePreview()"
        [view]="shownView()"
        [outline]="outline()"
      >
        <div class="flex flex-col gap-6">
          <app-editor-header
            [title]="title()"
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
            @if (live()) {
              <app-live-preview-toggle />
            }
          </app-editor-header>

          @if (loading()) {
            <app-form-skeleton [rows]="skeletonRows()" />
          } @else if (!loaded()) {
            <app-load-error (retry)="reload()" />
          } @else {
            <form [formGroup]="form" class="flex flex-col gap-10">
              @for (section of sections(); track section.id) {
                <section
                  class="flex flex-col gap-6"
                  [id]="section.id"
                  [attr.aria-labelledby]="section.id + '-title'"
                >
                  <h2 class="m-0 text-section-title" [id]="section.id + '-title'">
                    {{ section.title }}
                  </h2>
                  @if (shownView() === "both") {
                    <div
                      class="-mb-4 grid grid-cols-2 gap-3 text-hint text-muted-foreground"
                      aria-hidden="true"
                    >
                      <span>English</span><span>German</span>
                    </div>
                  }
                  @for (field of section.fields; track field.key) {
                    <app-bilingual-field
                      [id]="group() + '-' + field.key"
                      [label]="field.label"
                      [hint]="field.hint ?? ''"
                      [multiline]="field.multiline ?? false"
                      [rows]="field.rows ?? 3"
                      [maxLength]="field.maxLength ?? 0"
                      [softMax]="field.softMax ?? 0"
                      [ai]="field.ai ?? true"
                      [view]="shownView()"
                      [state]="trace()[field.key] ?? 'live'"
                      [live]="liveTexts()[field.key] ?? null"
                      [controlEn]="control('en', field.key)"
                      [controlDe]="control('de', field.key)"
                    />
                  }
                </section>
              }
            </form>
          }
        </div>
      </app-editor-layout>
    } @else if (level() === 1) {
      <!-- As the page: in the editor frame, with its live preview when it has one. -->
      <app-editor-layout [anchor]="live() ?? 'hero'" [compose]="livePreview()" [view]="view()">
        <ng-container *ngTemplateOutlet="body" />
      </app-editor-layout>
    } @else {
      <ng-container *ngTemplateOutlet="body" />
    }

    <ng-template #body>
      <div
        class="flex flex-col gap-6"
        [class]="level() === 1 ? (saveBar() ? 'pb-24' : '') : 'mx-auto max-w-4xl'"
      >
        @if (level() === 1) {
          <app-page-header
            [title]="title()"
            [description]="description()"
            [preview]="preview()"
            [(view)]="view"
          >
            @if (live()) {
              <app-live-preview-toggle headerActions />
            }
          </app-page-header>
        } @else {
          <header class="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 class="m-0 text-section-title">{{ title() }}</h2>
              @if (description()) {
                <p class="m-0 mt-1 text-sm text-muted-foreground">{{ description() }}</p>
              }
            </div>
            <app-locale-toggle [(view)]="view" />
          </header>
        }

        @if (loading()) {
          <app-form-skeleton [rows]="skeletonRows()" />
        } @else if (!loaded()) {
          <app-load-error (retry)="reload()" />
        } @else {
          <form [formGroup]="form" class="flex flex-col gap-6">
            @for (field of shown(); track field.key; let last = $last) {
              <app-field-pair
                [id]="group() + '-' + field.key"
                [label]="field.label"
                [hint]="field.hint ?? ''"
                [multiline]="field.multiline ?? false"
                [rows]="field.rows ?? 3"
                [maxLength]="field.maxLength ?? 0"
                [softMax]="field.softMax ?? 0"
                [ai]="field.ai ?? true"
                [view]="view()"
                [controlEn]="control('en', field.key)"
                [controlDe]="control('de', field.key)"
              />
              @if (!last) {
                <hlm-separator />
              }
            }
          </form>

          @if (saveBar()) {
            <app-save-bar
              [dirty]="dirty()"
              [saving]="saving()"
              [problems]="problems()"
              [changes]="changes()"
              [previewHref]="preview()"
              (save)="save()"
              (discard)="discard()"
            />
          }
        }
      </div>
    </ng-template>
  `,
})
export class UiGroupEditorComponent implements OnInit {
  readonly group = input.required<UiGroup>();
  readonly title = input.required<string>();
  readonly description = input("");
  readonly fields = input.required<UiFieldDef[]>();
  /** Off when the page holding this editor saves it along with its own. */
  readonly saveBar = input(true);
  /** 1 when this editor is the page (or tops it); 2 below the page's own heading. */
  readonly level = input<1 | 2>(1);
  /** At level 1: where the page header's Preview opens the draft. */
  readonly preview = input<string | null>(null);
  /** At level 1: the home page section the group fills, for the live preview; none, no preview. */
  readonly live = input<string | null>(null);
  /** "editor": the redesigned editor (plan 5, U10); "page": the page header and the save bar. */
  readonly look = input<"page" | "editor">("page");

  /** The section with the unsaved copy over the draft's. */
  protected readonly livePreview = computed<LiveCompose | null>(() => {
    const value = this.value();
    const group = this.group();
    if (!value || !this.live()) return null;
    return (base, locale) => withUi(base, locale, { [group]: value });
  });

  /** What nothing on the site reads stays out of sight; its value stays in the form, and saves. */
  protected readonly shown = computed(() =>
    this.fields().filter((field) => !isHidden("section", "ui", `${this.group()}.${field.key}`)),
  );

  /** As many placeholder fields as the form will have, up to a screenful. */
  protected readonly skeletonRows = computed(() => Math.min(this.shown().length, 6));

  private readonly fb = inject(FormBuilder);
  private readonly ui = inject(UiSectionService);
  private readonly unsaved = inject(UnsavedChangesService);
  private readonly confirm = inject(ConfirmService);
  private readonly host = inject(ElementRef<HTMLElement>);
  /** The review, for the trace's draft state; absent in unit tests. */
  private readonly pulse = inject(AdminPulseService, { optional: true });
  private readonly previewPanel = inject(LivePreviewService, { optional: true });

  protected readonly view = signal<LocaleView>("both");
  /** English and German side by side from 1024 px; one language below it. */
  protected readonly wide = computed(() => this.previewPanel?.wide() ?? true);
  protected readonly shownView = computed<LocaleView>(() =>
    this.view() === "both" && !this.wide() ? "en" : this.view(),
  );
  /** Per field, when this editor saved it: in the draft until a review asked after that arrives. */
  private readonly savedHere = signal<ReadonlyMap<string, number>>(new Map());
  protected readonly loading = signal(true);
  protected readonly loaded = signal(false);
  readonly saving = signal(false);
  private readonly revision = signal(0);

  private updatedAt: string | null = null;
  private pristine: Record<Locale, StringRecord> | null = null;

  protected readonly form = this.fb.nonNullable.group({
    en: this.fb.nonNullable.group<StringRecord>({}),
    de: this.fb.nonNullable.group<StringRecord>({}),
  });

  /** The form as loaded or last saved: what "changed" compares with. */
  private baseline: Record<Locale, StringRecord> | null = null;

  /** Fields that differ from the saved ones: typing a value back is no change. */
  readonly changes = computed(() => {
    this.revision();
    return this.baseline ? countChangedFields(this.baseline, this.form.getRawValue()) : 0;
  });

  readonly dirty = computed(() => this.changes() > 0);

  /**
   * The group as it reads on screen, each language over what the server has
   * (fields this editor does not show keep theirs): what a live preview shows.
   */
  readonly value = computed<Record<Locale, StringRecord> | null>(() => {
    this.revision();
    if (!this.pristine) return null;
    const raw = this.form.getRawValue() as Record<Locale, StringRecord>;
    return { en: { ...this.pristine.en, ...raw.en }, de: { ...this.pristine.de, ...raw.de } };
  });

  readonly problems = computed(() => {
    this.revision();
    return countServerErrors(this.form);
  });

  /** The editor look's sections, in field order: consecutive fields with one heading share one. */
  protected readonly sections = computed(() => {
    const sections: UiSection[] = [];
    for (const field of this.shown()) {
      const title = field.section ?? this.title();
      const last = sections.at(-1);
      if (last?.title === title) last.fields.push(field);
      else sections.push({ id: title.toLowerCase().replaceAll(" ", "-"), title, fields: [field] });
    }
    return sections;
  });

  /** Each shown field's trace: unsaved over the saved form, else the review's draft against live. */
  protected readonly trace = computed<Record<string, TraceState>>(() => {
    this.revision();
    const marks = this.pulse?.marks() ?? null;
    const saved = this.savedHere();
    const raw = this.form.getRawValue() as Record<Locale, StringRecord>;
    const unsaved = new Set(this.baseline ? this.changedKeys(raw) : []);
    const trace: Record<string, TraceState> = {};
    for (const { key } of this.shown()) {
      trace[key] = traceOf(unsaved.has(key), marks, `ui.${this.group()}.${key}`, saved.get(key));
    }
    return trace;
  });

  /** The live site's text per field, for the German's notes. */
  protected readonly liveTexts = computed(() => {
    const marks = this.pulse?.marks() ?? null;
    return Object.fromEntries(
      this.shown().map((f) => [f.key, liveText(marks, `ui.${this.group()}.${f.key}`)]),
    );
  });

  /** Fields saved to the draft and not live; null until the review or a save here says. */
  protected readonly notLive = computed(() => {
    if (!this.pulse?.marks() && this.savedHere().size === 0) return null;
    return Object.values(this.trace()).filter((state) => state === "draft").length;
  });

  /** The outline: a section per entry, its dot the trace rolled up, its count the save's problems. */
  protected readonly outline = computed<OutlineItem[]>(() => {
    this.revision();
    const trace = this.trace();
    const flagged = (key: string) =>
      (["en", "de"] as const).filter((l) => this.form.controls[l].controls[key]?.hasError("server"))
        .length;
    return this.sections().map((section) => ({
      id: section.id,
      label: section.title,
      problems: section.fields.reduce((sum, f) => sum + flagged(f.key), 0),
      change: rollUp(section.fields.map((f) => trace[f.key] ?? "live")),
    }));
  });

  constructor() {
    this.form.valueChanges.subscribe(() => {
      this.revision.update((v) => v + 1);
      this.unsaved.set(`ui:${this.group()}`, this.dirty());
    });
    // Leaving a dirty editor must not keep warning about it forever.
    inject(DestroyRef).onDestroy(() => this.unsaved.clear(`ui:${this.group()}`));
    inject(RecoveryService).track<Record<Locale, StringRecord>>({
      editor: () => `ui:${this.group()}`,
      saved: () => {
        this.revision();
        return this.baseline;
      },
      current: () => {
        this.revision();
        return this.loaded() ? (this.form.getRawValue() as Record<Locale, StringRecord>) : null;
      },
      restore: (value) => {
        this.form.patchValue(value);
        this.form.markAsDirty();
      },
    });
  }

  // Not from the constructor: a page the router creates gets its first check on a later frame,
  // and a quick answer (a background tab delays that frame) read `fields` before it had a value
  // (NG0950). By ngOnInit every input is bound.
  ngOnInit(): void {
    const stored = this.look() === "editor" ? storedView(this.group()) : null;
    if (stored) this.view.set(stored);
    void this.load();
  }

  protected control(locale: Locale, key: string): FormControl<string> {
    return this.form.controls[locale].controls[key] as FormControl<string>;
  }

  /** After a failed load: asks again, with the placeholder back meanwhile. */
  protected reload(): void {
    this.loading.set(true);
    void this.load();
  }

  /** (Re)loads the group from the server, dropping any local edits. */
  async load(): Promise<void> {
    const loaded = await this.ui.loadGroup(this.group());
    this.loading.set(false);

    // The page says so, with a retry; `loaded` stays false.
    if (!loaded) return;

    // Controls are added here rather than declared up front because the field
    // list is an input and is not known until the caller binds it.
    for (const locale of ["en", "de"] as const) {
      const value = loaded.value[locale] as unknown as StringRecord;
      const group = this.form.controls[locale];
      for (const field of this.fields()) {
        const text = value?.[field.key] ?? "";
        if (group.controls[field.key]) group.controls[field.key]!.reset(text);
        else group.addControl(field.key, this.fb.nonNullable.control(text));
      }
    }

    this.updatedAt = loaded.updatedAt;
    this.pristine = {
      en: loaded.value.en as unknown as StringRecord,
      de: loaded.value.de as unknown as StringRecord,
    };
    this.form.markAsPristine();
    this.baseline = this.form.getRawValue() as Record<Locale, StringRecord>;
    this.revision.update((v) => v + 1);
    this.unsaved.clear(`ui:${this.group()}`);
    this.loaded.set(true);
  }

  /** Returns the way back; with its own save bar, the toast offers it too. */
  discard(): () => void {
    if (!this.pristine || !this.baseline) return () => undefined;
    const edits = this.form.getRawValue();
    this.form.reset(this.baseline);
    this.form.markAsPristine();
    this.revision.update((v) => v + 1);
    this.unsaved.clear(`ui:${this.group()}`);
    const undo = (): void => {
      this.form.setValue(edits);
      this.form.markAsDirty();
    };
    if (this.saveBar()) toastDiscarded(undo);
    return undo;
  }

  /** Resolves to whether the group is saved (true too when there was nothing to save). */
  async save(): Promise<boolean> {
    if (this.saving()) return false;
    if (!this.dirty()) return true;
    this.saving.set(true);

    const raw = this.form.getRawValue() as Record<Locale, StringRecord>;
    // The whole group, merged over what the server has: fields this editor
    // does not show keep their value.
    const value = {
      en: { ...this.pristine?.en, ...raw.en },
      de: { ...this.pristine?.de, ...raw.de },
    };
    const owned = this.pristine ?? { en: {}, de: {} };
    const changed = this.changedKeys(raw);
    const result = await this.ui.saveGroup(this.group(), value as never, this.updatedAt, {
      [this.group()]: owned,
    });
    this.saving.set(false);

    if (!result.ok) {
      if (result.reason === "stale") {
        if (await askStale(this.confirm)) await this.load();
        else this.updatedAt = result.version ?? this.updatedAt;
      } else if (result.reason === "invalid") {
        const unplaced = applyIssues(result.issues, ([, locale, key]) =>
          isLocale(locale) && typeof key === "string"
            ? (this.form.controls[locale].controls[key] ?? null)
            : null,
        );
        this.revision.update((v) => v + 1);
        this.showHiddenLocales(result.issues.map((i) => i.path[1]));
        toastIssues(unplaced.length ? unplaced : result.issues);
        focusFirstInvalid(this.host.nativeElement);
      } else {
        toastNotSaved(result.error, "Save failed");
      }
      return false;
    }

    this.updatedAt = result.updatedAt;
    this.pristine = value;
    this.form.markAsPristine();
    this.baseline = raw;
    const now = Date.now();
    this.savedHere.update(
      (saved) => new Map([...saved, ...changed.map((key) => [key, now] as const)]),
    );
    this.revision.update((v) => v + 1);
    this.unsaved.clear(`ui:${this.group()}`);
    // The editor look says so in its header, where Save is.
    if (this.saveBar() && this.look() === "page") toast.success("Draft saved");
    return true;
  }

  /** The fields whose text differs from what is saved, in either language. */
  private changedKeys(raw: Record<Locale, StringRecord>): string[] {
    const before = this.baseline;
    return this.fields()
      .map((f) => f.key)
      .filter((key) => raw.en[key] !== before?.en[key] || raw.de[key] !== before?.de[key]);
  }

  /** The editor look's language view, remembered for this group in this browser. */
  protected choose(view: LocaleView): void {
    this.view.set(view);
    storeView(this.group(), view);
  }

  /** A problem in a language the view hides would otherwise go unseen. */
  private showHiddenLocales(locales: unknown[]): void {
    const shown = this.shownView();
    const hidden = locales.find((l): l is Locale => isLocale(l) && shown !== "both" && l !== shown);
    // One language at a time on a narrow editor: the one with the problem.
    if (hidden) this.view.set(this.look() === "editor" && !this.wide() ? hidden : "both");
  }
}
