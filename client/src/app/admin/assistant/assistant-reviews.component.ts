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
import { HlmBadge } from "@spartan-ng/helm/badge";
import { HlmButton } from "@spartan-ng/helm/button";

import { AdminApiService } from "../admin-api.service";
import { checkLabel, reasonLabel } from "../answer-trace";
import {
  REVIEW_LABELS,
  type ReviewEntry,
  type ReviewLabel,
  type ReviewLabels,
  type ReviewQueue,
} from "../assistant-types";
import { ConfirmService } from "../components/confirm-dialog.component";
import { FormSkeletonComponent } from "../components/load-state.component";
import { isShortcutTarget } from "../components/shortcut-sheet.component";
import { isActive } from "../eval-runs";
import { stepFrom } from "../inbox";
import { calibrationLine, type JudgeStatus } from "../pairwise";
import { FreezeCaseComponent } from "./freeze-case.component";
import { cycleLabel, emptyLabels, goodShare, LABEL_NAMES, nextUnreviewed } from "../review-queue";

const POLL_MS = 2_000;

const VERDICTS: { value: boolean | null; label: string }[] = [
  { value: true, label: "Good" },
  { value: false, label: "Not good" },
  { value: null, label: "Does not apply" },
];

/**
 * The weekly human review: a random 5 % of the week's visitor answers (at
 * least 10, at most 30) plus everything a check, a thumbs-down or an "it
 * isn't there" flagged. Each answer gets five verdicts and a note; the shares
 * of good verdicts count the random sample only, and the verdicts are what
 * the judge is calibrated against. J and K move through the queue, 1–5 cycle
 * a verdict, S saves and opens the next.
 */
