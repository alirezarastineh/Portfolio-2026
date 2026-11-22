import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from "@angular/core";
import { toast } from "@spartan-ng/brain/sonner";
import { HlmTableImports } from "@spartan-ng/helm/table";

import { AdminApiService } from "../admin-api.service";
import { apiWords } from "../api-words";
import { LoadErrorComponent } from "../components/load-state.component";
import {
  browserTiles,
  tourLine,
  downReasonLine,
  matchLine,
  matchRowsLine,
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
 * A report in words (plan 5, U22): its figures in tables, not tiles.
 */
@Component({
  selector: "app-assistant-outcomes",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [HlmTableImports, LoadErrorComponent],
  host: { class: "block" },
  template: `
    <section class="flex flex-col gap-3" aria-labelledby="assistant-outcomes">
      <h2 #heading id="assistant-outcomes" tabindex="-1" class="m-0 text-section-title">
        Outcomes
      </h2>
      @if (view(); as v) {
        @let o = v.outcomes;
        @if (o.answers) {
          <p class="m-0 max-w-prose text-hint text-muted-foreground">
            The last {{ v.days }} days: {{ o.answered }} answered of {{ o.answers }} questions,
            {{ usd(o.usd) }} in all.
          </p>
          <div hlmTableContainer>
            <table hlmTable class="max-w-xl">
              <caption class="sr-only">
                The outcomes over the last
                {{
                  v.days
                }}
                days
              </caption>
              <thead hlmTHead>
                <tr hlmTr>
                  <th hlmTh scope="col">Measure</th>
                  <th hlmTh scope="col" class="text-right">Last {{ v.days }} days</th>
                </tr>
              </thead>
              <tbody hlmTBody>
                @for (row of figures(v); track row.label) {
                  <tr hlmTr>
                    <th hlmTh scope="row" class="font-normal">{{ row.label }}</th>
                    <td hlmTd class="text-right font-data text-xs">{{ row.value }}</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
          <p class="m-0 max-w-prose text-sm">
            <span class="text-muted-foreground">Hand-offs:</span> {{ funnelLine(o.funnel) }}.
          </p>
          <!-- The guided tours (visitor plan V16): not answers, so counted here alone. -->
          @if (v.tours; as t) {
            <p class="m-0 max-w-prose text-sm">
              <span class="text-muted-foreground">Tours:</span> {{ tourLine(t) }}.
            </p>
          }
          <!-- Matched briefs (visitor plan V20): no answers either; each kind to the hand-off, and
               the rows the critic took back, which the nightly trust check watches. -->
          @if (v.matches; as m) {
            <p class="m-0 max-w-prose text-sm">
              <span class="text-muted-foreground">Matches:</span> {{ matchLine(m) }}.
            </p>
            @if (m.runs) {
              <p class="m-0 max-w-prose text-sm">
                <span class="text-muted-foreground">Match rows:</span> {{ matchRowsLine(m) }}.
              </p>
            }
          }

          <!-- What the visitors' browsers saw (visitor plan V2); an older API sends none. -->
          @if (v.browser; as b) {
            <section class="flex flex-col gap-2" aria-labelledby="assistant-browser">
              <h3 id="assistant-browser" class="m-0 text-sm font-medium">
                In the visitor's browser
                <span class="font-normal text-muted-foreground"
                  >({{ b.reported }} {{ b.reported === 1 ? "answer" : "answers" }} reported)</span
                >
              </h3>
              <div hlmTableContainer>
                <table hlmTable>
                  <caption class="sr-only">
                    What the visitors' browsers saw
                  </caption>
                  <thead hlmTHead>
                    <tr hlmTr>
                      <th hlmTh scope="col">Measure</th>
                      <th hlmTh scope="col" class="text-right">Value</th>
                      <th hlmTh scope="col">Beside it</th>
                    </tr>
                  </thead>
                  <tbody hlmTBody>
                    @for (tile of browserTiles(b); track tile.label) {
                      <tr hlmTr>
                        <th hlmTh scope="row" class="font-normal whitespace-normal">
                          {{ tile.label }}
                        </th>
                        <td hlmTd class="text-right font-data text-xs">{{ tile.value }}</td>
                        <td hlmTd class="text-xs whitespace-normal text-muted-foreground">
                          {{ tile.detail ?? "" }}
                        </td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
              @if (downReasonLine(b); as line) {
                <p class="m-0 max-w-prose text-sm">{{ line }}</p>
              }
            </section>
          }
        } @else {
          <p class="m-0 text-hint text-muted-foreground">
            No visitor question in the last {{ v.days }} days.
          </p>
        }

        <div class="flex flex-col gap-2 text-sm">
          <label class="flex flex-wrap items-center gap-2">
            <span class="font-medium">Primary metric</span>
            <select
              name="primary-metric"
              class="h-9 pointer-coarse:h-11 rounded-lg border border-input-line bg-card px-2 text-sm pointer-coarse:text-base"
              [value]="v.primary.metric"
              [disabled]="saving()"
              (change)="choose($any($event.target).value)"
            >
              @for (metric of metrics; track metric) {
                <option [value]="metric">{{ labels[metric] }}</option>
              }
            </select>
            <span class="text-hint text-muted-foreground">
              ({{ higher[v.primary.metric] ? "higher is better" : "lower is better" }})
            </span>
          </label>
          @if (v.primary.weeks.length) {
            <div hlmTableContainer>
              <table hlmTable class="max-w-xs">
                <caption class="sr-only">
                  The primary metric at each weekly review
                </caption>
                <thead hlmTHead>
                  <tr hlmTr>
                    <th hlmTh scope="col">Week</th>
                    <th hlmTh scope="col" class="text-right">Value</th>
                  </tr>
                </thead>
                <tbody hlmTBody>
                  @for (w of v.primary.weeks; track w.week) {
                    <tr hlmTr class="font-data text-xs">
                      <th hlmTh scope="row" class="font-normal">{{ w.week }}</th>
                      <td hlmTd class="text-right">{{ share(w.value) }}</td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          }
          @if (v.primary.rotate) {
            <p class="m-0 max-w-prose font-medium">
              Flat for two weekly reviews: promote another metric, even though this one still looks
              fine.
            </p>
          }
        </div>
      } @else if (loadError(); as code) {
        <app-load-error
          compact
          title="Could not load the outcomes"
          [reason]="code"
          [refocus]="heading"
          (retry)="retry()"
        />
      } @else {
        <p class="m-0 text-hint text-muted-foreground">Loading the outcomes…</p>
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
  protected readonly browserTiles = browserTiles;
  protected readonly downReasonLine = downReasonLine;
  protected readonly tourLine = tourLine;
  protected readonly matchLine = matchLine;
  protected readonly matchRowsLine = matchRowsLine;

  protected readonly view = signal<OutcomesView | null>(null);
  /** Why the outcomes did not arrive (the API's code): said, with Try again, never "Loading…" for ever. */
  protected readonly loadError = signal<string | null>(null);
  protected readonly saving = signal(false);

  ngOnInit(): void {
    void this.load();
  }

  private async load(): Promise<void> {
    const result = await this.api.assistantOutcomes();
    if (result.ok) {
      this.view.set(result.data);
      this.loadError.set(null);
    } else if (this.view()) {
      toast.error("Could not load the outcomes", { description: apiWords(result.error) });
    } else {
      this.loadError.set(result.error);
    }
  }

  protected retry(): void {
    void this.load();
  }

  /** The month's figures, each a row: its name and its value in words. */
  protected figures(v: OutcomesView): { label: string; value: string }[] {
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
      toast.error("Could not change the primary metric", { description: apiWords(result.error) });
      return;
    }
    await this.load();
  }
}
