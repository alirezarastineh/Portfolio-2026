import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  inject,
  Injector,
  input,
  model,
} from "@angular/core";
import { FormsModule } from "@angular/forms";
import { NgIcon, provideIcons } from "@ng-icons/core";
import { lucidePlus, lucideTrash2 } from "@ng-icons/lucide";
import { HlmButton } from "@spartan-ng/helm/button";
import { HlmTextarea } from "@spartan-ng/helm/textarea";

import type { MetricInput } from "../admin-schema";
import type { Locale } from "../../content/schema";
import type { LocaleView } from "./field-pair.component";

const MAX = 6;
const PARTS = ["value", "label", "context"] as const;
type Part = (typeof PARTS)[number];
const LANGUAGE: Record<Locale, string> = { en: "English", de: "German" };
const PLACEHOLDER: Record<Part, string> = {
  value: "40%",
  label: "less latency",
  context: "Context (optional)",
};

/**
 * A case study's big numbers (plan 5, U13): one row per metric, its value, label and context in
 * each language shown, so a metric and its translation sit on one line (six cells under Both;
 * `.metrics-row` in `admin.css`). Each language keeps its own list ("40%" against "40 %"); a row is
 * the same place in both, and Add and Remove act on the row. Every cell grows with its text: a
 * long label wraps, never cut. On a phone, value and label share a line and the context sits under.
 */
@Component({
  selector: "app-metrics-editor",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, HlmButton, HlmTextarea, NgIcon],
  viewProviders: [provideIcons({ lucidePlus, lucideTrash2 })],
  host: { class: "block" },
  template: `
    <div class="flex flex-col gap-2">
      <div class="flex items-baseline justify-between">
        <span class="text-sm font-medium">Metrics</span>
        <span class="text-xs tabular-nums text-faint-foreground">{{ count() }} / {{ max }}</span>
      </div>
      @if (count()) {
        <div
          class="metrics-row metrics-heads text-hint text-muted-foreground"
          [attr.data-languages]="locales().length"
          aria-hidden="true"
        >
          @if (locales().length > 1) {
            <span class="col-span-3">English</span><span class="col-span-3">German</span
            ><span></span>
          }
          @for (locale of locales(); track locale) {
            <span>Value</span><span>Label</span><span>Context</span>
          }
          <span></span>
        </div>
      }
      @for (row of rows(); track $index; let i = $index) {
        <div class="metrics-row" [attr.data-languages]="locales().length">
          @for (locale of locales(); track locale) {
            @for (part of parts; track part) {
              <textarea
                hlmTextarea
                rows="1"
                autocomplete="off"
                class="min-h-9 py-1.5"
                [attr.data-part]="part"
                [id]="'metric-' + i + '-' + part + '-' + locale"
                [attr.lang]="locale"
                [placeholder]="placeholder[part]"
                [attr.aria-label]="'Metric ' + (i + 1) + ' ' + part + ', ' + language[locale]"
                [ngModel]="cell(locale, i, part)"
                [ngModelOptions]="{ standalone: true }"
                (ngModelChange)="update(locale, i, part, $event)"
              ></textarea>
            }
          }
          <button
            hlmBtn
            variant="ghost"
            size="sm"
            type="button"
            class="h-9 px-2 text-muted-foreground hover:text-destructive"
            data-part="remove"
            data-remove
            [attr.aria-label]="'Remove metric ' + (i + 1)"
            (click)="remove(i)"
          >
            <ng-icon name="lucideTrash2" size="14" aria-hidden="true" />
          </button>
        </div>
      }
      <button
        hlmBtn
        variant="outline"
        size="sm"
        type="button"
        class="self-start"
        data-add
        [disabled]="count() >= max"
        (click)="add()"
      >
        <ng-icon name="lucidePlus" size="14" aria-hidden="true" />
        <span class="ml-1.5">Add metric</span>
      </button>
    </div>
  `,
})
export class MetricsEditorComponent {
  readonly en = model.required<MetricInput[]>();
  readonly de = model.required<MetricInput[]>();
  readonly view = input<LocaleView>("both");

  protected readonly max = MAX;
  protected readonly parts = PARTS;
  protected readonly language = LANGUAGE;
  protected readonly placeholder = PLACEHOLDER;
  protected readonly locales = computed<Locale[]>(() => {
    const view = this.view();
    return view === "both" ? ["en", "de"] : [view];
  });
  /** As many rows as the longer list: a missing cell is empty until typed into. */
  protected readonly count = computed(() => Math.max(this.en().length, this.de().length));
  protected readonly rows = computed(() => Array.from({ length: this.count() }));

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);

  protected cell(locale: Locale, index: number, part: Part): string {
    return this.list(locale)()[index]?.[part] ?? "";
  }

  protected update(locale: Locale, index: number, part: Part, text: string): void {
    this.list(locale).update((list) => {
      const next = [...list];
      while (next.length <= index) {
        next.push({ value: "", label: "" });
      }
      const metric: MetricInput = { ...next[index], [part]: text };
      if (!metric.context) {
        delete metric.context;
      }
      next[index] = metric;
      return next;
    });
  }

  protected add(): void {
    const at = this.count();
    for (const locale of ["en", "de"] as const) {
      this.list(locale).update((list) => [
        ...list,
        ...Array.from({ length: at + 1 - list.length }, () => ({ value: "", label: "" })),
      ]);
    }
    const first = this.locales()[0];
    this.afterRender((root) =>
      root.querySelector<HTMLElement>(`#metric-${at}-value-${first}`)?.focus(),
    );
  }

  protected remove(index: number): void {
    for (const locale of ["en", "de"] as const) {
      this.list(locale).update((list) => list.filter((_, i) => i !== index));
    }
    // The button went with its row: the next row's Remove takes the focus, else Add.
    this.afterRender((root) => {
      const removes = root.querySelectorAll<HTMLElement>("[data-remove]");
      (
        removes[Math.min(index, removes.length - 1)] ??
        root.querySelector<HTMLElement>("[data-add]")
      )?.focus();
    });
  }

  private list(locale: Locale) {
    return locale === "en" ? this.en : this.de;
  }

  private afterRender(run: (root: HTMLElement) => void): void {
    afterNextRender(() => run(this.host.nativeElement), { injector: this.injector });
  }
}
