import { DecimalPipe } from "@angular/common";
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  OnInit,
  signal,
} from "@angular/core";
import { toast } from "@spartan-ng/brain/sonner";
import { HlmBadge } from "@spartan-ng/helm/badge";
import { HlmButton } from "@spartan-ng/helm/button";

import { KpiTileComponent } from "../components/kpi-tile.component";
import { FormSkeletonComponent, LoadErrorComponent } from "../components/load-state.component";
import { AdminApiService } from "../admin-api.service";
import {
  cacheDays,
  checkLabel,
  dayRows,
  droppedRate,
  refusalTotals,
  shareOf,
  type DayRow,
} from "../answer-trace";
import type { AssistantHealth, AssistantUsage } from "../assistant-types";
import { mcpSummary } from "../mcp-usage";
import { featureRows, stateLabel } from "../spending";

interface ModelTotal {
  model: string;
  requests: number;
  input: number;
  cached: number;
  output: number;
  usd: number;
}

/**
 * The assistant's usage, a report in Quality (plan 5, U18; the Overview's lower half, while Now
 * says the state, today's spend and the models in words): spending by feature over the period,
 * what the corpus weighs, and 30 days of usage. The signals show what is otherwise invisible:
 * whether the fixed prefix is served from the cache, how many requests the gate turned away, and
 * how often a model invented a citation.
 */
