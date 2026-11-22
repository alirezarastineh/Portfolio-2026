import { DecimalPipe, isPlatformBrowser } from "@angular/common";
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  OnInit,
  PLATFORM_ID,
  signal,
} from "@angular/core";
import { FormsModule } from "@angular/forms";
import { NgIcon, provideIcons } from "@ng-icons/core";
import { lucideChevronRight } from "@ng-icons/lucide";
import { toast } from "@spartan-ng/brain/sonner";
import { HlmButton } from "@spartan-ng/helm/button";
import { HlmTableImports } from "@spartan-ng/helm/table";

import { AdminApiService } from "../admin-api.service";
import { apiWords } from "../api-words";
import type { RunItem, RunRow } from "../assistant-types";
import { ConfirmService } from "../components/confirm-dialog.component";
import { LoadErrorComponent } from "../components/load-state.component";
import { canResume, EVAL_SUITE_CASES, isActive, progressShare, statusWord } from "../eval-runs";
import { AdminPulseService } from "../pulse.service";
import { featureStop } from "../spending";
import { UnsavedChangesService } from "../unsaved-changes.service";
import { FeatureStopComponent } from "./feature-stop.component";
import {
  OUTCOME_LABELS,
  pairwiseResults,
  pairwiseSummary,
  percent,
  tallyRows,
  verdictLine,
  type PairwiseCaseResult,
} from "../pairwise";

const POLL_MS = 2000;

/**
 * Pairwise runs: two answerers (a route, lite or deep, or a model id) over
 * the eval suite, each case judged twice with the answers' positions swapped;
 * a verdict counts only when both orders agree. For trying a new model
 * release, or the deep route against the lite one. Runs in the background
 * like the evals, one paid run at a time. A report in words (plan 5, U22).
 */
