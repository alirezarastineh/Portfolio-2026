import { NgTemplateOutlet } from "@angular/common";
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  ElementRef,
  inject,
  input,
  signal,
} from "@angular/core";
import { FormBuilder, FormControl, ReactiveFormsModule } from "@angular/forms";
import { toast } from "@spartan-ng/brain/sonner";
import { HlmSeparator } from "@spartan-ng/helm/separator";

import { countChangedFields } from "../changed-fields";
import { withUi, type LiveCompose } from "../preview/live-content";
import { LivePreviewToggleComponent } from "../preview/live-preview-toggle.component";
import { EditorLayoutComponent } from "./editor-layout.component";
import { applyIssues, countServerErrors, focusFirstInvalid } from "../issues";
import { toastIssues, toastStale } from "../save-feedback";
import { UiSectionService, type UiGroup } from "../ui-section.service";
import { UnsavedChangesService } from "../unsaved-changes.service";
import { isLocale } from "../../content/locale";
import type { Locale } from "../../content/schema";
import { LocaleToggleComponent, SaveBarComponent } from "./editor-chrome.component";
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
}

type StringRecord = Record<string, string>;

/**
 * Drives any editor over a single group of the `ui` translation document.
 *
 * About, Contact and the section headings differ only by which fields they
 * show, so they are configuration rather than three near-identical pages.
 *
 * With `[saveBar]="false"` it leaves saving to the page that holds it (which
 * calls `save()` / `discard()` and reads `dirty()`), so a page editing a `ui`
 * group next to something else still has one save bar.
 */
@Component({
  selector: "app-ui-group-editor",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    AdminPageHeaderComponent,
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
    <!-- As the page: in the editor frame, with its live preview when it has one. -->
    @if (level() === 1) {
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
              <h2 class="m-0 text-h4">{{ title() }}</h2>
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
            @for (field of fields(); track field.key; let last = $last) {
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
export class UiGroupEditorComponent {
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

  /** The section with the unsaved copy over the draft's. */
  protected readonly livePreview = computed<LiveCompose | null>(() => {
    const value = this.value();
    const group = this.group();
    if (!value || !this.live()) return null;
    return (base, locale) => withUi(base, locale, { [group]: value });
  });

  /** As many placeholder fields as the form will have, up to a screenful. */
  protected readonly skeletonRows = computed(() => Math.min(this.fields().length, 6));

  private readonly fb = inject(FormBuilder);
  private readonly ui = inject(UiSectionService);
  private readonly unsaved = inject(UnsavedChangesService);
  private readonly host = inject(ElementRef<HTMLElement>);

  protected readonly view = signal<LocaleView>("both");
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

  constructor() {
    this.form.valueChanges.subscribe(() => {
      this.revision.update((v) => v + 1);
      this.unsaved.set(`ui:${this.group()}`, this.dirty());
    });
    // Leaving a dirty editor must not keep warning about it forever.
    inject(DestroyRef).onDestroy(() => this.unsaved.clear(`ui:${this.group()}`));
    queueMicrotask(() => void this.load());
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

  discard(): void {
    if (!this.pristine || !this.baseline) return;
    this.form.reset(this.baseline);
    this.form.markAsPristine();
    this.revision.update((v) => v + 1);
    this.unsaved.clear(`ui:${this.group()}`);
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
    const result = await this.ui.saveGroup(this.group(), value as never, this.updatedAt);
    this.saving.set(false);

    if (!result.ok) {
      if (result.reason === "stale") {
        toastStale(() => this.load());
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
        toast.error("Save failed", { description: result.error });
      }
      return false;
    }

    this.updatedAt = result.updatedAt;
    this.pristine = value;
    this.form.markAsPristine();
    this.baseline = raw;
    this.revision.update((v) => v + 1);
    this.unsaved.clear(`ui:${this.group()}`);
    if (this.saveBar()) toast.success("Draft saved");
    return true;
  }

  /** A problem in a language the view hides would otherwise go unseen. */
  private showHiddenLocales(locales: unknown[]): void {
    const view = this.view();
    if (view !== "both" && locales.some((l) => isLocale(l) && l !== view)) this.view.set("both");
  }
}