@Component({
  selector: "app-assistant-usage",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DecimalPipe,
    FormSkeletonComponent,
    HlmBadge,
    HlmButton,
    KpiTileComponent,
    LoadErrorComponent,
  ],
  host: { class: "block" },
  template: `
    @if (loadError(); as reason) {
      <app-load-error
        title="Could not load the assistant's health"
        [reason]="reason"
        (retry)="reload()"
      />
    } @else if (!health()) {
      <app-form-skeleton kind="list" [rows]="3" label="Loading the assistant's health…" />
    } @else {
      @let h = health()!;
      @if (h.spend) {
        <section class="flex flex-col gap-2" aria-labelledby="assistant-spend">
          <h2 id="assistant-spend" class="m-0 text-sm font-medium">Spending by feature</h2>
          <div class="overflow-x-auto rounded-lg border border-border">
            <table class="w-full text-sm">
              <thead class="text-left text-xs text-muted-foreground">
                <tr>
                  <th class="p-2 font-normal">Feature</th>
                  <th class="p-2 text-right font-normal">Today</th>
                  <th class="p-2 text-right font-normal">Own cap</th>
                  <th class="p-2 text-right font-normal">30 days</th>
                  <th class="p-2 font-normal">Now</th>
                </tr>
              </thead>
              <tbody>
                @for (f of features(); track f.feature) {
                  <tr class="border-t border-border">
                    <td class="p-2">{{ f.label }}</td>
                    <td class="p-2 text-right font-data text-xs">
                      \${{ f.todayUsd | number: "1.2-4" }}
                    </td>
                    <td class="p-2 text-right font-data text-xs">
                      {{ f.capUsd === null ? "–" : "$" + (f.capUsd | number: "1.2-2") }}
                    </td>
                    <td class="p-2 text-right font-data text-xs">
                      \${{ f.periodUsd | number: "1.2-4" }}
                    </td>
                    <td
                      class="p-2 text-xs"
                      [class]="
                        f.state === 'ok' || f.state === null
                          ? 'text-muted-foreground'
                          : 'text-destructive'
                      "
                    >
                      {{ f.state ? stateText(f.state) : "–" }}
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
          @if (h.models; as guard) {
            @if (guard.freeOnly && guard.excluded.length) {
              <p class="m-0 text-hint text-muted-foreground">
                Left out by the free-tier guard, since they bill:
                <span class="font-data">{{ guard.excluded.join(", ") }}</span>
              </p>
            }
          }
        </section>
      }

      @if (h.corpus; as c) {
        <section class="flex flex-col gap-2">
          <h2 class="m-0 text-sm font-medium">What it knows</h2>
          <div class="flex flex-wrap items-center gap-2 text-sm">
            @for (kind of kinds(); track kind[0]) {
              <span hlmBadge variant="outline">{{ kind[0] }} × {{ kind[1] }}</span>
            }
          </div>
          @if (c.byLocale; as by) {
            <p class="m-0 text-sm text-muted-foreground">
              Prefix sent with every question, per answer language: English
              {{ by.en.chars | number }} characters, about {{ by.en.tokens | number }} tokens;
              German {{ by.de.chars | number }}, about {{ by.de.tokens | number }} (local estimates)
              @if (geminiCount(); as g) {
                · Gemini counts English {{ g.en === null ? "–" : (g.en | number) }}, German
                {{ g.de === null ? "–" : (g.de | number) }}
              }
              .
            </p>
          } @else {
            <p class="m-0 text-sm text-muted-foreground">
              Prefix sent with every question: {{ c.coreChars | number }} characters, about
              {{ c.coreTokens | number }} tokens (local estimate)
              @if (geminiCount(); as g) {
                · Gemini counts {{ g.en | number }}
              }
              .
            </p>
          }
          @if (c.embeddings; as e) {
            <p class="m-0 text-sm text-muted-foreground">
              @if (e.on) {
                Search by meaning ({{ e.model }}): {{ e.embedded | number }} of
                {{ e.chunks | number }} passages have a vector; the switch is in Settings →
                Spending.
              } @else {
                Search by meaning is off on this server (SERVER_AI_EMBEDDINGS): the search matches
                words alone.
              }
            </p>
          }
          <div>
            <button
              hlmBtn
              type="button"
              variant="outline"
              size="sm"
              [disabled]="counting()"
              (click)="count()"
            >
              Count with Gemini
            </button>
          </div>
        </section>
      }
    }

    @if (usage(); as u) {
      <section class="flex flex-col gap-2" aria-labelledby="assistant-signals">
        <h2 id="assistant-signals" class="m-0 text-sm font-medium">Signals</h2>
        <ul class="m-0 grid list-none gap-3 p-0 sm:grid-cols-2 xl:grid-cols-4" role="list">
          <li appKpiTile="Cache hits">
            @if (latestCache(); as c) {
              <p
                class="m-0 text-figure tabular-nums"
                [class]="c.warn ? 'text-destructive' : 'text-foreground'"
              >
                {{ c.share! * 100 | number: "1.0-0" }} %
              </p>
              <p class="m-0 text-hint text-muted-foreground">
                of {{ u.primaryModel ?? "the primary model" }}'s input came from the cache on
                {{ c.day }}
              </p>
              @if (c.warn) {
                <p class="m-0 text-xs text-destructive">
                  Under 50 %: the fixed prefix is not being reused.
                </p>
              }
            } @else {
              <p class="m-0 text-figure text-muted-foreground">—</p>
              <p class="m-0 text-hint text-muted-foreground">
                No answers from the primary model yet.
              </p>
            }
          </li>
          <li appKpiTile="Turned away (30 days)">
            <p class="m-0 text-figure tabular-nums">{{ refused().total }}</p>
            <p class="m-0 text-hint text-muted-foreground">
              {{ refused().kinds || "No request refused at the gate." }}
            </p>
          </li>
          <li appKpiTile="MCP calls (30 days)">
            <p class="m-0 text-figure tabular-nums">{{ mcp().calls }}</p>
            <p class="m-0 text-hint text-muted-foreground">
              @if (mcp().calls || mcp().refused) {
                {{ mcp().tools || "No tool called yet." }}
                @if (mcp().refused) {
                  · {{ mcp().refused }} refused ({{ mcp().reasons }})
                }
              } @else {
                No agent has read the portfolio over MCP yet.
              }
            </p>
          </li>
          <li appKpiTile="Invented citations (30 days)">
            <p class="m-0 text-figure tabular-nums">
              {{ dropped().rate * 100 | number: "1.0-1" }} %
            </p>
            <p class="m-0 text-hint text-muted-foreground">
              {{ dropped().withDropped }} of {{ dropped().answers }} answers cited a document that
              does not exist; the marker was removed before the visitor saw it.
            </p>
          </li>
          <li appKpiTile="Flagged by checks (30 days)">
            <p class="m-0 text-figure tabular-nums">
              {{ flagged().rate * 100 | number: "1.0-1" }} %
            </p>
            <p class="m-0 text-hint text-muted-foreground">
              {{ flagged().count }} of {{ flagged().answers }} answers.
              {{ flagKinds() || "No check raised a flag." }}
            </p>
          </li>
        </ul>
      </section>

      <section class="flex flex-col gap-2">
        <h2 class="m-0 text-sm font-medium">Last 30 days</h2>
        <div class="overflow-x-auto rounded-lg border border-border">
          <table class="w-full text-sm">
            <thead class="text-left text-xs text-muted-foreground">
              <tr>
                <th class="p-2 font-normal">Model</th>
                <th class="p-2 text-right font-normal">Calls</th>
                <th class="p-2 text-right font-normal">Input</th>
                <th class="p-2 text-right font-normal">Cached</th>
                <th class="p-2 text-right font-normal">Output</th>
                <th class="p-2 text-right font-normal">Cost</th>
              </tr>
            </thead>
            <tbody>
              @for (m of modelTotals(); track m.model) {
                <tr class="border-t border-border font-data text-xs">
                  <td class="p-2">{{ m.model }}</td>
                  <td class="p-2 text-right">{{ m.requests | number }}</td>
                  <td class="p-2 text-right">{{ m.input | number }}</td>
                  <td class="p-2 text-right">
                    {{ m.input ? ((m.cached / m.input) * 100 | number: "1.0-0") : 0 }} %
                  </td>
                  <td class="p-2 text-right">{{ m.output | number }}</td>
                  <td class="p-2 text-right">\${{ m.usd | number: "1.2-4" }}</td>
                </tr>
              } @empty {
                <tr>
                  <td class="p-2 text-muted-foreground" colspan="6">No model calls yet.</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
        <div class="overflow-x-auto rounded-lg border border-border">
          <table class="w-full text-sm">
            <thead class="text-left text-xs text-muted-foreground">
              <tr>
                <th class="p-2 font-normal">Day</th>
                <th class="p-2 text-right font-normal">Answers</th>
                <th class="p-2 text-right font-normal">+1 / −1</th>
                <th class="p-2 text-right font-normal">Cache hits</th>
                <th class="p-2 text-right font-normal">Invented</th>
                <th class="p-2 text-right font-normal">Flagged</th>
                <th class="p-2 text-right font-normal">Turned away</th>
                <th class="p-2 text-right font-normal">Cost</th>
              </tr>
            </thead>
            <tbody>
              @for (d of days(); track d.day) {
                <tr class="border-t border-border font-data text-xs">
                  <td class="p-2">{{ d.day }}</td>
                  <td class="p-2 text-right">{{ d.answers }}</td>
                  <td class="p-2 text-right">{{ d.up }} / {{ d.down }}</td>
                  <td class="p-2 text-right" [class]="d.cacheWarn ? 'text-destructive' : ''">
                    {{ d.cache === null ? "–" : (d.cache * 100 | number: "1.0-0") + " %" }}
                  </td>
                  <td class="p-2 text-right">{{ d.withDropped }}</td>
                  <td class="p-2 text-right">{{ d.flagged }}</td>
                  <td class="p-2 text-right" [title]="d.refusedKinds">{{ d.refused }}</td>
                  <td class="p-2 text-right">\${{ d.usd | number: "1.2-4" }}</td>
                </tr>
              } @empty {
                <tr>
                  <td class="p-2 text-muted-foreground" colspan="8">No answers yet.</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      </section>
    }
  `,
})
export class AssistantUsageComponent implements OnInit {
  private readonly api = inject(AdminApiService);

