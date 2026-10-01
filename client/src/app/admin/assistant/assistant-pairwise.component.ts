import { DecimalPipe, isPlatformBrowser } from "@angular/common";
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject,
  OnInit,
  PLATFORM_ID,
  signal,
} from "@angular/core";
import { FormsModule } from "@angular/forms";
import { toast } from "@spartan-ng/brain/sonner";
import { HlmButton } from "@spartan-ng/helm/button";

import { AdminApiService } from "../admin-api.service";
import type { RunItem, RunRow } from "../assistant-types";
import { ConfirmService } from "../components/confirm-dialog.component";
import { canResume, isActive, progressShare } from "../eval-runs";
import {
  OUTCOME_LABELS,
  pairwiseResults,
  pairwiseSummary,
  percent,
  tallyRows,
  verdictLine,
  type PairwiseCaseResult,
} from "../pairwise";

const POLL_MS = 2_000;

/**
 * Pairwise runs: two answerers (a route, lite or deep, or a model id) over
 * the eval suite, each case judged twice with the answers' positions swapped;
 * a verdict counts only when both orders agree. For trying a new model
 * release, or the deep route against the lite one. Runs in the background
 * like the evals, one paid run at a time.
 */
@Component({
  selector: "app-assistant-pairwise",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DecimalPipe, FormsModule, HlmButton],
  host: { class: "block" },
  template: `
    <section class="flex flex-col gap-3" aria-labelledby="pairwise-title">
      <h2 id="pairwise-title" class="m-0 text-sm font-medium">Compare two answerers</h2>
      <p class="m-0 text-xs text-muted-foreground">
        A route (lite, deep) or a model id on each side. The judge ({{ judge() ?? "…" }}) reads both
        answers twice, their order swapped; a verdict counts only when both orders agree.
      </p>
      <form
        class="flex flex-wrap items-end gap-2"
        action="/admin/assistant"
        (submit)="$event.preventDefault(); start()"
      >
        <label class="flex flex-col gap-1 text-xs text-muted-foreground">
          A
          <input
            name="pairwise-a"
            list="pairwise-answerers"
            class="h-8 rounded-md border border-border bg-background px-2 font-mono text-sm text-foreground"
            [ngModel]="a()"
            (ngModelChange)="a.set($event)"
          />
        </label>
        <label class="flex flex-col gap-1 text-xs text-muted-foreground">
          B
          <input
            name="pairwise-b"
            list="pairwise-answerers"
            class="h-8 rounded-md border border-border bg-background px-2 font-mono text-sm text-foreground"
            [ngModel]="b()"
            (ngModelChange)="b.set($event)"
          />
        </label>
        <datalist id="pairwise-answerers">
          @for (option of answerers(); track option) {
            <option [value]="option"></option>
          }
        </datalist>
        <button hlmBtn size="sm" type="submit" [disabled]="!canStart()">Compare</button>
        @if (active(); as running) {
          @if (running.kind === "pairwise") {
            <button
              hlmBtn
              size="sm"
              type="button"
              variant="outline"
              [disabled]="busy()"
              (click)="cancel(running)"
            >
              Cancel the comparison
            </button>
          } @else {
            <span class="text-xs text-muted-foreground">Another run is going; one at a time.</span>
          }
        }
      </form>

      @if (view(); as v) {
        @let s = summaryOf(v.run);
        <div class="flex flex-col gap-3 rounded-lg border border-border p-3">
          <h3 class="m-0 text-sm font-medium">
            {{ label(v.run) }}: {{ v.run.status }} · {{ v.run.progress.done }} of
            {{ v.run.progress.total }} cases · \${{ v.run.usd | number: "1.3-4" }}
          </h3>
          <div
            class="h-1.5 overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-label="Cases compared"
            aria-valuemin="0"
            [attr.aria-valuemax]="v.run.progress.total"
            [attr.aria-valuenow]="v.run.progress.done"
          >
            <div
              class="h-full rounded-full bg-accent-orange"
              [style.width.%]="share(v.run) * 100"
            ></div>
          </div>
          @if (v.run.error) {
            <p class="m-0 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
              {{ v.run.error }}
            </p>
          }
          @if (resumable(v.run)) {
            <div>
              <button
                hlmBtn
                size="sm"
                variant="outline"
                [disabled]="busy()"
                (click)="resume(v.run)"
              >
                Resume the comparison
              </button>
            </div>
          }
          @if (s) {
            <p class="m-0 text-sm">
              {{ verdictLine(s) }} Swap agreement
              <strong class="font-mono">{{ percent(s.swapAgreement) }}</strong> · the graders passed
              A {{ s.passed.a }}, B {{ s.passed.b }} of {{ s.judged }}.
            </p>
            <div class="overflow-x-auto rounded-lg border border-border">
              <table class="w-full text-sm">
                <thead class="text-left text-xs text-muted-foreground">
                  <tr>
                    <th class="p-2 font-normal">Category</th>
                    <th class="p-2 text-right font-normal">A better</th>
                    <th class="p-2 text-right font-normal">B better</th>
                    <th class="p-2 text-right font-normal">Tie</th>
                    <th class="p-2 text-right font-normal">Orders disagree</th>
                  </tr>
                </thead>
                <tbody>
                  @for (row of tallyRows(s); track row.category) {
                    <tr class="border-t border-border font-mono text-xs">
                      <td class="p-2">{{ row.category }}</td>
                      <td class="p-2 text-right">{{ row.a }}</td>
                      <td class="p-2 text-right">{{ row.b }}</td>
                      <td class="p-2 text-right">{{ row.tie }}</td>
                      <td class="p-2 text-right">{{ row.inconsistent }}</td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          }
          <ul class="m-0 flex list-none flex-col gap-2 p-0" role="list" aria-label="Cases">
            @for (r of results(); track r.id) {
              <li class="rounded-lg border border-border p-2 text-sm">
                <details>
                  <summary class="flex cursor-pointer flex-wrap items-center gap-2">
                    <span class="font-mono text-xs">{{ r.id }}</span>
                    <span class="text-xs">{{ outcomeOf(r) }}</span>
                    <span class="font-mono text-[11px] text-muted-foreground">
                      A {{ r.a.failures.length ? "✗" : "✓" }} · B
                      {{ r.b.failures.length ? "✗" : "✓" }}
                    </span>
                  </summary>
                  <div class="mt-2 grid gap-2 md:grid-cols-2">
                    <p class="m-0 whitespace-pre-wrap text-xs">
                      <strong>A</strong> ({{ r.a.model ?? "no model" }}):
                      {{ r.a.answer || "(no text)" }}
                    </p>
                    <p class="m-0 whitespace-pre-wrap text-xs">
                      <strong>B</strong> ({{ r.b.model ?? "no model" }}):
                      {{ r.b.answer || "(no text)" }}
                    </p>
                  </div>
                  @if (r.reasons.length) {
                    <p class="m-0 mt-2 text-xs text-muted-foreground">
                      Judge: {{ r.reasons.join(" · ") }}
                    </p>
                  }
                </details>
              </li>
            }
          </ul>
        </div>
      }

      @if (history().length) {
        <ul class="m-0 flex list-none flex-col gap-1 p-0 text-xs" aria-label="Past comparisons">
          @for (r of history(); track r.id) {
            <li class="flex flex-wrap items-center gap-2">
              <span class="font-mono">{{ when(r.createdAt) }}</span>
              <span>{{ label(r) }} · {{ r.status }}</span>
              <button hlmBtn size="sm" variant="ghost" (click)="open(r.id)">Open</button>
            </li>
          }
        </ul>
      }
    </section>
  `,
})
export class AssistantPairwiseComponent implements OnInit {
  private readonly api = inject(AdminApiService);
  private readonly confirm = inject(ConfirmService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  protected readonly a = signal("lite");
  protected readonly b = signal("deep");
  protected readonly answerers = signal<string[]>(["lite", "deep"]);
  protected readonly judge = signal<string | null>(null);
  protected readonly runs = signal<RunRow[]>([]);
  protected readonly view = signal<{ run: RunRow; items: RunItem[] } | null>(null);
  protected readonly busy = signal(false);
  private timer?: ReturnType<typeof setTimeout>;

  /** Any run going on: one paid run at a time, whatever its kind. */
  protected readonly active = computed(() => {
    const v = this.view();
    if (v && isActive(v.run)) return v.run;
    return this.runs().find(isActive) ?? null;
  });
  protected readonly history = computed(() => this.runs().filter((r) => r.kind === "pairwise"));
  protected readonly results = computed(() => pairwiseResults(this.view()?.items ?? []));
  protected readonly canStart = computed(() => {
    const [a, b] = [this.a().trim(), this.b().trim()];
    return !this.busy() && !this.active() && !!a && !!b && a !== b;
  });

  protected readonly share = progressShare;
  protected readonly resumable = canResume;
  protected readonly summaryOf = pairwiseSummary;
  protected readonly tallyRows = tallyRows;
  protected readonly verdictLine = verdictLine;
  protected readonly percent = percent;

  ngOnInit(): void {
    this.destroyRef.onDestroy(() => clearTimeout(this.timer));
    void this.load();
  }

  private async load(): Promise<void> {
    const [status, list] = await Promise.all([this.api.judgeStatus(), this.api.listRuns()]);
    if (status.ok) {
      this.judge.set(status.data.fixtureJudge);
      this.answerers.set(status.data.answerers);
    }
    if (!list.ok) {
      toast.error("Could not load the runs", { description: list.error });
      return;
    }
    this.runs.set(list.data.runs);
    const going = list.data.runs.find((r) => r.kind === "pairwise" && isActive(r));
    if (going) await this.open(going.id);
  }

  protected async open(id: string): Promise<void> {
    clearTimeout(this.timer);
    const result = await this.api.getRun(id);
    if (!result.ok) {
      toast.error("Could not load the comparison", { description: result.error });
      return;
    }
    this.view.set(result.data);
    const run = result.data.run;
    this.runs.update((runs) => runs.map((r) => (r.id === run.id ? run : r)));
    if (isActive(run) && this.isBrowser) {
      this.timer = setTimeout(() => void this.open(id), POLL_MS);
    }
  }

  protected async start(): Promise<void> {
    if (!this.canStart()) return;
    const [a, b] = [this.a().trim(), this.b().trim()];
    const go = await this.confirm.ask({
      title: `Compare ${a} with ${b}?`,
      description:
        "Every eval case is answered by both, then judged twice: four model calls a case, paced for free-tier limits (up to half an hour for the whole suite). Its cost counts toward today's budget.",
      confirmLabel: "Compare",
    });
    if (!go) return;
    this.busy.set(true);
    const result = await this.api.startPairwiseRun(a, b);
    this.busy.set(false);
    if (!result.ok) {
      toast.error("The comparison did not start", { description: result.error });
      return;
    }
    await this.refreshList();
    await this.open(result.data.id);
  }

  protected async cancel(run: RunRow): Promise<void> {
    this.busy.set(true);
    const result = await this.api.cancelRun(run.id);
    this.busy.set(false);
    if (!result.ok) toast.error("Could not cancel the comparison", { description: result.error });
    await this.open(run.id);
  }

  protected async resume(run: RunRow): Promise<void> {
    const left = run.progress.total - run.progress.done;
    const go = await this.confirm.ask({
      title: "Resume the comparison?",
      description: `The ${left} ${left === 1 ? "case" : "cases"} still to do are answered by both sides and judged twice; their cost counts toward today's budget.`,
      confirmLabel: "Resume",
    });
    if (!go) return;
    this.busy.set(true);
    const result = await this.api.resumeRun(run.id);
    this.busy.set(false);
    if (!result.ok) {
      toast.error("Could not resume the comparison", { description: result.error });
      return;
    }
    await this.open(run.id);
  }

  private async refreshList(): Promise<void> {
    const list = await this.api.listRuns();
    if (list.ok) this.runs.set(list.data.runs);
  }

  protected label(run: RunRow): string {
    const params = run.params as { a?: string; b?: string };
    return `${params.a ?? "A"} vs ${params.b ?? "B"}`;
  }

  protected outcomeOf(r: PairwiseCaseResult): string {
    return r.outcome ? OUTCOME_LABELS[r.outcome] : "not judged";
  }

  protected when(iso: string): string {
    return new Date(iso).toLocaleString();
  }
}
