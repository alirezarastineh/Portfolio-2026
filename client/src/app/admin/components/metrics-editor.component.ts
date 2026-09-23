import { ChangeDetectionStrategy, Component, input, model } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { NgIcon, provideIcons } from "@ng-icons/core";
import { lucidePlus, lucideTrash2 } from "@ng-icons/lucide";
import { HlmButton } from "@spartan-ng/helm/button";
import { HlmInput } from "@spartan-ng/helm/input";

import type { MetricInput } from "../admin-schema";

const MAX = 6;

/**
 * The big numbers of a case study, per language — formatting differs
 * ("40%" vs "40 %"), so each language keeps its own.
 */
@Component({
  selector: "app-metrics-editor",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, HlmButton, HlmInput, NgIcon],
  viewProviders: [provideIcons({ lucidePlus, lucideTrash2 })],
  host: { class: "block" },
  template: `
    <div class="flex flex-col gap-2">
      <div class="flex items-baseline justify-between">
        <span class="font-mono text-[0.8rem]">{{ label() }}</span>
        <span class="font-mono text-[0.7rem] text-muted-foreground"
          >{{ value().length }} / {{ max }}</span
        >
      </div>
      @for (metric of value(); track $index; let i = $index) {
        <div
          class="grid grid-cols-[6rem_minmax(0,1fr)_auto] gap-2 sm:grid-cols-[6rem_minmax(0,1fr)_minmax(0,1fr)_auto]"
        >
          <input
            hlmInput
            class="h-8"
            placeholder="40%"
            [ngModel]="metric.value"
            (ngModelChange)="update(i, { value: $event })"
            [attr.aria-label]="label() + ' ' + (i + 1) + ' value'"
          />
          <input
            hlmInput
            class="h-8"
            placeholder="less latency"
            [ngModel]="metric.label"
            (ngModelChange)="update(i, { label: $event })"
            [attr.aria-label]="label() + ' ' + (i + 1) + ' label'"
          />
          <input
            hlmInput
            class="hidden h-8 sm:block"
            placeholder="context (optional)"
            [ngModel]="metric.context ?? ''"
            (ngModelChange)="update(i, { context: $event })"
            [attr.aria-label]="label() + ' ' + (i + 1) + ' context'"
          />
          <button
            hlmBtn
            variant="ghost"
            size="sm"
            type="button"
            class="h-8 px-2 text-muted-foreground hover:text-destructive"
            (click)="remove(i)"
            [attr.aria-label]="'Remove ' + label() + ' ' + (i + 1)"
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
        [disabled]="value().length >= max"
        (click)="add()"
      >
        <ng-icon name="lucidePlus" size="14" aria-hidden="true" />
        <span class="ml-1.5">Add metric</span>
      </button>
    </div>
  `,
})
export class MetricsEditorComponent {
  readonly value = model.required<MetricInput[]>();
  readonly label = input("Metrics");
  protected readonly max = MAX;

  protected update(index: number, change: Partial<MetricInput>): void {
    this.value.update((list) =>
      list.map((metric, i) => {
        if (i !== index) return metric;
        const next = { ...metric, ...change };
        if (!next.context) delete next.context;
        return next;
      }),
    );
  }

  protected add(): void {
    this.value.update((list) => [...list, { value: "", label: "" }]);
  }

  protected remove(index: number): void {
    this.value.update((list) => list.filter((_, i) => i !== index));
  }
}