  protected readonly health = signal<AssistantHealth | null>(null);
  protected readonly usage = signal<AssistantUsage | null>(null);
  protected readonly counting = signal(false);
  /** The API's reason when the health did not arrive. */
  protected readonly loadError = signal<string | null>(null);
  /** Gemini's own count of each language's prefix, once asked. */
  protected readonly geminiCount = signal<{ en: number | null; de: number | null } | null>(null);

  /** Each feature's spend today and over the period, and what its next call would get. */
  protected readonly features = computed(() => featureRows(this.health()?.spend, this.usage()));

  protected readonly stateText = stateLabel;

  protected readonly kinds = computed(() => Object.entries(this.health()?.corpus?.documents ?? {}));

  protected readonly modelTotals = computed<ModelTotal[]>(() => {
    const totals = new Map<string, ModelTotal>();
    for (const row of this.usage()?.models ?? []) {
      const t = totals.get(row.model) ?? {
        model: row.model,
        requests: 0,
        input: 0,
        cached: 0,
        output: 0,
        usd: 0,
      };
      t.requests += row.requests;
      t.input += row.inputTokens;
      t.cached += row.cachedInputTokens;
      t.output += row.outputTokens + row.thoughtTokens;
      t.usd += row.usd;
      totals.set(row.model, t);
    }
    return [...totals.values()].sort((a, b) => b.usd - a.usd);
  });

