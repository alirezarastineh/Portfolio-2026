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
            <span class="ml-2">Running… (a minute or two)</span>
          } @else {
            Run the evals
          }
        </button>
        <span class="text-xs text-muted-foreground"
          >Calls paid models: typically a few cents per run.</span
        >
      </div>

      @if (summary(); as s) {
        <div class="flex flex-wrap items-center gap-3 text-sm">
          <strong class="font-mono text-lg">{{ s.passed }}/{{ s.cases }}</strong>
          <span>({{ s.passRate * 100 | number: "1.0-1" }} %)</span>
          <span class="text-muted-foreground">
            \${{ s.usd | number: "1.3-4" }} · p50 first token {{ s.p50TtftMs ?? "–" }} ms · p95
            total {{ s.p95TotalMs ?? "–" }} ms · {{ s.promptVersion }}
          </span>
        </div>
        <p class="m-0 flex flex-wrap gap-2">
          @for (c of categories(); track c[0]) {
            <span
              hlmBadge
              [variant]="c[1].passed === c[1].cases ? 'outline' : 'destructive'"
              class="font-mono text-[0.68rem]"
            >
              {{ c[0] }} {{ c[1].passed }}/{{ c[1].cases }}
            </span>
          }
        </p>
        <ul class="m-0 flex list-none flex-col gap-2 p-0" role="list">
          @for (r of s.results; track r.id) {
            <li
              class="rounded-lg border border-border p-3 text-sm"
              [class.border-destructive]="!r.passed"
            >
              <details>
                <summary class="flex cursor-pointer flex-wrap items-center gap-2">
                  <span [class.text-destructive]="!r.passed">{{ r.passed ? "✓" : "✗" }}</span>
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
                  <ul class="mt-2 text-xs text-destructive">
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

  protected categories(): [string, { cases: number; passed: number }][] {
    return Object.entries(this.summary()?.byCategory ?? {});
  }

  protected tools(tools: { name: string; input: unknown }[]): string {
    return tools.map((t) => `${t.name} ${JSON.stringify(t.input)}`).join(" · ");
  }

  protected async run(): Promise<void> {
    const go = await this.confirm.ask({
      title: "Run the eval suite?",
      description:
        "About 40 questions go to the configured models, plus a judge model for the answerable ones. It costs a few cents and counts toward today's budget.",
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
