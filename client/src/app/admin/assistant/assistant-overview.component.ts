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
import { HlmSkeleton } from "@spartan-ng/helm/skeleton";

import { AdminApiService } from "../admin-api.service";
import type { AnswersRow, AssistantHealth, UsageRow } from "../assistant-types";

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
 * corpus weighs, and 30 days of usage.
 */
@Component({
  selector: "app-assistant-overview",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DecimalPipe, HlmBadge, HlmButton, HlmSkeleton],
  host: { class: "block" },
  template: `
    @if (!health()) {
      <hlm-skeleton class="h-64 w-full" />
    } @else {
      @let h = health()!;
      <section class="grid gap-4 sm:grid-cols-3">
        <div class="rounded-lg border border-border p-4">
          <p class="m-0 text-xs text-muted-foreground">Status</p>
          <p class="m-0 mt-1 flex items-center gap-2">
            <span hlmBadge [variant]="h.state.state === 'ok' ? 'default' : 'destructive'">{{
              h.state.state
            }}</span>
            @if (h.state.state === "off") {
              <span class="font-mono text-xs text-muted-foreground">{{ h.state.reason }}</span>
            }
          </p>
          <p class="m-0 mt-2 text-xs text-muted-foreground">
            {{ h.inFlight }} answer(s) streaming now
          </p>
        </div>
        <div class="rounded-lg border border-border p-4">
          <p class="m-0 text-xs text-muted-foreground">Spent today (UTC)</p>
          @if (h.state.state !== "off") {
            <p class="m-0 mt-1 font-mono text-lg">
              \${{ h.state.spentUsd | number: "1.2-4" }}
              <span class="text-sm text-muted-foreground"
                >/ \${{ h.state.budgetUsd | number: "1.2-2" }}</span
              >
            </p>
            <div class="mt-2 h-1.5 rounded bg-muted" aria-hidden="true">
              <div class="h-1.5 rounded bg-primary" [style.width.%]="spentShare()"></div>
            </div>
            @if (h.state.state === "ok" && !h.state.deepAllowed) {
              <p class="m-0 mt-2 text-xs text-muted-foreground">
                Deep model off (over 80 % or disabled)
              </p>
            }
          } @else {
            <p class="m-0 mt-1 text-sm text-muted-foreground">—</p>
          }
        </div>
        <div class="rounded-lg border border-border p-4">
          <p class="m-0 text-xs text-muted-foreground">Last 24 h</p>
          <p class="m-0 mt-1 font-mono text-lg">{{ h.last24h.answers }} answers</p>
          <p class="m-0 mt-1 text-xs text-muted-foreground">
            {{ h.last24h.failures }} failed · {{ h.last24h.fallbackRate * 100 | number: "1.0-1" }} %
            from a fallback
          </p>
        </div>
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
                      class="font-mono text-[0.65rem]"
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
              <span hlmBadge variant="outline" class="font-mono text-[0.7rem]"
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
                <th class="p-2 text-right font-normal">Cost</th>
              </tr>
            </thead>
            <tbody>
              @for (d of days(); track d.day) {
                <tr class="border-t border-border font-mono text-xs">
                  <td class="p-2">{{ d.day }}</td>
                  <td class="p-2 text-right">{{ d.answers }}</td>
                  <td class="p-2 text-right">{{ d.up }} / {{ d.down }}</td>
                  <td class="p-2 text-right">\${{ d.usd | number: "1.2-4" }}</td>
                </tr>
              } @empty {
                <tr>
                  <td class="p-2 text-muted-foreground" colspan="4">No answers yet.</td>
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
  protected readonly usage = signal<{ models: UsageRow[]; answers: AnswersRow[] } | null>(null);
  protected readonly counting = signal(false);
  protected readonly geminiCount = signal<number | null>(null);

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

  protected readonly days = computed(() => {
    const usage = this.usage();
    if (!usage) return [];
    const byDay = new Map<
      string,
      { day: string; answers: number; up: number; down: number; usd: number }
    >();
    for (const a of usage.answers) byDay.set(a.day, { ...a, usd: 0 });
    for (const m of usage.models) {
      const d = byDay.get(m.day) ?? { day: m.day, answers: 0, up: 0, down: 0, usd: 0 };
      d.usd += m.usd;
      byDay.set(m.day, d);
    }
    return [...byDay.values()].sort((a, b) => b.day.localeCompare(a.day));
  });

  ngOnInit(): void {
    void this.load();
  }

  async load(): Promise<void> {
    const [health, usage] = await Promise.all([
      this.api.assistantHealth(),
      this.api.assistantUsage(30),
    ]);
    if (health.ok) this.health.set(health.data);
    else toast.error("Could not load the assistant's health", { description: health.error });
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