  /** The newest day on which the primary model answered, with its cache hits. */
  protected readonly latestCache = computed(
    () => cacheDays(this.usage()?.answers ?? []).find((d) => d.share !== null) ?? null,
  );

  protected readonly refused = computed(() => {
    const totals = refusalTotals(this.usage()?.guardEvents ?? []);
    return {
      total: totals.reduce((sum, t) => sum + t.count, 0),
      kinds: totals.map((t) => `${t.kind} ${t.count}`).join(" · "),
    };
  });

  /** What agents asked of the read-only MCP endpoint (plan phase 32). */
  protected readonly mcp = computed(() => mcpSummary(this.usage()?.mcp ?? []));

  protected readonly dropped = computed(() => droppedRate(this.usage()?.answers ?? []));

  protected readonly flagged = computed(() => shareOf(this.usage()?.answers ?? [], "flagged"));

  /** "uncited 4 · fallback answered 2": each flag the checks raised, most frequent first. */
  protected readonly flagKinds = computed(() =>
    (this.usage()?.checks ?? []).map((c) => `${checkLabel(c.flag)} ${c.count}`).join(" · "),
  );

  protected readonly days = computed<DayRow[]>(() => {
    const usage = this.usage();
    return usage ? dayRows(usage) : [];
  });

  ngOnInit(): void {
    void this.load();
  }

  protected reload(): void {
    this.loadError.set(null);
    void this.load();
  }

  async load(): Promise<void> {
    const [health, usage] = await Promise.all([
      this.api.assistantHealth(),
      this.api.assistantUsage(30),
    ]);
    this.loadError.set(health.ok ? null : health.error);
    if (health.ok) {
      this.health.set(health.data);
    }
    if (usage.ok) {
      this.usage.set(usage.data);
    }
  }

  protected async count(): Promise<void> {
    this.counting.set(true);
    const result = await this.api.assistantTokenCount();
    this.counting.set(false);
    if (result.ok) {
      const by = result.data.byLocale;
      this.geminiCount.set({
        en: by?.en.totalTokens ?? result.data.totalTokens,
        de: by?.de.totalTokens ?? null,
      });
    } else {
      toast.error("Gemini could not count", { description: result.error });
    }
  }
}
