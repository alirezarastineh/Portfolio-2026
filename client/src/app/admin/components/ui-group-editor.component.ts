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
import { HlmSkeleton } from "@spartan-ng/helm/skeleton";

import { applyIssues, countServerErrors, focusFirstInvalid } from "../issues";
import { toastIssues, toastStale } from "../save-feedback";
import { UiSectionService, type UiGroup } from "../ui-section.service";
import { UnsavedChangesService } from "../unsaved-changes.service";
import { isLocale } from "../../content/locale";
import type { Locale } from "../../content/schema";
import { LocaleToggleComponent, SaveBarComponent } from "./editor-chrome.component";
import { FieldPairComponent, type LocaleView } from "./field-pair.component";

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
    FieldPairComponent,
    HlmSeparator,
    HlmSkeleton,
    LocaleToggleComponent,
    ReactiveFormsModule,
    SaveBarComponent,
  ],
  host: { class: "block" },
  template: `
    <div class="mx-auto flex max-w-4xl flex-col gap-6" [class.pb-24]="saveBar()">
      <header class="flex flex-wrap items-start justify-between gap-4">
        <div>
          @if (level() === 1) {
            <h1 class="m-0 font-mono text-2xl tracking-tight">{{ title() }}</h1>
          } @else {
            <h2 class="m-0 font-mono text-lg tracking-tight">{{ title() }}</h2>
          }
          @if (description()) {
            <p class="mt-1 text-sm text-muted-foreground">{{ description() }}</p>
          }
        </div>
        <app-locale-toggle [(view)]="view" />
      </header>

      @if (loading()) {
        <hlm-skeleton class="h-96 w-full" />
      } @else if (!loaded()) {
        <p class="text-sm text-muted-foreground">Could not load this section.</p>
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
            (save)="save()"
            (discard)="discard()"
          />
        }
      }
    </div>
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

  readonly dirty = computed(() => {
    this.revision();
    return this.form.dirty;
  });

  readonly problems = computed(() => {
    this.revision();
    return countServerErrors(this.form);
  });

  constructor() {
    this.form.valueChanges.subscribe(() => {
      this.revision.update((v) => v + 1);
      this.unsaved.set(`ui:${this.group()}`, this.form.dirty);
    });
    // Leaving a dirty editor must not keep warning about it forever.
    inject(DestroyRef).onDestroy(() => this.unsaved.clear(`ui:${this.group()}`));
    queueMicrotask(() => void this.load());
  }

  protected control(locale: Locale, key: string): FormControl<string> {
    return this.form.controls[locale].controls[key] as FormControl<string>;
  }

  /** (Re)loads the group from the server, dropping any local edits. */
  async load(): Promise<void> {
    const loaded = await this.ui.loadGroup(this.group());
    this.loading.set(false);

    if (!loaded) {
      toast.error("Could not load this section");
      return;
    }

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
    this.revision.update((v) => v + 1);
    this.unsaved.clear(`ui:${this.group()}`);
    this.loaded.set(true);
  }

  discard(): void {
    if (!this.pristine) return;
    this.form.reset({ en: this.pristine.en, de: this.pristine.de });
    this.form.markAsPristine();
    this.revision.update((v) => v + 1);
    this.unsaved.clear(`ui:${this.group()}`);
  }

  /** Resolves to whether the group is saved (true too when there was nothing to save). */
  async save(): Promise<boolean> {
    if (this.saving()) return false;
    if (!this.form.dirty) return true;
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
