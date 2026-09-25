import { DecimalPipe } from "@angular/common";
import { ChangeDetectionStrategy, Component, inject, signal } from "@angular/core";
import { toast } from "@spartan-ng/brain/sonner";
import { HlmBadge } from "@spartan-ng/helm/badge";
import { HlmButton } from "@spartan-ng/helm/button";
import { HlmSpinner } from "@spartan-ng/helm/spinner";

import { AdminApiService } from "../admin-api.service";
import type { EvalSummary } from "../assistant-types";
import { ConfirmService } from "../components/confirm-dialog.component";

/**
 * The eval suite, live: ~40 questions (facts, comparisons, German, unknowns,
 * hallucination bait, injection attempts, tool use) against a frozen sample
 * portfolio, graded by checks and an LLM judge. The same suite as
 * `pnpm -C server ai:eval`, which compares against the stored baseline.
 */
@Component({
  selector: "app-assistant-evals",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DecimalPipe, HlmBadge, HlmButton, HlmSpinner],
  host: { class: "block" },
  template: `
    <div class="flex flex-col gap-4">
      <div class="flex items-center gap-3">
        <button hlmBtn size="sm" [disabled]="running()" (click)="run()">
          @if (running()) {
            <hlm-spinner class="size-4" />
            <span class="ml-2">Running… (free-tier pacing can take 10–15 minutes)</span>
          } @else {
            Run the evals
          }
        </button>
        <span class="text-xs text-muted-foreground">
          Uses the configured model chain with free-tier-safe pacing.
        </span>
      </div>

      @if (summary(); as s) {
        <div class="flex flex-wrap items-center gap-3 text-sm">
          <strong class="font-mono text-lg">{{ s.passed }}/{{ s.completed }}</strong>
          <span>({{ s.passRate * 100 | number: "1.0-1" }} %)</span>
          <span class="text-muted-foreground">{{ s.cases }} planned</span>
          <span class="text-muted-foreground">
            \${{ s.usd | number: "1.3-4" }} estimated · p50 first token {{ s.p50TtftMs ?? "–" }} ms
            · p95 total {{ s.p95TotalMs ?? "–" }} ms ·
            {{ s.promptVersion }}
          </span>
        </div>
        @if (s.incomplete) {
          <p class="m-0 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
            Incomplete run: {{ s.unavailable }} unavailable and {{ s.remaining }} not started. These
            are not counted as answer-quality failures; retry after the provider quota resets.
          </p>
        }
        <p class="m-0 flex flex-wrap gap-2">
          @for (c of categories(); track c[0]) {
            <span
              hlmBadge
              [variant]="
                c[1].completed > 0 && c[1].passed < c[1].completed ? 'destructive' : 'outline'
              "
              class="font-mono text-[0.68rem]"
            >
              {{ c[0] }} {{ c[1].passed }}/{{ c[1].completed }}
              @if (c[1].unavailable || categoryRemaining(c[1])) {
                · {{ c[1].unavailable }} unavailable · {{ categoryRemaining(c[1]) }} pending
              }
            </span>
          }
        </p>
        <ul class="m-0 flex list-none flex-col gap-2 p-0" role="list">
          @for (r of s.results; track r.id) {
            <li
              class="rounded-lg border border-border p-3 text-sm"
              [class.border-destructive]="r.status === 'failed'"
              [class.border-amber-500]="r.status === 'unavailable'"
            >
              <details>
                <summary class="flex cursor-pointer flex-wrap items-center gap-2">
                  <span
                    [class.text-destructive]="r.status === 'failed'"
                    [class.text-amber-600]="r.status === 'unavailable'"
                  >
                    {{ r.status === "unavailable" ? "!" : r.passed ? "✓" : "✗" }}
                  </span>
                  <span class="font-mono text-xs">{{ r.id }}</span>
                  <span class="text-xs text-muted-foreground"
                    >{{ r.model ?? "no model" }} · {{ r.totalMs }} ms</span
                  >
                  @if (r.judge) {
                    <span class="text-xs text-muted-foreground">
                      judge {{ r.judge.faithfulness | number: "1.2-2" }} / {{ r.judge.helpfulness }}
                    </span>
                  }
                </summary>
                @if (r.failures.length) {
                  <ul
                    class="mt-2 text-xs"
                    [class.text-destructive]="r.status === 'failed'"
                    [class.text-amber-700]="r.status === 'unavailable'"
                  >
                    @for (f of r.failures; track $index) {
                      <li>{{ f }}</li>
                    }
                  </ul>
                }
                <p class="m-0 mt-2 whitespace-pre-wrap text-foreground/85">
                  {{ r.answer || "(no text)" }}
                </p>
                @if (r.tools.length) {
                  <p class="m-0 mt-1 font-mono text-[0.68rem] text-muted-foreground">
                    tools: {{ tools(r.tools) }}
                  </p>
                }
              </details>
            </li>
          }
        </ul>
      }
    </div>
  `,
})
export class AssistantEvalsComponent {
  private readonly api = inject(AdminApiService);
  private readonly confirm = inject(ConfirmService);

  protected readonly running = signal(false);
  protected readonly summary = signal<EvalSummary | null>(null);

  protected categories(): [
    string,
    { cases: number; completed: number; passed: number; unavailable: number },
  ][] {
    return Object.entries(this.summary()?.byCategory ?? {});
  }

  protected categoryRemaining(row: {
    cases: number;
    completed: number;
    unavailable: number;
  }): number {
    return row.cases - row.completed - row.unavailable;
  }

  protected tools(tools: { name: string; input: unknown }[]): string {
    return tools.map((t) => `${t.name} ${JSON.stringify(t.input)}`).join(" · ");
  }

  protected async run(): Promise<void> {
    const go = await this.confirm.ask({
      title: "Run the eval suite?",
      description:
        "About 40 questions go to the configured models, plus a judge for answerable cases. Calls are paced for free-tier limits, so a complete run can take 10–15 minutes.",
      confirmLabel: "Run evals",
    });
    if (!go) return;
    this.running.set(true);
    const result = await this.api.runEvals();
    this.running.set(false);
    if (!result.ok) {
      toast.error("Evals did not run", { description: result.error });
      return;
    }
    this.summary.set(result.data);
  }
}