@Component({
  selector: "app-assistant-reviews",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DecimalPipe,
    FormsModule,
    FormSkeletonComponent,
    FreezeCaseComponent,
    HlmBadge,
    HlmButton,
  ],
  host: { class: "block", "(document:keydown)": "onKeydown($event)" },
  template: `
    <div class="flex flex-col gap-4">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div class="flex items-center gap-2">
          <button
            hlmBtn
            size="sm"
            variant="outline"
            [disabled]="!data()"
            (click)="go(data()!.previous)"
          >
            Previous week
          </button>
          <span class="font-mono text-sm">{{ data()?.week ?? "…" }}</span>
          <button
            hlmBtn
            size="sm"
            variant="outline"
            [disabled]="!data()?.next"
            (click)="go(data()!.next!)"
          >
            Next week
          </button>
        </div>
        @if (data(); as d) {
          <p class="m-0 text-xs text-muted-foreground">
            {{ d.stats.reviewed }} of {{ d.stats.queued }} reviewed · {{ d.stats.answers }}
            {{ d.stats.answers === 1 ? "answer" : "answers" }} this week
          </p>
        }
      </div>

      @if (data(); as d) {
        <p class="m-0 flex flex-wrap items-center gap-2">
          <span class="text-xs text-muted-foreground">Good in the random sample:</span>
          @for (label of labels; track label) {
            @let share = goodShare(d.stats.labels[label]);
            <span hlmBadge variant="outline" class="font-mono">
              {{ names[label] }}:
              {{ share === null ? "–" : (share * 100 | number: "1.0-0") + " %" }}
            </span>
          }
        </p>
      }

      @if (loading()) {
        <app-form-skeleton kind="list" [rows]="3" label="Loading the review queue…" />
      } @else if (!queue().length) {
        <p class="m-0 text-sm text-muted-foreground">Nothing to review this week.</p>
      } @else {
        <div class="grid items-start gap-4 lg:grid-cols-[16rem_minmax(0,1fr)]">
          <ul
            class="m-0 flex list-none flex-col divide-y divide-border overflow-hidden rounded-lg border border-border p-0"
            role="list"
            aria-label="Answers to review"
          >
            @for (entry of queue(); track entry.message.id) {
              @let current = entry.message.id === selectedId();
              <li>
                <button
                  type="button"
                  class="flex w-full min-w-0 flex-col gap-1 px-3 py-2 text-left text-sm outline-none hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
                  [class.bg-surface-2]="current"
                  [attr.aria-current]="current ? 'true' : null"
                  (click)="select(entry)"
                >
                  <span class="line-clamp-2">
                    @if (entry.review) {
                      <span aria-label="reviewed">✓ </span>
                    }
                    {{ entry.message.question }}
                  </span>
                  <span class="flex flex-wrap gap-1 font-mono text-[11px] text-muted-foreground">
                    @for (reason of entry.reasons; track reason) {
                      <span>{{ reasonLabel(reason) }}</span>
                    } @empty {
                      <span>sample</span>
                    }
                  </span>
                </button>
              </li>
            }
          </ul>

          @if (selected(); as entry) {
            <section
              class="flex min-w-0 flex-col gap-3 rounded-lg border border-border p-4 text-sm"
              aria-labelledby="review-question"
            >
              <h2 id="review-question" class="m-0 text-base font-medium">
                {{ entry.message.question }}
              </h2>
              <p class="m-0 whitespace-pre-wrap text-foreground/85">
                {{ entry.message.answer || "(no answer)" }}
              </p>
              <p class="m-0 flex flex-wrap gap-2 font-mono text-xs text-muted-foreground">
                <span>{{ entry.message.model ?? "no model" }}</span>
                <span>{{ entry.message.locale.toUpperCase() }}</span>
                @for (flag of entry.message.checks?.flags ?? []; track flag) {
                  <span hlmBadge variant="outline">{{ checkLabel(flag) }}</span>
                }
                @if (entry.message.feedback === -1) {
                  <span hlmBadge variant="destructive">−1</span>
                }
              </p>
              @if (entry.message.citedIds.length) {
                <p class="m-0 font-mono text-xs text-muted-foreground">
                  cited: {{ entry.message.citedIds.join(", ") }}
                </p>
              }

              <fieldset class="m-0 flex flex-col gap-2 border-0 p-0">
                <legend class="mb-1 text-xs text-muted-foreground">
                  Verdicts (1–5 cycle them)
                </legend>
                @for (label of labels; track label; let i = $index) {
                  <div class="flex flex-wrap items-center justify-between gap-2">
                    <span>{{ i + 1 }}. {{ names[label] }}</span>
                    <span class="flex gap-1" role="group" [attr.aria-label]="names[label]">
                      @for (verdict of verdicts; track verdict.label) {
                        <button
                          hlmBtn
                          type="button"
                          size="sm"
                          [variant]="draft()[label] === verdict.value ? 'default' : 'outline'"
                          [attr.aria-pressed]="draft()[label] === verdict.value"
                          (click)="setLabel(label, verdict.value)"
                        >
                          {{ verdict.label }}
                        </button>
                      }
                    </span>
                  </div>
                }
              </fieldset>
              <label class="flex flex-col gap-1 text-xs text-muted-foreground">
                Note (optional)
                <textarea
                  name="review-note"
                  rows="2"
                  class="rounded-md border border-border bg-background p-2 text-sm text-foreground"
                  [ngModel]="note()"
                  (ngModelChange)="note.set($event)"
                ></textarea>
              </label>
              <div class="flex items-center gap-3">
                <button hlmBtn size="sm" [disabled]="saving()" (click)="save()">
                  Save and next
                </button>
                @if (entry.review) {
                  <span class="text-xs text-muted-foreground">
                    Reviewed {{ when(entry.review.reviewedAt) }}
                  </span>
                }
              </div>
              <app-freeze-case [message]="entry.message" />
            </section>
          }
        </div>
      }

      @if (judge(); as j) {
        <section
          class="flex flex-col gap-2 rounded-lg border border-border p-3 text-sm"
          aria-labelledby="calibration-title"
        >
          <h2 id="calibration-title" class="m-0 text-sm font-medium">
            The judge against reviewers
          </h2>
          @if (j.visitorJudge) {
            <p class="m-0">{{ calibrationLine(j.calibration) }}</p>
            <p class="m-0 text-xs text-muted-foreground">
              {{ j.visitorJudge }} judges the answers given a "grounded" verdict, against the
              documents they cited; faithful from 0.8.
            </p>
            @if (j.unjudged) {
              <div>
                <button
                  hlmBtn
                  size="sm"
                  variant="outline"
                  [disabled]="judging()"
                  (click)="judgeReviewed(j.unjudged)"
                >
                  Judge {{ j.unjudged }} reviewed {{ j.unjudged === 1 ? "answer" : "answers" }}
                </button>
              </div>
            }
          } @else {
            <p class="m-0 text-xs text-muted-foreground">
              No judge may read visitor answers: SERVER_AI_JUDGE_MODELS must name a model that
              already answers visitors.
            </p>
          }
        </section>
      }
    </div>
  `,
})
export class AssistantReviewsComponent implements OnInit {
  private readonly api = inject(AdminApiService);
  private readonly confirm = inject(ConfirmService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  protected readonly labels = REVIEW_LABELS;
  protected readonly names = LABEL_NAMES;
  protected readonly verdicts = VERDICTS;
  protected readonly goodShare = goodShare;
  protected readonly checkLabel = checkLabel;
  protected readonly calibrationLine = calibrationLine;

  protected readonly judge = signal<JudgeStatus | null>(null);
  protected readonly judging = signal(false);
  private timer?: ReturnType<typeof setTimeout>;

  protected readonly data = signal<ReviewQueue | null>(null);
  protected readonly loading = signal(true);
  protected readonly saving = signal(false);
  protected readonly selectedId = signal<string | null>(null);
  protected readonly draft = signal<ReviewLabels>(emptyLabels());
  protected readonly note = signal("");

  protected readonly queue = computed(() => this.data()?.queue ?? []);
  protected readonly selected = computed(
    () => this.queue().find((e) => e.message.id === this.selectedId()) ?? null,
  );

  ngOnInit(): void {
    this.destroyRef.onDestroy(() => clearTimeout(this.timer));
    void this.load();
    void this.loadJudge();
  }

  protected go(week: string): void {
    void this.load(week);
  }

  private async loadJudge(): Promise<void> {
    const result = await this.api.judgeStatus();
    if (result.ok) this.judge.set(result.data);
  }

  /** A paid background run: the judge scores the reviewed answers it has not yet. */
  protected async judgeReviewed(count: number): Promise<void> {
    const go = await this.confirm.ask({
      title: `Judge ${count} reviewed ${count === 1 ? "answer" : "answers"}?`,
      description:
        "One model call each, to the judge that already answers visitors. Its cost counts toward today's budget.",
      confirmLabel: "Judge",
    });
    if (!go) return;
    this.judging.set(true);
    const started = await this.api.startJudgeRun();
    if (!started.ok) {
      this.judging.set(false);
      toast.error("The judge did not start", { description: started.error });
      return;
    }
    this.follow(started.data.id);
  }

  /** Until the judge run ends; then the calibration is read again. */
  private follow(id: string): void {
    if (!this.isBrowser) return;
    this.timer = setTimeout(async () => {
      const result = await this.api.getRun(id);
      if (result.ok && isActive(result.data.run)) return this.follow(id);
      this.judging.set(false);
      if (result.ok && result.data.run.error) {
        toast.error("The judge stopped", { description: result.data.run.error });
      }
      await this.loadJudge();
    }, POLL_MS);
  }

  private async load(week?: string, keep: string | null = null): Promise<void> {
    this.loading.set(!this.data());
    const result = await this.api.assistantReviews(week);
    this.loading.set(false);
    if (!result.ok) {
      toast.error("Could not load the review queue", { description: result.error });
      return;
    }
    this.data.set(result.data);
    const next = keep ?? nextUnreviewed(result.data.queue, null)?.message.id ?? null;
    const entry = result.data.queue.find((e) => e.message.id === next) ?? result.data.queue[0];
    if (entry) this.select(entry);
    else this.selectedId.set(null);
  }

  protected select(entry: ReviewEntry): void {
    this.selectedId.set(entry.message.id);
    this.draft.set({ ...emptyLabels(), ...entry.review?.labels });
    this.note.set(entry.review?.note ?? "");
  }

  protected setLabel(label: ReviewLabel, value: boolean | null): void {
    this.draft.update((labels) => ({ ...labels, [label]: value }));
  }

  protected async save(): Promise<void> {
    const entry = this.selected();
    const week = this.data()?.week;
    if (!entry || !week || this.saving()) return;
    this.saving.set(true);
    const result = await this.api.saveReview(entry.message.id, {
      labels: this.draft(),
      note: this.note().trim() || null,
    });
    this.saving.set(false);
    if (!result.ok) {
      toast.error("Could not save the review", { description: result.error });
      return;
    }
    // The saved one counts as reviewed now; the next still to do opens.
    const after = nextUnreviewed(
      this.queue().map((e) =>
        e.message.id === entry.message.id
          ? {
              ...e,
              review: { labels: this.draft(), note: null, reviewedAt: result.data.reviewedAt },
            }
          : e,
      ),
      entry.message.id,
    );
    await this.load(week, after?.message.id ?? entry.message.id);
  }

  protected onKeydown(event: KeyboardEvent): void {
    if (!isShortcutTarget(event) || !this.selected()) return;
    const key = event.key.toLowerCase();
    if (key === "j" || key === "k") {
      const list = this.queue().map((e) => ({ id: e.message.id }));
      const next = stepFrom(list, this.selectedId(), key === "j" ? 1 : -1);
      const entry = this.queue().find((e) => e.message.id === next?.id);
      if (entry) {
        event.preventDefault();
        this.select(entry);
      }
    } else if (/^[1-5]$/.test(key)) {
      event.preventDefault();
      const label = REVIEW_LABELS[Number(key) - 1]!;
      this.setLabel(label, cycleLabel(this.draft()[label]));
    } else if (key === "s") {
      event.preventDefault();
      void this.save();
    }
  }

  protected readonly reasonLabel = reasonLabel;

  protected when(iso: string): string {
    return new Date(iso).toLocaleString();
  }
}
