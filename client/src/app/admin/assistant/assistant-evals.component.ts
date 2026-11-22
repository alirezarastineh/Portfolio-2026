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
import { NgIcon, provideIcons } from "@ng-icons/core";
import { lucideChevronRight } from "@ng-icons/lucide";
import { toast } from "@spartan-ng/brain/sonner";
import { HlmButton } from "@spartan-ng/helm/button";
import { HlmTableImports } from "@spartan-ng/helm/table";

import { AdminApiService } from "../admin-api.service";
import { apiWords } from "../api-words";
import type { EvalCaseResult, RunItem, RunRow } from "../assistant-types";
import { ConfirmService } from "../components/confirm-dialog.component";
import { LoadErrorComponent } from "../components/load-state.component";
import {
  canResume,
  categoryLine,
  compareRuns,
  conversationLine,
  EVAL_SUITE_CASES,
  isActive,
  judgedLine,
  judgeScores,
  passCounts,
  progressShare,
  resultWord,
  seconds,
  statusWord,
  type ComparisonRow,
} from "../eval-runs";
import { judgeMark, type JudgeStatus } from "../pairwise";
import { AdminPulseService } from "../pulse.service";
import { featureStop } from "../spending";
import { FeatureStopComponent } from "./feature-stop.component";

const POLL_MS = 2000;
const RESULT_ORDER: Record<EvalCaseResult["status"], number> = {
  failed: 0,
  unavailable: 1,
  passed: 2,
};

/**
 * The eval suite as a background run: its questions against a frozen sample
 * portfolio, graded by checks and an LLM judge, the same suite as
 * `pnpm -C server ai:eval`. The run goes on without this page; each case is
 * saved as it is graded, so the page shows progress whenever it is opened, a
 * restart leaves a run that can be resumed, and two runs can be compared case
 * by case. A report in words (plan 5, U22): headings and ruled tables, its
 * loading, empty and failed states said in its place.
 */