@Component({
  selector: "app-assistant-pairwise",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DecimalPipe,
    FeatureStopComponent,
    FormsModule,
    HlmButton,
    HlmTableImports,
    LoadErrorComponent,
    NgIcon,
  ],
  viewProviders: [provideIcons({ lucideChevronRight })],
  host: { class: "block" },
  template: `
    <section class="flex flex-col gap-3" aria-labelledby="pairwise-title">
      <h2 id="pairwise-title" class="m-0 text-section-title">Compare two answerers</h2>
      <p class="m-0 max-w-prose text-hint text-muted-foreground">
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
            class="h-9 pointer-coarse:h-11 rounded-lg border border-input-line bg-card px-2 font-data text-sm pointer-coarse:text-base text-foreground"
            [ngModel]="a()"
            (ngModelChange)="a.set($event)"
          />
        </label>
        <label class="flex flex-col gap-1 text-xs text-muted-foreground">
          B
          <input
            name="pairwise-b"
            list="pairwise-answerers"
            class="h-9 pointer-coarse:h-11 rounded-lg border border-input-line bg-card px-2 font-data text-sm pointer-coarse:text-base text-foreground"
            [ngModel]="b()"
            (ngModelChange)="b.set($event)"
          />
        </label>
        <datalist id="pairwise-answerers">
          @for (option of answerers(); track option) {
            <option [value]="option"></option>
          }
        </datalist>
        <!-- Paid: off while a pairwise run would be refused; Enter in a field sends nothing then. -->
        <button
          hlmBtn
          size="sm"
          type="submit"
          class="aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
          [attr.aria-disabled]="stop() ? 'true' : null"
          [attr.aria-describedby]="stop() ? 'stop-pairwise' : null"
          [disabled]="!canStart()"
        >
          Compare (paid)
        </button>
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
            <span class="text-hint text-muted-foreground"
              >Another paid run is going; one at a time.</span
            >
          }
        }
      </form>
      @if (stop(); as reason) {
        <app-feature-stop noteId="stop-pairwise" [reason]="reason" />
      }

      @if (view(); as v) {
        @let s = summaryOf(v.run);
        <section class="flex flex-col gap-3" aria-labelledby="pairwise-run">
          <h3 id="pairwise-run" class="m-0 text-sm font-medium">
            {{ label(v.run) }}: {{ status(v.run) }}
          </h3>
          <div
            class="h-1.5 overflow-hidden bg-surface-2"
            role="progressbar"
            aria-label="Cases compared"
            aria-valuemin="0"
            [attr.aria-valuemax]="v.run.progress.total"
            [attr.aria-valuenow]="v.run.progress.done"
          >
            <div class="h-full bg-foreground" [style.width.%]="share(v.run) * 100"></div>
          </div>
          <p class="m-0 text-sm">
            {{ v.run.progress.done }} of {{ v.run.progress.total }} cases compared,
            <span class="font-data">\${{ v.run.usd | number: "1.3-4" }}</span
            >.
          </p>
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
                [attr.aria-describedby]="stop() ? 'stop-pairwise' : null"
                [disabled]="busy()"
                (click)="resume(v.run)"
              >
                Resume the comparison (paid)
              </button>
            </div>
          }
          @if (s) {
            <p class="m-0 max-w-prose text-sm">
              {{ verdictLine(s) }} Swap agreement
              <strong class="font-data">{{ percent(s.swapAgreement) }}</strong>; the graders passed
              A {{ s.passed.a }} and B {{ s.passed.b }} of {{ s.judged }}.
            </p>
            <div hlmTableContainer>
              <table hlmTable>
                <caption class="sr-only">
                  The verdicts by category
                </caption>
                <thead hlmTHead>
                  <tr hlmTr>
                    <th hlmTh scope="col">Category</th>
                    <th hlmTh scope="col" class="text-right">A better</th>
                    <th hlmTh scope="col" class="text-right">B better</th>
                    <th hlmTh scope="col" class="text-right">Tie</th>
                    <th hlmTh scope="col" class="text-right">Orders disagree</th>
                  </tr>
                </thead>
                <tbody hlmTBody>
                  @for (row of tallyRows(s); track row.category) {
                    <tr hlmTr>
                      <th hlmTh scope="row" class="font-normal">{{ row.category }}</th>
                      <td hlmTd class="text-right font-data text-xs">{{ row.a }}</td>
                      <td hlmTd class="text-right font-data text-xs">{{ row.b }}</td>
                      <td hlmTd class="text-right font-data text-xs">{{ row.tie }}</td>
                      <td hlmTd class="text-right font-data text-xs">{{ row.inconsistent }}</td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          }
          <div hlmTableContainer>
            <table hlmTable>
              <caption class="sr-only">
                The comparison's cases
              </caption>
              <thead hlmTHead>
                <tr hlmTr>
                  <th hlmTh scope="col">Case</th>
                  <th hlmTh scope="col">Verdict</th>
                  <th hlmTh scope="col">A</th>
                  <th hlmTh scope="col">B</th>
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
                        [attr.aria-controls]="'pairwise-case-' + r.id"
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
                    <td hlmTd>{{ outcomeOf(r) }}</td>
                    <td hlmTd>
                      <span [class.text-destructive]="r.a.failures.length > 0">{{
                        r.a.failures.length ? "failed" : "passed"
                      }}</span>
                    </td>
                    <td hlmTd>
                      <span [class.text-destructive]="r.b.failures.length > 0">{{
                        r.b.failures.length ? "failed" : "passed"
                      }}</span>
                    </td>
                  </tr>
                  <tr hlmTr [id]="'pairwise-case-' + r.id" [hidden]="!isOpen(r.id)">
                    <td hlmTd colspan="4" class="whitespace-normal">
                      <div class="grid gap-3 py-1 text-sm md:grid-cols-2">
                        <div class="flex flex-col gap-1">
                          <p class="m-0 text-xs text-muted-foreground">
                            A,
                            <span class="font-data" translate="no">{{
                              r.a.model ?? "no model"
                            }}</span>
                          </p>
                          <p
                            class="m-0 whitespace-pre-wrap"
                            [textContent]="r.a.answer || '(no text)'"
                          ></p>
                        </div>
                        <div class="flex flex-col gap-1">
                          <p class="m-0 text-xs text-muted-foreground">
                            B,
                            <span class="font-data" translate="no">{{
                              r.b.model ?? "no model"
                            }}</span>
                          </p>
                          <p
                            class="m-0 whitespace-pre-wrap"
                            [textContent]="r.b.answer || '(no text)'"
                          ></p>
                        </div>
                      </div>
                      @if (r.reasons.length) {
                        <p class="m-0 mt-2 max-w-prose text-hint text-muted-foreground">
                          The judge: {{ r.reasons.join("; ") }}
                        </p>
                      }
                    </td>
                  </tr>
                </tbody>
              } @empty {
                <tbody hlmTBody>
                  <tr hlmTr>
                    <td hlmTd colspan="4" class="text-muted-foreground">No case compared yet.</td>
                  </tr>
                </tbody>
              }
            </table>
          </div>
        </section>
      }

      <section class="flex flex-col gap-2" aria-labelledby="pairwise-history">
        <h3 #historyHeading id="pairwise-history" tabindex="-1" class="m-0 text-sm font-medium">
          Past comparisons
        </h3>
        <div hlmTableContainer>
          <table hlmTable>
            <caption class="sr-only">
              The comparisons, newest first
            </caption>
            <thead hlmTHead>
              <tr hlmTr>
                <th hlmTh scope="col">Started</th>
                <th hlmTh scope="col">Answerers</th>
                <th hlmTh scope="col">Status</th>
                <th hlmTh scope="col"><span class="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody hlmTBody>
              @if (loadError(); as code) {
                <tr hlmTr>
                  <td hlmTd colspan="4" class="whitespace-normal">
                    <app-load-error
                      compact
                      title="Could not load the comparisons"
                      [reason]="code"
                      [refocus]="historyHeading"
                      (retry)="reload()"
                    />
                  </td>
                </tr>
              } @else if (!loaded()) {
                <tr hlmTr>
                  <td hlmTd colspan="4" class="text-muted-foreground">Loading the comparisons…</td>
                </tr>
              } @else {
                @for (r of history(); track r.id) {
                  <tr hlmTr>
                    <td hlmTd class="font-data text-xs">{{ when(r.createdAt) }}</td>
                    <td hlmTd translate="no">{{ label(r) }}</td>
                    <td hlmTd>{{ status(r) }}</td>
                    <td hlmTd class="text-right">
                      <button hlmBtn type="button" size="sm" variant="ghost" (click)="open(r.id)">
                        Open<span class="sr-only"> the comparison of {{ when(r.createdAt) }}</span>
                      </button>
                    </td>
                  </tr>
                } @empty {
                  <tr hlmTr>
                    <td hlmTd colspan="4" class="text-muted-foreground">No comparison yet.</td>
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
export class AssistantPairwiseComponent implements OnInit {
  private readonly api = inject(AdminApiService);
  private readonly confirm = inject(ConfirmService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  private readonly pulse = inject(AdminPulseService);
  /** Why a pairwise run would be refused now, or null: Compare and Resume say so, send nothing. */
  protected readonly stop = computed(() => featureStop(this.pulse.assistant()?.spend, "pairwise"));

  protected readonly a = signal("lite");
  protected readonly b = signal("deep");
  protected readonly answerers = signal<string[]>(["lite", "deep"]);
  /** The pair as it opened, or as the last comparison started with it. */
  private readonly used = signal<readonly [string, string]>(["lite", "deep"]);
  protected readonly judge = signal<string | null>(null);
  protected readonly runs = signal<RunRow[]>([]);
  /** The runs arrived at least once: until then the history says it is loading. */
  protected readonly loaded = signal(false);
  /** Why the runs did not arrive (the API's code): said in the history, with Try again. */
  protected readonly loadError = signal<string | null>(null);
  protected readonly view = signal<{ run: RunRow; items: RunItem[] } | null>(null);
  protected readonly busy = signal(false);
  /** The cases opened to both answers. */
  private readonly opened = signal<ReadonlySet<string>>(new Set());
  private timer?: ReturnType<typeof setTimeout>;

  /** Any run going on: one paid run at a time, whatever its kind. */
  protected readonly active = computed(() => {
    const v = this.view();
    if (v && isActive(v.run)) {
      return v.run;
    }
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
  protected readonly status = statusWord;

  constructor() {
    const unsaved = inject(UnsavedChangesService);
    // A pair typed and not compared yet: switching views asks first.
    effect(() => {
      const [a, b] = this.used();
      unsaved.set("pairwise", this.a() !== a || this.b() !== b);
    });
    this.destroyRef.onDestroy(() => unsaved.clear("pairwise"));
  }

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
    // With comparisons on screen, a toast; before, the history says so, with Try again.
    if (!list.ok) {
      if (this.loaded()) {
        toast.error("Could not load the comparisons", { description: apiWords(list.error) });
      } else {
        this.loadError.set(list.error);
      }
      return;
    }
    this.loadError.set(null);
    this.loaded.set(true);
    this.runs.set(list.data.runs);
    const going = list.data.runs.find((r) => r.kind === "pairwise" && isActive(r));
    if (going) {
      await this.open(going.id);
    }
  }

  protected reload(): void {
    void this.load();
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
      toast.error("Could not load the comparison", { description: apiWords(result.error) });
      return;
    }
    if (this.view()?.run.id !== id) {
      this.opened.set(new Set());
    }
    this.view.set(result.data);
    const run = result.data.run;
    this.runs.update((runs) => runs.map((r) => (r.id === run.id ? run : r)));
    if (isActive(run) && this.isBrowser) {
      this.timer = setTimeout(() => void this.open(id), POLL_MS);
    }
  }

  protected async start(): Promise<void> {
    if (!this.canStart() || this.stop()) {
      return;
    }
    const [a, b] = [this.a().trim(), this.b().trim()];
    const cases = EVAL_SUITE_CASES;
    const go = await this.confirm.ask({
      title: `Compare ${a} with ${b} on all ${cases} cases?`,
      description: `Each of the ${cases} eval cases is answered by both, then judged twice with the answers swapped: ${cases * 4} model calls, paced for free-tier limits. Its cost counts toward today's budget.`,
      confirmLabel: "Compare",
    });
    if (!go) {
      return;
    }
    this.busy.set(true);
    const result = await this.api.startPairwiseRun(a, b);
    this.busy.set(false);
    if (!result.ok) {
      toast.error("The comparison did not start", { description: apiWords(result.error) });
      return;
    }
    this.used.set([this.a(), this.b()]);
    await this.refreshList();
    await this.open(result.data.id);
  }

  protected async cancel(run: RunRow): Promise<void> {
    this.busy.set(true);
    const result = await this.api.cancelRun(run.id);
    this.busy.set(false);
    if (!result.ok) {
      toast.error("Could not cancel the comparison", { description: apiWords(result.error) });
    }
    await this.open(run.id);
  }

  protected async resume(run: RunRow): Promise<void> {
    if (this.stop()) {
      return;
    }
    const left = run.progress.total - run.progress.done;
    const go = await this.confirm.ask({
      title: "Resume the comparison?",
      description: `The ${left} ${left === 1 ? "case" : "cases"} still to do are answered by both sides and judged twice; their cost counts toward today's budget.`,
      confirmLabel: "Resume",
    });
    if (!go) {
      return;
    }
    this.busy.set(true);
    const result = await this.api.resumeRun(run.id);
    this.busy.set(false);
    if (!result.ok) {
      toast.error("Could not resume the comparison", { description: apiWords(result.error) });
      return;
    }
    await this.open(run.id);
  }

  private async refreshList(): Promise<void> {
    const list = await this.api.listRuns();
    if (list.ok) {
      this.runs.set(list.data.runs);
    }
  }

  /** "lite against deep": the two answerers the run compares. */
  protected label(run: RunRow): string {
    const side = (key: "a" | "b", fallback: string): string => {
      const value = run.params[key];
      return typeof value === "string" ? value : fallback;
    };
    return `${side("a", "A")} against ${side("b", "B")}`;
  }

  protected outcomeOf(r: PairwiseCaseResult): string {
    return r.outcome ? OUTCOME_LABELS[r.outcome] : "not judged";
  }

  protected when(iso: string): string {
    return new Date(iso).toLocaleString();
  }
}
