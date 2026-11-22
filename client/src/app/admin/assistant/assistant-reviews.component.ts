import { CdkListbox, CdkOption } from "@angular/cdk/listbox";
import { isPlatformBrowser } from "@angular/common";
import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  Injector,
  OnInit,
  PLATFORM_ID,
  signal,
  viewChild,
  viewChildren,
} from "@angular/core";
import { FormsModule } from "@angular/forms";
import { toast } from "@spartan-ng/brain/sonner";
import { HlmButton } from "@spartan-ng/helm/button";

import { AdminApiService } from "../admin-api.service";
import { apiWords } from "../api-words";
import { checkLabel, reasonLabel } from "../answer-trace";
import {
  REVIEW_LABELS,
  type ReviewEntry,
  type ReviewLabel,
  type ReviewQueue,
} from "../assistant-types";
import { ConfirmService } from "../components/confirm-dialog.component";
import { FormSkeletonComponent, LoadErrorComponent } from "../components/load-state.component";
import { isSaveNextKey, isShortcutTarget, MOD } from "../components/shortcut-sheet.component";
import { isActive } from "../eval-runs";
import { stepFrom } from "../inbox";
import { calibrationLine, type JudgeStatus } from "../pairwise";
import { AdminPulseService } from "../pulse.service";
import { absoluteTime, relativeTime } from "../relative-time";
import {
  isEmptyReview,
  LABEL_NAMES,
  nextUnreviewed,
  type ReviewDraft,
  sameDraft,
  savedDraft,
  sharesLine,
  toLabels,
  weekOf,
  weekWords,
} from "../review-queue";
import { toastNotSaved } from "../save-feedback";
import { featureStop } from "../spending";
import { UnsavedChangesService } from "../unsaved-changes.service";
import { FeatureStopComponent } from "./feature-stop.component";
import { FreezeCaseComponent } from "./freeze-case.component";

const POLL_MS = 2000;

/** The three verdicts, each with its key. */
const VERDICTS: { value: boolean | null; label: string; key: string }[] = [
  { value: true, label: "Good", key: "1" },
  { value: false, label: "Not good", key: "2" },
  { value: null, label: "Does not apply", key: "3" },
];

/**
 * The weekly human review: a random 5 % of the week's visitor answers (at least 10, at most 30)
 * plus everything a check, a thumbs-down or an "it isn't there" flagged. Each answer gets five
 * verdicts and a note; the shares of good verdicts count the random sample only, and the verdicts
 * are what the judge is calibrated against. Keyboard first (plan 5, U20): J and K move through the
 * queue and keep what was picked, ↑ and ↓ move between the verdicts, 1 2 3 pick one, Ctrl/⌘ Enter
 * saves and opens the next.
 */
