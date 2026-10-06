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
import { toast } from "@spartan-ng/brain/sonner";
import { HlmBadge } from "@spartan-ng/helm/badge";
import { HlmButton } from "@spartan-ng/helm/button";

import { AdminApiService } from "../admin-api.service";
import type { RunItem, RunRow } from "../assistant-types";
import { ConfirmService } from "../components/confirm-dialog.component";
import {
  canResume,
  compareRuns,
  isActive,
  passCounts,
  progressShare,
  type ComparisonRow,
} from "../eval-runs";
import { judgeMark, type JudgeStatus } from "../pairwise";

const STATUS_LABELS: Record<RunRow["status"], string> = {
  queued: "waiting to start",
  running: "running",
  done: "finished",
  failed: "stopped",
  cancelled: "cancelled",
  interrupted: "interrupted by a restart",
};

const POLL_MS = 2_000;

/**
 * The eval suite as a background run: ~40 questions against a frozen sample
 * portfolio, graded by checks and an LLM judge, the same suite as
 * `pnpm -C server ai:eval`. The run goes on without this page; each case is
 * saved as it is graded, so the page shows progress whenever it is opened, a
 * restart leaves a run that can be resumed, and two runs can be compared case
 * by case.
 */
@Component({
  selector: "app-assistant-evals",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DecimalPipe, HlmBadge, HlmButton],
  host: { class: "block" },
  template: `
    <div class="flex flex-col gap-6">
      <div class="flex flex-wrap items-center gap-3">
        <button hlmBtn size="sm" [disabled]="busy() || !!activeRun()" (click)="start()">
          Run the evals
        </button>
        @if (activeRun(); as running) {
          @if (running.kind === "eval") {
            <button
              hlmBtn
              size="sm"
              variant="outline"
              [disabled]="busy()"
              (click)="cancel(running)"
            >
              Cancel the run
            </button>
          } @else {
            <span class="text-xs text-muted-foreground">
              A {{ running.kind }} run is going; one paid run at a time.
            </span>
          }
        }
        <span class="text-xs text-muted-foreground">
          Runs in the background with free-tier pacing (10–15 minutes); you can leave this page.
        </span>
      </div>

      @if (view(); as v) {
        <section class="flex flex-col gap-3" aria-labelledby="eval-run">
          <h2 id="eval-run" class="m-0 text-sm font-medium">
            Run of {{ when(v.run.createdAt) }}: {{ statusLabel(v.run) }}
          </h2>
          <div
            class="h-1.5 overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-label="Cases finished"
            aria-valuemin="0"
            [attr.aria-valuemax]="v.run.progress.total"
            [attr.aria-valuenow]="v.run.progress.done"
          >
            <div
              class="h-full rounded-full bg-accent-orange"
              [style.width.%]="share(v.run) * 100"
            ></div>
          </div>
          <p class="m-0 flex flex-wrap items-baseline gap-3 text-sm">
            <strong class="font-mono text-lg">{{ counts().passed }}/{{ counts().graded }}</strong>
            <span>passed</span>
            <span class="text-muted-foreground">
              {{ v.run.progress.done }} of {{ v.run.progress.total }} cases done · \${{
                v.run.usd | number: "1.3-4"
              }}
            </span>
            @if (v.run.summary; as s) {
              <span class="text-muted-foreground">
                {{ s.promptVersion }} · judged by {{ s.judge ?? "no judge" }}
              </span>
              @if (mark(s.judge); as m) {
                <span hlmBadge [variant]="m === 'uncalibrated' ? 'destructive' : 'outline'">
                  {{ m }}
                </span>
              }
            }
          </p>
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
                Resume the run
              </button>
            </div>
          }
          @if (v.run.summary; as s) {
            <p class="m-0 flex flex-wrap gap-2">
              @for (c of categories(); track c[0]) {
                <span
                  hlmBadge
                  [variant]="
                    c[1].completed > 0 && c[1].passed < c[1].completed ? 'destructive' : 'outline'
                  "
                  class="font-mono"
                  >{{ c[0] }} {{ c[1].passed }}/{{ c[1].completed }}</span
                >
              }
            </p>
          }
          <ul class="m-0 flex list-none flex-col gap-2 p-0" role="list">
            @for (r of results(); track r.id) {
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
                        judge {{ r.judge.faithfulness | number: "1.2-2" }} /
                        {{ r.judge.helpfulness }}
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
                    <p class="m-0 mt-1 font-mono text-xs text-muted-foreground">
                      tools: {{ tools(r.tools) }}
                    </p>
                  }
                  @if (r.reasoning) {
                    <!-- Plan phase 23: how a failed case reasoned; evidence, not proof. -->
                    <div class="mt-2 rounded-md border border-border px-2 py-1 text-xs">
                      <p class="m-0 text-muted-foreground">Its reasoning (an excerpt):</p>
                      <p class="m-0 mt-1 whitespace-pre-wrap text-muted-foreground">
                        {{ r.reasoning }}
                      </p>
                    </div>
                  }
                </details>
              </li>
            }
          </ul>
        </section>
      }

      @if (comparison(); as c) {
        <section class="flex flex-col gap-2" aria-labelledby="eval-compare">
          <h2 id="eval-compare" class="m-0 text-sm font-medium">{{ c.label }}</h2>
          <div class="overflow-x-auto rounded-lg border border-border">
            <table class="w-full text-sm">
              <thead class="text-left text-xs text-muted-foreground">
                <tr>
                  <th class="p-2 font-normal">Case</th>
                  <th class="p-2 font-normal">This run</th>
                  <th class="p-2 font-normal">The other</th>
                </tr>
              </thead>
              <tbody>
                @for (row of c.rows; track row.id) {
                  <tr
                    class="border-t border-border font-mono text-xs"
                    [class.text-destructive]="row.changed"
                  >
                    <td class="p-2">{{ row.id }}</td>
                    <td class="p-2">{{ row.a }}</td>
                    <td class="p-2">{{ row.b }}</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </section>
      }

      <section class="flex flex-col gap-2" aria-labelledby="eval-history">
        <h2 id="eval-history" class="m-0 text-sm font-medium">Past runs</h2>
        <div class="overflow-x-auto rounded-lg border border-border">
          <table class="w-full text-sm">
            <thead class="text-left text-xs text-muted-foreground">
              <tr>
                <th class="p-2 font-normal">Started</th>
                <th class="p-2 font-normal">Status</th>
                <th class="p-2 text-right font-normal">Passed</th>
                <th class="p-2 text-right font-normal">Cost</th>
                <th class="p-2 font-normal"><span class="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              @for (r of evalRuns(); track r.id) {
                <tr class="border-t border-border text-xs">
                  <td class="p-2 font-mono">{{ when(r.createdAt) }}</td>
                  <td class="p-2">{{ statusLabel(r) }}</td>
                  <td class="p-2 text-right font-mono">
                    @if (r.summary; as s) {
                      {{ s.passed }}/{{ s.completed }}
                    } @else {
                      {{ r.progress.done }}/{{ r.progress.total }} done
                    }
                  </td>
                  <td class="p-2 text-right font-mono">\${{ r.usd | number: "1.3-4" }}</td>
                  <td class="flex flex-wrap justify-end gap-2 p-2">
                    <button hlmBtn size="sm" variant="ghost" (click)="open(r.id)">Open</button>
                    @if (view(); as v) {
                      @if (v.run.id !== r.id) {
                        <button hlmBtn size="sm" variant="ghost" (click)="compare(r)">
                          Compare
                        </button>
                      }
                    }
                  </td>
                </tr>
              } @empty {
                <tr>
                  <td class="p-2 text-muted-foreground" colspan="5">No runs yet.</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      </section>
    </div>
  `,
})
export class AssistantEvalsComponent implements OnInit {
  private readonly api = inject(AdminApiService);
  private readonly confirm = inject(ConfirmService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  /** Every run, whatever its kind; the history lists the eval runs. */
  protected readonly runs = signal<RunRow[]>([]);
  protected readonly view = signal<{ run: RunRow; items: RunItem[] } | null>(null);
  protected readonly busy = signal(false);
  protected readonly comparison = signal<{ label: string; rows: ComparisonRow[] } | null>(null);
  private readonly judge = signal<JudgeStatus | null>(null);
  private timer?: ReturnType<typeof setTimeout>;

  protected readonly evalRuns = computed(() => this.runs().filter((r) => r.kind === "eval"));

  /**
   * The run going on now, if any: this page may not be the one that started
   * it, and it may be another kind (one paid run at a time).
   */
  protected readonly activeRun = computed(() => {
    const v = this.view();
    if (v && isActive(v.run)) return v.run;
    return this.runs().find(isActive) ?? null;
  });

  protected readonly counts = computed(() => passCounts(this.view()?.items ?? []));
  protected readonly results = computed(() =>
    (this.view()?.items ?? []).flatMap((item) => (item.result ? [item.result] : [])),
  );
  protected readonly categories = computed(() =>
    Object.entries(this.view()?.run.summary?.byCategory ?? {}),
  );

  protected readonly share = progressShare;
  protected readonly resumable = canResume;

  ngOnInit(): void {
    this.destroyRef.onDestroy(() => clearTimeout(this.timer));
    void this.load();
  }

  /** The history, and the eval run going on (or the latest) opened. */
  private async load(): Promise<void> {
    const [list, judge] = await Promise.all([this.api.listRuns(), this.api.judgeStatus()]);
    if (judge.ok) this.judge.set(judge.data);
    if (!list.ok) {
      toast.error("Could not load the eval runs", { description: list.error });
      return;
    }
    this.runs.set(list.data.runs);
    const evals = this.evalRuns();
    const first = evals.find(isActive) ?? evals[0];
    if (first && !this.view()) await this.open(first.id);
  }

  /** Whether reviewers' labels back the judge that scored this run. */
  protected mark(judge: string | null): string | null {
    return judgeMark(judge, this.judge());
  }

  protected async open(id: string): Promise<void> {
    clearTimeout(this.timer);
    const result = await this.api.getRun(id);
    if (!result.ok) {
      toast.error("Could not load the run", { description: result.error });
      return;
    }
    if (this.view()?.run.id !== id) this.comparison.set(null);
    this.view.set(result.data);
    const run = result.data.run;
    this.runs.update((runs) => runs.map((r) => (r.id === run.id ? run : r)));
    // While it runs, follow it; the server keeps going if this page closes.
    if (isActive(run) && this.isBrowser) {
      this.timer = setTimeout(() => void this.open(id), POLL_MS);
    }
  }

  protected async start(): Promise<void> {
    const go = await this.confirm.ask({
      title: "Run the eval suite?",
      description:
        "About 40 questions go to the configured models, plus a judge for answerable cases. It runs in the background, paced for free-tier limits, and takes 10–15 minutes; its cost counts toward today's budget.",
      confirmLabel: "Run evals",
    });
    if (!go) return;
    this.busy.set(true);
    const result = await this.api.startEvalRun();
    this.busy.set(false);
    if (!result.ok) {
      toast.error("The evals did not start", { description: result.error });
      await this.load();
      return;
    }
    await this.refreshList();
    await this.open(result.data.id);
  }

  protected async cancel(run: RunRow): Promise<void> {
    this.busy.set(true);
    const result = await this.api.cancelRun(run.id);
    this.busy.set(false);
    if (!result.ok) toast.error("Could not cancel the run", { description: result.error });
    await this.open(run.id);
  }

  protected async resume(run: RunRow): Promise<void> {
    const left = run.progress.total - run.progress.done;
    const go = await this.confirm.ask({
      title: "Resume the run?",
      description: `The ${left} ${left === 1 ? "case" : "cases"} still to do go to the configured models, paced as before; their cost counts toward today's budget.`,
      confirmLabel: "Resume",
    });
    if (!go) return;
    this.busy.set(true);
    const result = await this.api.resumeRun(run.id);
    this.busy.set(false);
    if (!result.ok) {
      toast.error("Could not resume the run", { description: result.error });
      return;
    }
    await this.open(run.id);
  }

  protected async compare(other: RunRow): Promise<void> {
    const base = this.view();
    if (!base) return;
    const result = await this.api.getRun(other.id);
    if (!result.ok) {
      toast.error("Could not load that run", { description: result.error });
      return;
    }
    this.comparison.set({
      label: `This run against the run of ${this.when(other.createdAt)}`,
      rows: compareRuns(base.items, result.data.items),
    });
  }

  private async refreshList(): Promise<void> {
    const list = await this.api.listRuns();
    if (list.ok) this.runs.set(list.data.runs);
  }

  protected statusLabel(run: RunRow): string {
    return STATUS_LABELS[run.status];
  }

  protected when(iso: string): string {
    return new Date(iso).toLocaleString();
  }

  protected tools(tools: { name: string; input: unknown }[]): string {
    return tools.map((t) => `${t.name} ${JSON.stringify(t.input)}`).join(" · ");
  }
}