@Component({
  selector: "app-assistant-evals",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DecimalPipe,
    FeatureStopComponent,
    HlmButton,
    HlmTableImports,
    LoadErrorComponent,
    NgIcon,
  ],
  viewProviders: [provideIcons({ lucideChevronRight })],
  host: { class: "block" },
  template: `
    <section class="flex flex-col gap-4" aria-labelledby="evals-title">
      <div class="flex flex-col gap-1">
        <h2 id="evals-title" class="m-0 text-section-title">Evals</h2>
        <p class="m-0 max-w-prose text-hint text-muted-foreground">
          The suite's {{ suite }} questions against a frozen sample portfolio, graded by checks and
          a judge.
        </p>
      </div>
      <div class="flex flex-wrap items-center gap-3">
        <!-- Paid: off while an eval run would be refused, and saying why (plan 5, U18). -->
        <button
          hlmBtn
          type="button"
          size="sm"
          class="aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
          [attr.aria-disabled]="stop() ? 'true' : null"
          [attr.aria-describedby]="stop() ? 'stop-eval' : null"
          [disabled]="busy() || !!activeRun()"
          (click)="start()"
        >
          Run the evals (paid)
        </button>
        @if (activeRun(); as running) {
          @if (running.kind === "eval") {
            <button
              hlmBtn
              type="button"
              size="sm"
              variant="outline"
              [disabled]="busy()"
              (click)="cancel(running)"
            >
              Cancel the run
            </button>
          } @else {
            <span class="text-hint text-muted-foreground">
              Another paid run is going; one at a time.
            </span>
          }
        }
        <span class="text-hint text-muted-foreground">
          Runs in the background, paced for the free tier; you can leave this page.
        </span>
      </div>
      @if (stop(); as reason) {
        <app-feature-stop class="-mt-2" noteId="stop-eval" [reason]="reason" />
      }

      @if (view(); as v) {
        <section class="flex flex-col gap-3" aria-labelledby="eval-run">
          <h3 id="eval-run" class="m-0 text-sm font-medium">
            Run of {{ when(v.run.createdAt) }}: {{ status(v.run) }}
          </h3>
          <div
            class="h-1.5 overflow-hidden bg-surface-2"
            role="progressbar"
            aria-label="Cases finished"
            aria-valuemin="0"
            [attr.aria-valuemax]="v.run.progress.total"
            [attr.aria-valuenow]="v.run.progress.done"
          >
            <div class="h-full bg-foreground" [style.width.%]="share(v.run) * 100"></div>
          </div>
          <p class="m-0 text-sm">
            <strong class="text-section-title tabular-nums"
              >{{ counts().passed }} of {{ counts().graded }}</strong
            >
            passed. {{ v.run.progress.done }} of {{ v.run.progress.total }} cases done,
            <span class="font-data">\${{ v.run.usd | number: "1.3-4" }}</span
            >.
          </p>
          @if (v.run.summary; as s) {
            <p class="m-0 text-hint text-muted-foreground">{{ judged(s) }}</p>
            @if (categories(); as line) {
              <p class="m-0 text-sm">By category: {{ line }}.</p>
            }
          }
          @if (v.run.error; as error) {
            <p class="m-0 max-w-prose text-sm">
              <span class="font-medium">Why it stopped:</span> {{ error }}
            </p>
          }
          @if (resumable(v.run)) {
            <div>
              <button
                hlmBtn
                type="button"
                size="sm"
                variant="outline"
                class="aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
                [attr.aria-disabled]="stop() ? 'true' : null"
                [attr.aria-describedby]="stop() ? 'stop-eval' : null"
                [disabled]="busy()"
                (click)="resume(v.run)"
              >
                Resume the run (paid)
              </button>
            </div>
          }
          <div hlmTableContainer>
            <table hlmTable>
              <caption class="sr-only">
                The run's cases, the failed ones first
              </caption>
              <thead hlmTHead>
                <tr hlmTr>
                  <th hlmTh scope="col">Case</th>
                  <th hlmTh scope="col">Result</th>
                  <th hlmTh scope="col">Model</th>
                  <th hlmTh scope="col" class="text-right">Time</th>
                  <th hlmTh scope="col" class="text-right">Judged faithful, helpful</th>
                </tr>
              </thead>
              @for (r of results(); track r.id) {
                <tbody hlmTBody>
                  <tr hlmTr>
                    <th hlmTh scope="row" class="font-normal">
                      <button
                        type="button"
                        class="group inline-flex min-h-6 touch-manipulation items-center gap-1.5 pointer-coarse:min-h-11"
                        [attr.aria-expanded]="isOpen(r.id)"
                        [attr.aria-controls]="'eval-case-' + r.id"
                        (click)="toggle(r.id)"
                      >
                        <ng-icon
                          name="lucideChevronRight"
                          size="14"
                          class="shrink-0 text-muted-foreground group-aria-expanded:rotate-90"
                          aria-hidden="true"
                        />
                        <span class="font-data text-xs" translate="no">{{ r.id }}</span>
                      </button>
                    </th>
                    <td hlmTd>
                      <span
                        [class.text-destructive]="r.status === 'failed'"
                        [class.text-muted-foreground]="r.status === 'unavailable'"
                        >{{ result(r) }}</span
                      >
                    </td>
                    <td hlmTd class="font-data text-xs" translate="no">{{ r.model ?? "none" }}</td>
                    <td hlmTd class="text-right font-data text-xs">{{ time(r.totalMs) }}</td>
                    <td hlmTd class="text-right font-data text-xs">{{ scores(r.judge) }}</td>
                  </tr>
                  <tr hlmTr [id]="'eval-case-' + r.id" [hidden]="!isOpen(r.id)">
                    <td hlmTd colspan="5" class="whitespace-normal">
                      <div class="flex max-w-prose flex-col gap-2 py-1 text-sm">
                        @if (r.failures.length) {
                          <ul
                            class="m-0 flex flex-col gap-0.5 pl-5"
                            [class.text-destructive]="r.status === 'failed'"
                            [class.text-muted-foreground]="r.status === 'unavailable'"
                          >
                            @for (f of r.failures; track $index) {
                              <li>{{ f }}</li>
                            }
                          </ul>
                        }
                        @if (r.conversation; as conversation) {
                          <!-- Visitor plan V3: the turns before the case's question, as sent. -->
                          <div class="flex flex-col gap-1 text-xs">
                            <p class="m-0 text-muted-foreground">
                              {{ conversationLine(conversation) }}
                            </p>
                            <ol
                              class="m-0 flex flex-col gap-1 pl-5"
                              aria-label="Earlier in the conversation"
                            >
                              @for (t of conversation.turns; track $index) {
                                <li>
                                  <p class="m-0">{{ t.question }}</p>
                                  <p class="m-0 whitespace-pre-wrap text-muted-foreground">
                                    @if (t.forged) {
                                      <span>[forged]</span>
                                    } @else if (t.live) {
                                      <span>[answered live]</span>
                                    }
                                    {{ t.answer || "(no text)" }}
                                  </p>
                                </li>
                              }
                            </ol>
                          </div>
                        }
                        <p
                          class="m-0 whitespace-pre-wrap"
                          [textContent]="r.answer || '(no text)'"
                        ></p>
                        @if (r.tools.length) {
                          <p class="m-0 text-xs text-muted-foreground">
                            Tools it called: <span class="font-data">{{ tools(r.tools) }}</span>
                          </p>
                        }
                        @if (r.reasoning; as reasoning) {
                          <!-- Plan phase 23: how a failed case reasoned; evidence, not proof. -->
                          <div class="flex flex-col gap-1 text-xs text-muted-foreground">
                            <p class="m-0">Its reasoning (an excerpt):</p>
                            <p class="m-0 whitespace-pre-wrap" [textContent]="reasoning"></p>
                          </div>
                        }
                      </div>
                    </td>
                  </tr>
                </tbody>
              } @empty {
                <tbody hlmTBody>
                  <tr hlmTr>
                    <td hlmTd colspan="5" class="text-muted-foreground">No case graded yet.</td>
                  </tr>
                </tbody>
              }
            </table>
          </div>
        </section>
      }

      @if (comparison(); as c) {
        <section class="flex flex-col gap-2" aria-labelledby="eval-compare">
          <h3 id="eval-compare" class="m-0 text-sm font-medium">{{ c.label }}</h3>
          <div hlmTableContainer>
            <table hlmTable>
              <caption class="sr-only">
                Each case in both runs, the changed ones first
              </caption>
              <thead hlmTHead>
                <tr hlmTr>
                  <th hlmTh scope="col">Case</th>
                  <th hlmTh scope="col">This run</th>
                  <th hlmTh scope="col">The other</th>
                  <th hlmTh scope="col">Changed</th>
                </tr>
              </thead>
              <tbody hlmTBody>
                @for (row of c.rows; track row.id) {
                  <tr hlmTr>
                    <th hlmTh scope="row" class="font-data text-xs font-normal" translate="no">
                      {{ row.id }}
                    </th>
                    <td hlmTd>{{ row.a }}</td>
                    <td hlmTd>{{ row.b }}</td>
                    <td hlmTd>
                      @if (row.changed) {
                        <span class="text-destructive">changed</span>
                      }
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </section>
      }

      <section class="flex flex-col gap-2" aria-labelledby="eval-history">
        <h3 #history id="eval-history" tabindex="-1" class="m-0 text-sm font-medium">Past runs</h3>
        <div hlmTableContainer>
          <table hlmTable>
            <caption class="sr-only">
              The eval runs, newest first
            </caption>
            <thead hlmTHead>
              <tr hlmTr>
                <th hlmTh scope="col">Started</th>
                <th hlmTh scope="col">Status</th>
                <th hlmTh scope="col" class="text-right">Passed</th>
                <th hlmTh scope="col" class="text-right">Cost</th>
                <th hlmTh scope="col"><span class="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody hlmTBody>
              @if (loadError(); as code) {
                <tr hlmTr>
                  <td hlmTd colspan="5" class="whitespace-normal">
                    <app-load-error
                      compact
                      title="Could not load the eval runs"
                      [reason]="code"
                      [refocus]="history"
                      (retry)="reload()"
                    />
                  </td>
                </tr>
              } @else if (!loaded()) {
                <tr hlmTr>
                  <td hlmTd colspan="5" class="text-muted-foreground">Loading the eval runs…</td>
                </tr>
              } @else {
                @for (r of evalRuns(); track r.id) {
                  <tr hlmTr>
                    <td hlmTd class="font-data text-xs">{{ when(r.createdAt) }}</td>
                    <td hlmTd>{{ status(r) }}</td>
                    <td hlmTd class="text-right font-data text-xs">
                      @if (r.summary; as s) {
                        {{ s.passed }} of {{ s.completed }}
                      } @else {
                        {{ r.progress.done }} of {{ r.progress.total }} done
                      }
                    </td>
                    <td hlmTd class="text-right font-data text-xs">
                      \${{ r.usd | number: "1.3-4" }}
                    </td>
                    <td hlmTd class="text-right">
                      <button hlmBtn type="button" size="sm" variant="ghost" (click)="open(r.id)">
                        Open<span class="sr-only"> the run of {{ when(r.createdAt) }}</span>
                      </button>
                      @if (view(); as v) {
                        @if (v.run.id !== r.id) {
                          <button
                            hlmBtn
                            type="button"
                            size="sm"
                            variant="ghost"
                            (click)="compare(r)"
                          >
                            Compare<span class="sr-only">
                              this run with the run of {{ when(r.createdAt) }}</span
                            >
                          </button>
                        }
                      }
                    </td>
                  </tr>
                } @empty {
                  <tr hlmTr>
                    <td hlmTd colspan="5" class="text-muted-foreground">No eval run yet.</td>
                  </tr>
                }
              }
            </tbody>
          </table>
        </div>
      </section>
    </section>
  `,
})
export class AssistantEvalsComponent implements OnInit {
  private readonly api = inject(AdminApiService);
  private readonly confirm = inject(ConfirmService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  private readonly pulse = inject(AdminPulseService);
  /** Why an eval run would be refused now, or null: Run and Resume say so and send nothing. */
  protected readonly stop = computed(() => featureStop(this.pulse.assistant()?.spend, "eval"));

  protected readonly suite = EVAL_SUITE_CASES;
  /** Every run, whatever its kind; the history lists the eval runs. */
  protected readonly runs = signal<RunRow[]>([]);
  /** The runs arrived at least once: until then the history says it is loading. */
  protected readonly loaded = signal(false);
  /** Why the runs did not arrive (the API's code): the history says so, never "No eval run yet". */
  protected readonly loadError = signal<string | null>(null);
  protected readonly view = signal<{ run: RunRow; items: RunItem[] } | null>(null);
  protected readonly busy = signal(false);
  protected readonly comparison = signal<{ label: string; rows: ComparisonRow[] } | null>(null);
  /** The cases opened to their evidence. */
  private readonly opened = signal<ReadonlySet<string>>(new Set());
  private readonly judge = signal<JudgeStatus | null>(null);
  private timer?: ReturnType<typeof setTimeout>;

  protected readonly evalRuns = computed(() => this.runs().filter((r) => r.kind === "eval"));

  /**
   * The run going on now, if any: this page may not be the one that started
   * it, and it may be another kind (one paid run at a time).
   */
  protected readonly activeRun = computed(() => {
    const v = this.view();
    if (v && isActive(v.run)) {
      return v.run;
    }
    return this.runs().find(isActive) ?? null;
  });

  protected readonly counts = computed(() => passCounts(this.view()?.items ?? []));
  /** The graded cases, the failed ones first, then the unavailable: a run holds the whole suite. */
  protected readonly results = computed(() =>
    (this.view()?.items ?? [])
      .flatMap((item) => (item.result ? [item.result] : []))
      .toSorted((a, b) => RESULT_ORDER[a.status] - RESULT_ORDER[b.status]),
  );
  protected readonly categories = computed(() =>
    categoryLine(this.view()?.run.summary?.byCategory ?? {}),
  );

  protected readonly share = progressShare;
  protected readonly resumable = canResume;
  protected readonly conversationLine = conversationLine;
  protected readonly status = statusWord;
  protected readonly result = resultWord;
  protected readonly time = seconds;
  protected readonly scores = judgeScores;

  ngOnInit(): void {
    this.destroyRef.onDestroy(() => clearTimeout(this.timer));
    void this.load();
  }

  /** The history, and the eval run going on (or the latest) opened. */
  private async load(): Promise<void> {
    const [list, judge] = await Promise.all([this.api.listRuns(), this.api.judgeStatus()]);
    if (judge.ok) {
      this.judge.set(judge.data);
    }
    // With runs on screen, a toast; before, the history says so, with Try again.
    if (!list.ok) {
      if (this.loaded()) {
        toast.error("Could not load the eval runs", { description: apiWords(list.error) });
      } else {
        this.loadError.set(list.error);
      }
      return;
    }
    this.loadError.set(null);
    this.loaded.set(true);
    this.runs.set(list.data.runs);
    const evals = this.evalRuns();
    const first = evals.find(isActive) ?? evals[0];
    if (first && !this.view()) {
      await this.open(first.id);
    }
  }

  protected reload(): void {
    void this.load();
  }

  /** "Prompt ask-…, judged by gemini-flash-lite (calibrated)." */
  protected judged(summary: { promptVersion: string; judge: string | null }): string {
    return judgedLine(summary, judgeMark(summary.judge, this.judge()));
  }

  protected isOpen(id: string): boolean {
    return this.opened().has(id);
  }

  protected toggle(id: string): void {
    this.opened.update((open) => {
      const next = new Set(open);
      if (!next.delete(id)) {
        next.add(id);
      }
      return next;
    });
  }

  protected async open(id: string): Promise<void> {
    clearTimeout(this.timer);
    const result = await this.api.getRun(id);
    if (!result.ok) {
      toast.error("Could not load the run", { description: apiWords(result.error) });
      return;
    }
    if (this.view()?.run.id !== id) {
      this.comparison.set(null);
      this.opened.set(new Set());
    }
    this.view.set(result.data);
    const run = result.data.run;
    this.runs.update((runs) => runs.map((r) => (r.id === run.id ? run : r)));
    // While it runs, follow it; the server keeps going if this page closes.
    if (isActive(run) && this.isBrowser) {
      this.timer = setTimeout(() => void this.open(id), POLL_MS);
    }
  }

  protected async start(): Promise<void> {
    if (this.stop()) {
      return;
    }
    const go = await this.confirm.ask({
      title: `Run the evals on all ${this.suite} cases?`,
      description: `Each of the ${this.suite} questions goes to the configured models, and a judge grades the answerable ones. It runs in the background, paced for free-tier limits; its cost counts toward today's budget.`,
      confirmLabel: "Run the evals",
    });
    if (!go) {
      return;
    }
    this.busy.set(true);
    const result = await this.api.startEvalRun();
    this.busy.set(false);
    if (!result.ok) {
      toast.error("The evals did not start", { description: apiWords(result.error) });
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
    if (!result.ok) {
      toast.error("Could not cancel the run", { description: apiWords(result.error) });
    }
    await this.open(run.id);
  }

  protected async resume(run: RunRow): Promise<void> {
    if (this.stop()) {
      return;
    }
    const left = run.progress.total - run.progress.done;
    const go = await this.confirm.ask({
      title: "Resume the run?",
      description: `The ${left} ${left === 1 ? "case" : "cases"} still to do go to the configured models, paced as before; their cost counts toward today's budget.`,
      confirmLabel: "Resume",
    });
    if (!go) {
      return;
    }
    this.busy.set(true);
    const result = await this.api.resumeRun(run.id);
    this.busy.set(false);
    if (!result.ok) {
      toast.error("Could not resume the run", { description: apiWords(result.error) });
      return;
    }
    await this.open(run.id);
  }

  protected async compare(other: RunRow): Promise<void> {
    const base = this.view();
    if (!base) {
      return;
    }
    const result = await this.api.getRun(other.id);
    if (!result.ok) {
      toast.error("Could not load that run", { description: apiWords(result.error) });
      return;
    }
    this.comparison.set({
      label: `This run against the run of ${this.when(other.createdAt)}`,
      rows: compareRuns(base.items, result.data.items),
    });
  }

  private async refreshList(): Promise<void> {
    const list = await this.api.listRuns();
    if (list.ok) {
      this.runs.set(list.data.runs);
    }
  }

  protected when(iso: string): string {
    return new Date(iso).toLocaleString();
  }

  /** "get_document {"id":"profile@en"}; search {"q":"rag"}": each call and what it asked. */
  protected tools(tools: { name: string; input: unknown }[]): string {
    return tools.map((t) => `${t.name} ${JSON.stringify(t.input)}`).join("; ");
  }
}