@Component({
  selector: "app-assistant-reviews",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CdkListbox,
    CdkOption,
    FeatureStopComponent,
    FormsModule,
    FormSkeletonComponent,
    FreezeCaseComponent,
    LoadErrorComponent,
    HlmButton,
  ],
  host: { class: "block", "(document:keydown)": "onKeydown($event)" },
  template: `
    <div class="flex flex-col gap-4">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div class="flex flex-wrap items-center gap-2">
          <button
            hlmBtn
            type="button"
            size="sm"
            variant="outline"
            [disabled]="!data()"
            (click)="previousWeek()"
          >
            Previous week
          </button>
          <span class="text-data">{{ week() }}</span>
          <button
            hlmBtn
            type="button"
            size="sm"
            variant="outline"
            [disabled]="!data()?.next"
            (click)="nextWeek()"
          >
            Next week
          </button>
        </div>
        @if (progress(); as line) {
          <p class="m-0 text-hint text-muted-foreground">{{ line }}</p>
        }
      </div>

      @if (data(); as d) {
        <p class="m-0 text-hint text-muted-foreground">
          Good in the random sample: {{ shares(d) }}.
        </p>
      }

      @if (loading()) {
        <app-form-skeleton kind="list" [rows]="3" label="Loading the review queue…" />
      } @else if (loadError(); as reason) {
        <app-load-error
          title="Could not load the review queue"
          description="Nothing was lost: the answers and your verdicts are kept on the server."
          [reason]="reason"
          (retry)="reload()"
        />
      } @else if (queue().length === 0) {
        <p class="m-0 text-sm text-muted-foreground">Nothing to review this week.</p>
      } @else {
        <div class="grid items-start gap-4 lg:grid-cols-[16rem_minmax(0,1fr)]">
          <div class="flex min-w-0 flex-col gap-2">
            <!-- On a phone the open answer has the screen; its list waits behind this button. -->
            <button
              hlmBtn
              type="button"
              size="sm"
              variant="outline"
              class="self-start lg:hidden"
              aria-controls="review-queue"
              [attr.aria-expanded]="listOpen()"
              (click)="listOpen.set(!listOpen())"
            >
              Answers this week ({{ queue().length }})
            </button>
            <div [class]="listOpen() ? '' : 'max-lg:hidden'">
              <!-- J, K and the digits are the page's keys, so the options type nothing ahead. -->
              <ul
                cdkListbox
                id="review-queue"
                class="m-0 flex list-none flex-col divide-y divide-border overflow-hidden rounded-lg border border-border p-0"
                aria-label="Answers to review"
                [cdkListboxValue]="listValue()"
                (cdkListboxValueChange)="pick($event.value)"
              >
                @for (entry of queue(); track entry.message.id) {
                  <li
                    class="flex min-w-0 cursor-pointer flex-col gap-1 px-3 py-2 text-left text-sm hover:bg-muted/60 focus-visible:-outline-offset-2 aria-selected:bg-surface-2"
                    cdkOptionTypeaheadLabel=""
                    [cdkOption]="entry.message.id"
                  >
                    <span class="line-clamp-2">
                      @if (entry.review) {
                        <span aria-hidden="true">✓&nbsp;</span
                        ><span class="sr-only">Reviewed: </span>
                      }
                      {{ entry.message.question }}
                    </span>
                    <span class="text-hint text-muted-foreground">{{ queueNote(entry) }}</span>
                  </li>
                }
              </ul>
            </div>
          </div>

          @if (selected(); as entry) {
            <section
              #reviewPanel
              class="flex min-w-0 flex-col gap-3 text-sm"
              aria-labelledby="review-question"
            >
              <h2
                #questionTitle
                id="review-question"
                tabindex="-1"
                class="m-0 text-base font-medium outline-none"
              >
                {{ entry.message.question }}
              </h2>
              <p
                class="m-0 whitespace-pre-wrap text-foreground/85"
                [textContent]="entry.message.answer || '(no answer)'"
              ></p>
              <p class="m-0 text-xs text-muted-foreground">{{ facts(entry) }}</p>
              @if (entry.message.citedIds.length) {
                <p class="m-0 text-xs text-muted-foreground">
                  Cited:
                  <span class="font-data" translate="no">{{
                    entry.message.citedIds.join(", ")
                  }}</span>
                </p>
              }

              <fieldset
                class="m-0 flex flex-col gap-1 border-0 p-0"
                aria-describedby="verdict-keys verdict-open"
              >
                <legend class="mb-1 font-medium">Verdicts</legend>
                <p id="verdict-keys" class="m-0 mb-1 text-hint text-muted-foreground">
                  ↑ ↓ pick a row, 1 2 3 answer it, {{ mod }} ↵ saves and opens the next.
                </p>
                @for (label of labels; track label) {
                  <div
                    #verdictRow
                    role="group"
                    tabindex="-1"
                    class="flex flex-wrap items-center justify-between gap-2 rounded-md p-1 focus-visible:-outline-offset-2"
                    [attr.aria-labelledby]="'verdict-' + label"
                  >
                    <span [id]="'verdict-' + label">{{ names[label] }}</span>
                    <span class="flex flex-wrap gap-1">
                      @for (verdict of verdicts; track verdict.label) {
                        @let pressed = draft().labels[label] === verdict.value;
                        <button
                          hlmBtn
                          type="button"
                          size="sm"
                          class="pointer-coarse:min-h-11"
                          [variant]="pressed ? 'default' : 'outline'"
                          [attr.aria-pressed]="pressed"
                          (click)="setVerdict(label, verdict.value)"
                        >
                          {{ verdict.label }}
                        </button>
                      }
                    </span>
                  </div>
                }
                <p id="verdict-open" class="m-0 mt-1 text-hint text-muted-foreground">
                  A verdict left open is saved as Does not apply.
                </p>
              </fieldset>
              <label class="flex flex-col gap-1 text-xs text-muted-foreground">
                Note (optional)
                <textarea
                  #noteField
                  name="review-note"
                  rows="2"
                  class="rounded-lg border border-input-line bg-card p-2 text-sm text-foreground pointer-coarse:text-base"
                  [ngModel]="draft().note"
                  (ngModelChange)="setNote($event)"
                ></textarea>
              </label>
              <div class="flex flex-wrap items-center gap-3">
                <button
                  #saveButton
                  hlmBtn
                  type="button"
                  size="sm"
                  aria-keyshortcuts="Control+Enter Meta+Enter"
                  [disabled]="saving()"
                  (click)="save()"
                >
                  Save and next
                  <kbd
                    class="inline-flex items-center rounded-sm border border-current/30 px-1.5 py-px font-data text-xs pointer-coarse:hidden"
                    aria-hidden="true"
                    >{{ mod }} ↵</kbd
                  >
                </button>
                @if (entry.review; as review) {
                  <span class="text-hint text-muted-foreground">
                    Reviewed
                    <time [attr.datetime]="review.reviewedAt" [title]="exact(review.reviewedAt)">{{
                      ago(review.reviewedAt)
                    }}</time>
                  </span>
                }
              </div>
              <app-freeze-case [message]="entry.message" />
            </section>
          } @else {
            <section class="flex min-w-0 flex-col gap-2 text-sm" aria-labelledby="review-done">
              <h2
                #doneTitle
                id="review-done"
                tabindex="-1"
                class="m-0 text-base font-medium outline-none"
              >
                Every answer of {{ weekNumber() }} is reviewed.
              </h2>
              <p class="m-0 text-muted-foreground">
                Open any answer in the list to change its verdicts.
              </p>
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
            <p class="m-0 text-hint text-muted-foreground">
              {{ j.visitorJudge }} judges the answers given a "grounded" verdict, against the
              documents they cited; faithful from 0.8.
            </p>
            @if (j.unjudged) {
              <div>
                <!-- Paid: off while a judge run would be refused, and saying why (plan 5, U18). -->
                <button
                  hlmBtn
                  type="button"
                  size="sm"
                  variant="outline"
                  class="aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
                  [attr.aria-disabled]="stop() ? 'true' : null"
                  [attr.aria-describedby]="stop() ? 'stop-judge' : null"
                  [disabled]="judging()"
                  (click)="judgeReviewed(j.unjudged)"
                >
                  Judge {{ j.unjudged }} reviewed
                  {{ j.unjudged === 1 ? "answer" : "answers" }} (paid)
                </button>
              </div>
              @if (stop(); as reason) {
                <app-feature-stop noteId="stop-judge" [reason]="reason" />
              }
            }
          } @else {
            <p class="m-0 text-hint text-muted-foreground">
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
  private readonly injector = inject(Injector);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  private readonly pulse = inject(AdminPulseService);
  /** Why a judge run would be refused now, or null: its button says so and sends nothing. */
  protected readonly stop = computed(() => featureStop(this.pulse.assistant()?.spend, "judge"));

  protected readonly labels = REVIEW_LABELS;
  protected readonly names = LABEL_NAMES;
  protected readonly verdicts = VERDICTS;
  protected readonly mod = MOD;
  protected readonly calibrationLine = calibrationLine;
  protected readonly ago = relativeTime;
  protected readonly exact = absoluteTime;

  protected readonly judge = signal<JudgeStatus | null>(null);
  protected readonly judging = signal(false);
  private timer?: ReturnType<typeof setTimeout>;
  private gone = false;

  protected readonly data = signal<ReviewQueue | null>(null);
  protected readonly loading = signal(true);
  /** The API's reason when the queue did not arrive: never shown as an empty week. */
  protected readonly loadError = signal<string | null>(null);
  protected readonly saving = signal(false);
  /** The open answer; null once nothing is left to review (the done state). */
  protected readonly selectedId = signal<string | null>(null);
  /** On a phone, whether the list of the week's answers is shown. */
  protected readonly listOpen = signal(false);
  /** What was picked and typed and not saved yet, per answer: J and K keep it (plan 5, U20). */
  protected readonly drafts = signal<ReadonlyMap<string, ReviewDraft>>(new Map());

  protected readonly queue = computed(() => this.data()?.queue ?? []);
  protected readonly selected = computed(
    () => this.queue().find((e) => e.message.id === this.selectedId()) ?? null,
  );
  protected readonly draft = computed<ReviewDraft>(() => {
    const entry = this.selected();
    if (!entry) {
      return { labels: {}, note: "" };
    }
    return this.drafts().get(entry.message.id) ?? savedDraft(entry);
  });
  protected readonly listValue = computed(() => {
    const id = this.selectedId();
    return id ? [id] : [];
  });
  protected readonly week = computed(() => {
    const week = this.data()?.week;
    return week ? weekWords(week) : "…";
  });
  protected readonly weekNumber = computed(() => weekOf(this.data()?.week ?? ""));
  protected readonly progress = computed(() => {
    const stats = this.data()?.stats;
    if (!stats) {
      return null;
    }
    const answers = stats.answers === 1 ? "answer" : "answers";
    return `${stats.reviewed} of ${stats.queued} reviewed, ${stats.answers} ${answers} this week.`;
  });

  private readonly panelEl = viewChild<ElementRef<HTMLElement>>("reviewPanel");
  private readonly questionEl = viewChild<ElementRef<HTMLElement>>("questionTitle");
  private readonly doneEl = viewChild<ElementRef<HTMLElement>>("doneTitle");
  private readonly rowEls = viewChildren<ElementRef<HTMLElement>>("verdictRow");
  private readonly saveEl = viewChild<ElementRef<HTMLButtonElement>>("saveButton");
  private readonly noteEl = viewChild<ElementRef<HTMLTextAreaElement>>("noteField");

  constructor() {
    const unsaved = inject(UnsavedChangesService);
    // Verdicts or a note picked and not saved, on any answer: leaving Reviews asks first.
    effect(() => unsaved.set("review-drafts", this.drafts().size > 0));
    this.destroyRef.onDestroy(() => {
      this.gone = true;
      unsaved.clear("review-drafts");
    });
  }

  ngOnInit(): void {
    this.destroyRef.onDestroy(() => clearTimeout(this.timer));
    void this.load();
    void this.loadJudge();
  }

  protected previousWeek(): void {
    const previous = this.data()?.previous;
    if (previous) {
      void this.load(previous);
    }
  }

  protected nextWeek(): void {
    const next = this.data()?.next;
    if (next) {
      void this.load(next);
    }
  }

  private async loadJudge(): Promise<void> {
    const result = await this.api.judgeStatus();
    if (result.ok) {
      this.judge.set(result.data);
    }
  }

  /** A paid background run: the judge scores the reviewed answers it has not yet. */
  protected async judgeReviewed(count: number): Promise<void> {
    if (this.stop()) {
      return;
    }
    const go = await this.confirm.ask({
      title: `Judge ${count} reviewed ${count === 1 ? "answer" : "answers"}?`,
      description:
        "One model call each, to the judge that already answers visitors. Its cost counts toward today's budget.",
      confirmLabel: "Judge",
    });
    if (!go) {
      return;
    }
    this.judging.set(true);
    const started = await this.api.startJudgeRun();
    if (!started.ok) {
      this.judging.set(false);
      toast.error("The judge did not start", { description: apiWords(started.error) });
      return;
    }
    this.follow(started.data.id);
  }

  /** Until the judge run ends; then the calibration is read again. */
  private follow(id: string): void {
    if (!this.isBrowser) {
      return;
    }
    this.timer = setTimeout(() => {
      void this.pollJudge(id);
    }, POLL_MS);
  }

  private async pollJudge(id: string): Promise<void> {
    const result = await this.api.getRun(id);
    if (result.ok && isActive(result.data.run)) {
      this.follow(id);
      return;
    }
    this.judging.set(false);
    if (result.ok && result.data.run.error) {
      toast.error("The judge stopped", { description: result.data.run.error });
    }
    await this.loadJudge();
  }

  /**
   * The week's queue. `open` is the answer to show after a save, null for the done state; on
   * arrival and on another week, the first answer still to review opens.
   */
  private async load(week?: string, open?: string | null): Promise<void> {
    this.loading.set(!this.data());
    const result = await this.api.assistantReviews(week);
    this.loading.set(false);
    if (!result.ok) {
      if (this.data()) {
        toast.error("Could not load the review queue", { description: apiWords(result.error) });
      } else {
        this.loadError.set(result.error);
      }
      return;
    }
    this.loadError.set(null);
    this.data.set(result.data);
    const queue = result.data.queue;
    const id = open === undefined ? (nextUnreviewed(queue, null)?.message.id ?? null) : open;
    this.selectedId.set(queue.some((e) => e.message.id === id) ? id : null);
  }

  protected reload(): void {
    void this.load();
  }

  protected shares(queue: ReviewQueue): string {
    return sharesLine(queue.stats.labels);
  }

  /** Why the answer is in the queue, and whether it holds verdicts not saved yet. */
  protected queueNote(entry: ReviewEntry): string {
    const reasons = entry.reasons.map((reason) => reasonLabel(reason));
    const why = reasons.length > 0 ? reasons.join(", ") : "sample";
    return this.drafts().has(entry.message.id) ? `${why}, not saved` : why;
  }

  protected facts(entry: ReviewEntry): string {
    const m = entry.message;
    return [
      m.model ?? "no model",
      m.locale === "de" ? "German" : "English",
      m.feedback === -1 ? "thumbs down" : "",
      ...(m.checks?.flags ?? []).map((flag) => checkLabel(flag)),
    ]
      .filter(Boolean)
      .join(", ");
  }

  /** An option chosen in the list (a click, Enter or Space): the focus stays in the list. */
  protected pick(value: readonly unknown[]): void {
    const id = value.at(0);
    if (typeof id === "string") {
      this.selectedId.set(id);
    }
  }

  protected setVerdict(label: ReviewLabel, value: boolean | null): void {
    this.edit((draft) => ({ ...draft, labels: { ...draft.labels, [label]: value } }));
  }

  protected setNote(note: string): void {
    this.edit((draft) => ({ ...draft, note }));
  }

  /** Keeps the open answer's draft, or lets it go once it is what was saved. */
  private edit(change: (draft: ReviewDraft) => ReviewDraft): void {
    const entry = this.selected();
    if (!entry) {
      return;
    }
    const id = entry.message.id;
    const next = change(this.draft());
    this.drafts.update((drafts) => {
      const kept = new Map(drafts);
      if (sameDraft(next, savedDraft(entry))) {
        kept.delete(id);
      } else {
        kept.set(id, next);
      }
      return kept;
    });
  }

  protected async save(): Promise<void> {
    const entry = this.selected();
    const week = this.data()?.week;
    if (!entry || !week || this.saving()) {
      return;
    }
    const draft = this.draft();
    if (isEmptyReview(draft)) {
      toast.error("Pick a verdict or write a note first.");
      return;
    }
    const id = entry.message.id;
    const labels = toLabels(draft);
    this.saving.set(true);
    const result = await this.api.saveReview(id, { labels, note: draft.note.trim() || null });
    this.saving.set(false);
    if (!result.ok) {
      toastNotSaved(result.error, "Could not save the review");
      return;
    }
    // What was typed while the save was under way stays a draft.
    const now = this.drafts().get(id);
    if (!now || sameDraft(now, draft)) {
      this.drafts.update((drafts) => new Map([...drafts].filter(([key]) => key !== id)));
    }
    // The saved one counts as reviewed now; the next still to do opens, or the done state.
    const reviewed = { labels, note: null, reviewedAt: result.data.reviewedAt };
    const after = nextUnreviewed(
      this.queue().map((e) => (e.message.id === id ? { ...e, review: reviewed } : e)),
      id,
    );
    await this.load(week, after?.message.id ?? null);
    this.focusAfterRender(() => (this.selected() ? this.questionEl() : this.doneEl()));
  }

  protected onKeydown(event: KeyboardEvent): void {
    if (isSaveNextKey(event, this.noteEl()?.nativeElement)) {
      event.preventDefault();
      void this.save();
      return;
    }
    if (!isShortcutTarget(event)) {
      return;
    }
    const key = event.key.toLowerCase();
    if (key === "j" || key === "k") {
      this.step(event, key === "j" ? 1 : -1);
    } else if (key === "arrowdown" || key === "arrowup") {
      this.moveRow(event, key === "arrowdown" ? 1 : -1);
    } else {
      const verdict = VERDICTS.find((v) => v.key === key);
      if (verdict && this.selected()) {
        event.preventDefault();
        this.answerRow(event, verdict.value);
      }
    }
  }

  /** J and K: the next or previous answer, its question taking the focus; drafts stay kept. */
  private step(event: KeyboardEvent, by: 1 | -1): void {
    const list = this.queue().map((e) => ({ id: e.message.id }));
    const next = stepFrom(list, this.selectedId(), by);
    if (!next) {
      return;
    }
    event.preventDefault();
    this.selectedId.set(next.id);
    this.focusAfterRender(() => this.questionEl());
  }

  /** ↑ and ↓ from the answer or the page: the previous or next verdict row. */
  private moveRow(event: KeyboardEvent, by: 1 | -1): void {
    const rows = this.rowEls();
    const panel = this.panelEl()?.nativeElement;
    const target = event.target;
    if (!panel || rows.length === 0 || !(target instanceof Node)) {
      return;
    }
    // Elsewhere (the list, the views, the rail) the arrows stay the page's.
    if (target !== panel.ownerDocument.body && !panel.contains(target)) {
      return;
    }
    const at = rows.findIndex((row) => row.nativeElement.contains(target));
    let next: number;
    if (at < 0) {
      next = by === 1 ? 0 : rows.length - 1;
    } else {
      next = Math.min(rows.length - 1, Math.max(0, at + by));
    }
    event.preventDefault();
    rows.at(next)?.nativeElement.focus();
  }

  /**
   * 1, 2 or 3: the verdict of the row in focus (else the first still open), then the focus goes
   * to the next row, and after the last to Save.
   */
  private answerRow(event: KeyboardEvent, value: boolean | null): void {
    const rows = this.rowEls();
    const target = event.target;
    const focused =
      target instanceof Node ? rows.findIndex((row) => row.nativeElement.contains(target)) : -1;
    const labels = this.draft().labels;
    const open = REVIEW_LABELS.findIndex((label) => labels[label] === undefined);
    const at = focused < 0 ? Math.max(0, open) : focused;
    this.setVerdict(REVIEW_LABELS[at], value);
    (rows.at(at + 1) ?? this.saveEl())?.nativeElement.focus();
  }

  /** Focus once the next render is in, unless the view went meanwhile (NG0911). */
  private focusAfterRender(target: () => ElementRef<HTMLElement> | undefined): void {
    if (this.gone) {
      return;
    }
    afterNextRender(() => target()?.nativeElement.focus(), { injector: this.injector });
  }
}
