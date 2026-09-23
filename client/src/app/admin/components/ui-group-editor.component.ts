import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject,
  input,
  signal,
} from "@angular/core";
import { FormBuilder, FormControl, ReactiveFormsModule } from "@angular/forms";
import { toast } from "@spartan-ng/brain/sonner";
import { HlmSeparator } from "@spartan-ng/helm/separator";
import { HlmSkeleton } from "@spartan-ng/helm/skeleton";

import { UiSectionService, type UiGroup } from "../ui-section.service";
import { UnsavedChangesService } from "../unsaved-changes.service";
import type { Locale } from "../../content/schema";
import { LocaleToggleComponent, SaveBarComponent } from "./editor-chrome.component";
import { FieldPairComponent, type LocaleView } from "./field-pair.component";

export interface UiFieldDef {
  key: string;
  label: string;
  multiline?: boolean;
  rows?: number;
  hint?: string;
}

type StringRecord = Record<string, string>;

/**
 * Drives any editor over a single group of the `ui` translation document.
 *
 * About, Contact and the section headings differ only by which fields they
 * show, so they are configuration rather than three near-identical pages.
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
    <div class="mx-auto flex max-w-4xl flex-col gap-6 pb-24">
      <header class="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 class="m-0 font-mono text-2xl tracking-tight">{{ title() }}</h1>
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
              [view]="view()"
              [controlEn]="control('en', field.key)"
              [controlDe]="control('de', field.key)"
            />
            @if (!last) {
              <hlm-separator />
            }
          }
        </form>

        <app-save-bar [dirty]="dirty()" [saving]="saving()" (save)="save()" (discard)="discard()" />
      }
    </div>
  `,
})
export class UiGroupEditorComponent {
  readonly group = input.required<UiGroup>();
  readonly title = input.required<string>();
  readonly description = input("");
  readonly fields = input.required<UiFieldDef[]>();

  private readonly fb = inject(FormBuilder);
  private readonly ui = inject(UiSectionService);
  private readonly unsaved = inject(UnsavedChangesService);

  protected readonly view = signal<LocaleView>("both");
  protected readonly loading = signal(true);
  protected readonly loaded = signal(false);
  protected readonly saving = signal(false);
  private readonly revision = signal(0);

  private updatedAt: string | null = null;
  private pristine: Record<Locale, StringRecord> | null = null;

  protected readonly form = this.fb.nonNullable.group({
    en: this.fb.nonNullable.group<StringRecord>({}),
    de: this.fb.nonNullable.group<StringRecord>({}),
  });

  protected readonly dirty = computed(() => {
    this.revision();
    return this.form.dirty;
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

  private async load(): Promise<void> {
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
      for (const field of this.fields()) {
        this.form.controls[locale].addControl(
          field.key,
          this.fb.nonNullable.control(value?.[field.key] ?? ""),
        );
      }
    }

    this.updatedAt = loaded.updatedAt;
    this.pristine = {
      en: loaded.value.en as unknown as StringRecord,
      de: loaded.value.de as unknown as StringRecord,
    };
    this.form.markAsPristine();
    this.revision.update((v) => v + 1);
    this.loaded.set(true);
  }

  protected discard(): void {
    if (!this.pristine) return;
    this.form.reset({ en: this.pristine.en, de: this.pristine.de });
    this.form.markAsPristine();
    this.revision.update((v) => v + 1);
    this.unsaved.clear(`ui:${this.group()}`);
  }

  protected async save(): Promise<void> {
    if (this.saving()) return;
    this.saving.set(true);

    const raw = this.form.getRawValue() as Record<Locale, StringRecord>;
    const result = await this.ui.saveGroup(this.group(), raw as never, this.updatedAt);
    this.saving.set(false);

    if (!result.ok) {
      if (result.reason === "stale") {
        toast.error("Saved elsewhere", {
          description: "This section changed in another tab. Reload before saving.",
        });
      } else if (result.reason === "invalid") {
        toast.error("Check the form", {
          description: "A required field is empty, or an interpolation token like {n} was removed.",
        });
      } else {
        toast.error("Save failed", { description: result.error });
      }
      return;
    }

    this.updatedAt = result.updatedAt;
    this.pristine = raw;
    this.form.markAsPristine();
    this.revision.update((v) => v + 1);
    this.unsaved.clear(`ui:${this.group()}`);
    toast.success("Draft saved");
  }
}
