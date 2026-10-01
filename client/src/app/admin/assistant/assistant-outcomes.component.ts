import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from "@angular/core";
import { toast } from "@spartan-ng/brain/sonner";

import { AdminApiService } from "../admin-api.service";
import {
  funnelLine,
  HIGHER_IS_BETTER,
  METRIC_LABELS,
  PRIMARY_METRICS,
  share,
  usd,
  type OutcomesView,
  type PrimaryMetric,
} from "../outcomes";

/**
 * Whether visitors got what they came for, the evaluation stack's fifth
 * layer. No single number is trusted: "helpful" is a composite (no flag, not
 * asked again, no 👎, faithful when judged), and the primary metric rotates
 * when it moved less than a point in two weekly reviews (the rotation rule).
 */
@Component({
  selector: "app-assistant-outcomes",
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: "block" },
  template: `
    <section class="flex flex-col gap-3" aria-labelledby="assistant-outcomes">
      <h2 id="assistant-outcomes" class="m-0 text-sm font-medium">Outcomes</h2>
      @if (view(); as v) {
        @let o = v.outcomes;
        <p class="m-0 text-xs text-muted-foreground">
          The last {{ v.days }} days: {{ o.answered }} answered of {{ o.answers }} questions,
          {{ usd(o.usd) }} in all.
        </p>
        <dl class="m-0 grid grid-cols-2 gap-3 sm:grid-cols-3">
          @for (tile of tiles(v); track tile.label) {
            <div class="flex flex-col gap-0.5 rounded-lg border border-border p-3">
              <dt class="text-xs text-muted-foreground">{{ tile.label }}</dt>
              <dd class="m-0 font-mono text-lg">{{ tile.value }}</dd>
            </div>
          }
        </dl>
        <p class="m-0 text-sm">
          <span class="text-muted-foreground">Hand-offs:</span> {{ funnelLine(o.funnel) }}
        </p>

        <div class="flex flex-col gap-2 rounded-lg border border-border p-3 text-sm">
          <label class="flex flex-wrap items-center gap-2">
            <span class="text-muted-foreground">Primary metric</span>
            <select
              name="primary-metric"
              class="h-8 rounded-md border border-border bg-background px-2 text-sm"
              [value]="v.primary.metric"
              [disabled]="saving()"
              (change)="choose($any($event.target).value)"
            >
              @for (metric of metrics; track metric) {
                <option [value]="metric">{{ labels[metric] }}</option>
              }
            </select>
            <span class="text-xs text-muted-foreground">
              ({{ higher[v.primary.metric] ? "higher is better" : "lower is better" }})
            </span>
          </label>
          <ol class="m-0 flex list-none flex-wrap gap-2 p-0 font-mono text-xs">
            @for (w of v.primary.weeks; track w.week) {
              <li class="rounded border border-border px-2 py-1">
                {{ w.week }}: {{ share(w.value) }}
              </li>
            }
          </ol>
          @if (v.primary.rotate) {
            <p class="m-0 rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs">
              Flat for two weekly reviews: promote another metric, even though this one still looks
              fine.
            </p>
          }
        </div>
      } @else {
        <p class="m-0 text-xs text-muted-foreground">Loading…</p>
      }
    </section>
  `,
})
export class AssistantOutcomesComponent implements OnInit {
  private readonly api = inject(AdminApiService);

  protected readonly metrics = PRIMARY_METRICS;
  protected readonly labels = METRIC_LABELS;
  protected readonly higher = HIGHER_IS_BETTER;
  protected readonly share = share;
  protected readonly usd = usd;
  protected readonly funnelLine = funnelLine;

  protected readonly view = signal<OutcomesView | null>(null);
  protected readonly saving = signal(false);

  ngOnInit(): void {
    void this.load();
  }

  private async load(): Promise<void> {
    const result = await this.api.assistantOutcomes();
    if (result.ok) this.view.set(result.data);
    else toast.error("Could not load the outcomes", { description: result.error });
  }

  protected tiles(v: OutcomesView): { label: string; value: string }[] {
    const o = v.outcomes;
    return [
      { label: METRIC_LABELS.helpfulRate, value: share(o.helpfulRate) },
      { label: METRIC_LABELS.thumbsUpRate, value: share(o.thumbsUpRate) },
      { label: METRIC_LABELS.unknownRate, value: share(o.unknownRate) },
      { label: METRIC_LABELS.rephraseRate, value: share(o.rephraseRate) },
      { label: "Cost per answered question", value: usd(o.costPerAnswered) },
      { label: "Cost per helpful answer", value: usd(o.costPerHelpful) },
    ];
  }

  protected async choose(metric: PrimaryMetric): Promise<void> {
    this.saving.set(true);
    const result = await this.api.setPrimaryMetric(metric);
    this.saving.set(false);
    if (!result.ok) {
      toast.error("Could not change the primary metric", { description: result.error });
      return;
    }
    await this.load();
  }
}
