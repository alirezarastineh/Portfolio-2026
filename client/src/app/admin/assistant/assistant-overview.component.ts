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

interface ModelTotal {
  model: string;
  requests: number;
  input: number;
  cached: number;
  output: number;
  usd: number;
}

/**
 * The assistant at a glance: is it answering, what has it cost today, how
 * fast and how often a fallback answered, each model's breaker, what the
 * corpus weighs, and 30 days of usage. The signals show what is otherwise
 * invisible: whether the fixed prefix is served from the cache, how many
 * requests the gate turned away, and how often a model invented a citation.
 */
@Component({
  selector: "app-assistant-overview",
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
      <!-- The dashboard's tiles: a figure, what it means, the detail under it. -->
      <section aria-labelledby="assistant-glance">
        <h2 id="assistant-glance" class="sr-only">The assistant at a glance</h2>
        <ul class="m-0 grid list-none gap-3 p-0 sm:grid-cols-3" role="list">
          <li appKpiTile="Status">
            <p
              class="m-0 text-h3"
              [class]="h.state.state === 'ok' ? 'text-foreground' : 'text-destructive'"
            >
              {{ stateLabel() }}
            </p>
            @if (h.state.state === "off") {
              <p class="m-0 font-mono text-xs text-muted-foreground">{{ h.state.reason }}</p>
            }
            <p class="m-0 text-xs text-muted-foreground">
              {{ h.inFlight }} {{ h.inFlight === 1 ? "answer" : "answers" }} streaming now
            </p>
          </li>
          <li appKpiTile="Spent today (UTC)">
            @if (h.state.state !== "off") {
              <p class="m-0 text-h3 tabular-nums">
                \${{ h.state.spentUsd | number: "1.2-4" }}
                <span class="text-sm font-normal text-muted-foreground"
                  >of \${{ h.state.budgetUsd | number: "1.2-2" }}</span
                >
              </p>
              <div class="h-1 overflow-hidden rounded-full bg-muted" aria-hidden="true">
                <div
                  class="h-full rounded-full bg-accent-orange"
                  [style.width.%]="spentShare()"
                ></div>
              </div>
              @if (h.state.state === "ok" && !h.state.deepAllowed) {
                <p class="m-0 text-xs text-muted-foreground">
                  Deep model off (over 80 % or disabled)
                </p>
              }
            } @else {
              <p class="m-0 text-h3 text-muted-foreground">—</p>
            }
          </li>
          <li appKpiTile="Last 24 h">
            <p class="m-0 text-h3 tabular-nums">
              {{ h.last24h.answers }}
              <span class="text-sm font-normal text-muted-foreground">{{
                h.last24h.answers === 1 ? "answer" : "answers"
              }}</span>
            </p>
            <p
              class="m-0 text-xs"
              [class]="h.last24h.failures ? 'text-destructive' : 'text-muted-foreground'"
            >
              {{ h.last24h.failures }} failed
            </p>
            <p class="m-0 text-xs text-muted-foreground">
              {{ h.last24h.fallbackRate * 100 | number: "1.0-1" }} % from a fallback
            </p>
          </li>
        </ul>
      </section>

      <section class="flex flex-col gap-2">
        <h2 class="m-0 text-sm font-medium">Models</h2>
        <div class="overflow-x-auto rounded-lg border border-border">
          <table class="w-full text-sm">
            <thead class="text-left text-xs text-muted-foreground">
              <tr>
                <th class="p-2 font-normal">Model</th>
                <th class="p-2 font-normal">Breaker</th>
                <th class="p-2 font-normal">p50 / p95 first token (24 h)</th>
                <th class="p-2 font-normal">Last success</th>
                <th class="p-2 font-normal">Last error</th>
              </tr>
            </thead>
            <tbody>
              @for (b of h.breakers; track b.model) {
                @let stats = modelStats().get(b.model);
                <tr class="border-t border-border align-top">
                  <td class="p-2 font-mono text-xs">{{ b.model }}</td>
                  <td class="p-2">
                    <span
                      hlmBadge
                      [variant]="b.state === 'closed' ? 'outline' : 'destructive'"
                      class="font-mono"
                      >{{ b.state }}</span
                    >
                  </td>
                  <td class="p-2 font-mono text-xs">
                    @if (stats) {
                      {{ stats.p50TtftMs ?? "–" }} / {{ stats.p95TtftMs ?? "–" }} ms ({{
                        stats.answers
                      }})
                    } @else {
                      –
                    }
                  </td>
                  <td class="p-2 text-xs text-muted-foreground">{{ when(b.lastSuccessAt) }}</td>
                  <td class="max-w-72 p-2 text-xs text-muted-foreground">
                    {{ b.lastError ?? "" }}
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      </section>

      @if (h.corpus; as c) {
        <section class="flex flex-col gap-2">
          <h2 class="m-0 text-sm font-medium">What it knows</h2>
          <div class="flex flex-wrap items-center gap-2 text-sm">
            @for (kind of kinds(); track kind[0]) {
              <span hlmBadge variant="outline" class="font-mono"
                >{{ kind[0] }} × {{ kind[1] }}</span
              >
            }
          </div>
          <p class="m-0 text-sm text-muted-foreground">
            Prefix sent with every question: {{ c.coreChars | number }} characters, about
            {{ c.coreTokens | number }} tokens (local estimate)
            @if (geminiCount() !== null) {
              · Gemini counts {{ geminiCount() | number }}
            }
            .
          </p>
          <div>
            <button hlmBtn variant="outline" size="sm" [disabled]="counting()" (click)="count()">
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
                class="m-0 text-h3 tabular-nums"
                [class]="c.warn ? 'text-destructive' : 'text-foreground'"
              >
                {{ c.share! * 100 | number: "1.0-0" }} %
              </p>
              <p class="m-0 text-xs text-muted-foreground">
                of {{ u.primaryModel ?? "the primary model" }}'s input came from the cache on
                {{ c.day }}
              </p>
              @if (c.warn) {
                <p class="m-0 text-xs text-destructive">
                  Under 50 %: the fixed prefix is not being reused.
                </p>
              }
            } @else {
              <p class="m-0 text-h3 text-muted-foreground">—</p>
              <p class="m-0 text-xs text-muted-foreground">
                No answers from the primary model yet.
              </p>
            }
          </li>
          <li appKpiTile="Turned away (30 days)">
            <p class="m-0 text-h3 tabular-nums">{{ refused().total }}</p>
            <p class="m-0 text-xs text-muted-foreground">
              {{ refused().kinds || "No request refused at the gate." }}
            </p>
          </li>
          <li appKpiTile="Invented citations (30 days)">
            <p class="m-0 text-h3 tabular-nums">{{ dropped().rate * 100 | number: "1.0-1" }} %</p>
            <p class="m-0 text-xs text-muted-foreground">
              {{ dropped().withDropped }} of {{ dropped().answers }} answers cited a document that
              does not exist; the marker was removed before the visitor saw it.
            </p>
          </li>
          <li appKpiTile="Flagged by checks (30 days)">
            <p class="m-0 text-h3 tabular-nums">{{ flagged().rate * 100 | number: "1.0-1" }} %</p>
            <p class="m-0 text-xs text-muted-foreground">
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
                <tr class="border-t border-border font-mono text-xs">
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
                <tr class="border-t border-border font-mono text-xs">
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
export class AssistantOverviewComponent implements OnInit {
  private readonly api = inject(AdminApiService);

  protected readonly health = signal<AssistantHealth | null>(null);
  protected readonly usage = signal<AssistantUsage | null>(null);
  protected readonly counting = signal(false);
  /** The API's reason when the health did not arrive. */
  protected readonly loadError = signal<string | null>(null);
  protected readonly geminiCount = signal<number | null>(null);

  /** "Answering", "Resting", "Off": the state in words. */
  protected readonly stateLabel = computed(() => {
    const state = this.health()?.state.state;
    if (state === "ok") return "Answering";
    return state === "resting" ? "Resting" : "Off";
  });

  protected readonly spentShare = computed(() => {
    const state = this.health()?.state;
    if (!state || state.state === "off" || !state.budgetUsd) return 0;
    return Math.min(100, (state.spentUsd / state.budgetUsd) * 100);
  });

  protected readonly modelStats = computed(
    () => new Map((this.health()?.last24h.models ?? []).map((m) => [m.model, m])),
  );

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
    if (health.ok) this.health.set(health.data);
    if (usage.ok) this.usage.set(usage.data);
  }

  protected async count(): Promise<void> {
    this.counting.set(true);
    const result = await this.api.assistantTokenCount();
    this.counting.set(false);
    if (result.ok) this.geminiCount.set(result.data.totalTokens);
    else toast.error("Gemini could not count", { description: result.error });
  }

  protected when(iso: string | null): string {
    return iso ? new Date(iso).toLocaleString() : "never";
  }
}
