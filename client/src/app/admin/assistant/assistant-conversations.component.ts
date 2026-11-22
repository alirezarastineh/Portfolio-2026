import { DecimalPipe } from "@angular/common";
import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  ElementRef,
  inject,
  Injector,
  OnInit,
  output,
  signal,
  viewChild,
} from "@angular/core";
import { takeUntilDestroyed } from "@angular/core/rxjs-interop";
import { ActivatedRoute, type Params, Router } from "@angular/router";
import { NgIcon, provideIcons } from "@ng-icons/core";
import { lucideChevronRight } from "@ng-icons/lucide";
import { toast } from "@spartan-ng/brain/sonner";
import { HlmButton } from "@spartan-ng/helm/button";
import { HlmTableImports } from "@spartan-ng/helm/table";
import { HlmToggleGroupImports } from "@spartan-ng/helm/toggle-group";

import { AdminApiService } from "../admin-api.service";
import { apiWords } from "../api-words";
import {
  answerFacts,
  cost,
  happenedWords,
  passedOverSentence,
  stepSentence,
  toolOutcomeLabel,
  toolTone,
  type Tone,
} from "../answer-trace";
import type { ConversationFilter, ConversationRow, ToolOutcome } from "../assistant-types";
import { FormSkeletonComponent, LoadErrorComponent } from "../components/load-state.component";
import { isShortcutTarget } from "../components/shortcut-sheet.component";
import { stepFrom } from "../inbox";
import { absoluteTime, relativeTime } from "../relative-time";
import { DiagnoseAnswerComponent } from "./diagnose-answer.component";
import { FreezeCaseComponent } from "./freeze-case.component";

type Source = "terminal" | "playground";
type Sort = "newest" | "oldest";

/** The filters, and what each says when it holds nothing. */
const FILTERS: { id: ConversationFilter; label: string; empty: string }[] = [
  { id: "all", label: "All", empty: "No answers yet." },
  { id: "down", label: "Thumbs down", empty: "No answer has a thumbs down." },
  { id: "unknown", label: "Didn't know", empty: "No answer said it didn't know." },
  { id: "failed", label: "Failed", empty: "No answer failed." },
  { id: "dropped", label: "Invented citations", empty: "No answer invented a citation." },
  { id: "flagged", label: "Flagged", empty: "No answer was flagged." },
  // Matched briefs (visitor plan V20): their kind and rows on each.
  { id: "match", label: "Matches", empty: "No matched briefs." },
];

const SOURCES: { id: Source; label: string }[] = [
  { id: "terminal", label: "Visitors" },
  { id: "playground", label: "Playground" },
];

/** The server's page (`GET /admin/assistant/conversations`, `server/src/ask/admin.ts`). */
const PAGE = 100;

const TONE_CLASS: Record<Tone, string> = {
  ok: "",
  warn: "text-muted-foreground",
  bad: "text-destructive",
};

function filterFrom(value: string | null): ConversationFilter {
  return FILTERS.find((f) => f.id === value)?.id ?? "all";
}

function sourceFrom(value: string | null): Source {
  return value === "playground" ? "playground" : "terminal";
}

function sortFrom(value: string | null): Sort {
  return value === "oldest" ? "oldest" : "newest";
}

/**
 * What visitors asked and what they got, redacted (no emails, phone numbers or IPs) and kept 90
 * days, as a table whose rows open (plan 5, U20): the answer, its facts in sentences and its trace,
 * step by step. The filter, the source and the order live in the address (`?filter=`, `?source=`,
 * `?sort=`); older pages come with `before`. J and K open the next and the previous answer.
 */
@Component({
  selector: "app-assistant-conversations",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DecimalPipe,
    DiagnoseAnswerComponent,
    FormSkeletonComponent,
    FreezeCaseComponent,
    HlmButton,
    HlmTableImports,
    HlmToggleGroupImports,
    LoadErrorComponent,
    NgIcon,
  ],
  viewProviders: [provideIcons({ lucideChevronRight })],
  host: { class: "block", "(document:keydown)": "onKeydown($event)" },
  template: `
    <section class="flex flex-col gap-4" aria-labelledby="answers-title">
      <div class="flex flex-col gap-1">
        <h2
          #answersTitle
          id="answers-title"
          tabindex="-1"
          class="m-0 text-section-title outline-none"
        >
          Answers
        </h2>
        <p class="m-0 text-hint text-muted-foreground">
          What visitors asked and what they got, redacted and kept 90 days. Open a row for its
          trace.
        </p>
      </div>

      <div class="flex flex-col gap-2">
        <div class="flex flex-wrap items-center gap-2">
          <span class="w-12 text-hint text-muted-foreground" aria-hidden="true">From</span>
          <div
            hlmToggleGroup
            type="single"
            variant="outline"
            size="sm"
            aria-label="Answers from"
            [nullable]="false"
            [value]="source()"
            (valueChange)="onSource($event)"
          >
            @for (option of sources; track option.id) {
              <button hlmToggleGroupItem type="button" [value]="option.id">
                {{ option.label }}
              </button>
            }
          </div>
        </div>
        <div class="flex items-start gap-2">
          <span class="w-12 shrink-0 pt-1.5 text-hint text-muted-foreground" aria-hidden="true"
            >Show</span
          >
          <!-- Separate pills, so they wrap on a phone (the joined group was clipped at 390). -->
          <div
            hlmToggleGroup
            type="single"
            variant="outline"
            size="sm"
            spacing="1"
            class="min-w-0 flex-1 flex-wrap"
            aria-label="Show answers"
            [nullable]="false"
            [value]="filter()"
            (valueChange)="onFilter($event)"
          >
            @for (option of filters; track option.id) {
              <button hlmToggleGroupItem type="button" [value]="option.id">
                {{ option.label }}
              </button>
            }
          </div>
        </div>
      </div>

      @if (loading()) {
        <app-form-skeleton kind="list" [rows]="3" label="Loading answers…" />
      } @else if (loadError(); as reason) {
        <app-load-error
          title="Could not load the answers"
          description="Nothing was lost: the answers are kept on the server."
          [reason]="reason"
          [refocus]="answersTitle"
          (retry)="load()"
        />
      } @else {
        @if (rows().length) {
          <p class="m-0 text-hint text-muted-foreground">{{ countLine() }}</p>
        }
        <div hlmTableContainer>
          <table hlmTable>
            <caption class="sr-only">
              Answers,
              {{
                sort()
              }}
              first
            </caption>
            <thead hlmTHead>
              <tr hlmTr>
                <th hlmTh scope="col" class="w-full min-w-48">Question</th>
                <th
                  hlmTh
                  scope="col"
                  class="max-sm:hidden"
                  [attr.aria-sort]="sort() === 'oldest' ? 'ascending' : 'descending'"
                >
                  <button
                    type="button"
                    class="inline-flex min-h-6 touch-manipulation items-center gap-1 pointer-coarse:min-h-11"
                    (click)="flipSort()"
                  >
                    Asked
                    <ng-icon
                      name="lucideChevronRight"
                      size="14"
                      aria-hidden="true"
                      [class]="sort() === 'oldest' ? '-rotate-90' : 'rotate-90'"
                    />
                  </button>
                </th>
                <th hlmTh scope="col" class="whitespace-normal">What happened</th>
                <th hlmTh scope="col" class="max-sm:hidden">Model</th>
                <th hlmTh scope="col" class="text-right max-sm:hidden">Cost</th>
              </tr>
            </thead>
            @for (row of shown(); track row.id) {
              <tbody hlmTBody>
                <tr hlmTr>
                  <th hlmTh scope="row" class="font-normal whitespace-normal">
                    <button
                      type="button"
                      class="group inline-flex min-h-6 touch-manipulation items-start gap-1.5 text-left pointer-coarse:min-h-11"
                      [id]="'answer-' + row.id"
                      [attr.aria-expanded]="isOpen(row.id)"
                      [attr.aria-controls]="'answer-detail-' + row.id"
                      (click)="toggle(row.id)"
                      (focus)="cursor.set(row.id)"
                    >
                      <ng-icon
                        name="lucideChevronRight"
                        size="14"
                        class="mt-0.5 shrink-0 text-muted-foreground group-aria-expanded:rotate-90"
                        aria-hidden="true"
                      />
                      <span class="line-clamp-2" [id]="'question-' + row.id">{{
                        row.question
                      }}</span>
                    </button>
                    <time
                      class="block pl-5 text-hint text-muted-foreground sm:hidden"
                      [attr.datetime]="row.createdAt"
                      >{{ ago(row.createdAt) }}</time
                    >
                  </th>
                  <td hlmTd class="max-sm:hidden">
                    <time [attr.datetime]="row.createdAt" [title]="exact(row.createdAt)">{{
                      ago(row.createdAt)
                    }}</time>
                  </td>
                  <td hlmTd class="whitespace-normal">
                    @if (happened(row); as words) {
                      <span
                        [class]="row.finishReason.startsWith('error') ? 'text-destructive' : ''"
                        >{{ words }}</span
                      >
                    } @else {
                      <span class="text-muted-foreground">Nothing flagged</span>
                    }
                  </td>
                  <td hlmTd class="font-data text-xs max-sm:hidden" translate="no">
                    {{ row.model ?? "none" }}
                  </td>
                  <td hlmTd class="text-right font-data text-xs max-sm:hidden">
                    {{ cost(row.usd) }}
                  </td>
                </tr>
                <tr hlmTr [id]="'answer-detail-' + row.id" [hidden]="!isOpen(row.id)">
                  <td hlmTd colspan="5" class="whitespace-normal">
                    @if (isOpen(row.id)) {
                      <div class="flex max-w-prose flex-col gap-2 py-1 text-sm">
                        <p
                          class="m-0 whitespace-pre-wrap"
                          [textContent]="row.answer || '(no answer)'"
                        ></p>
                        @for (fact of facts(row); track $index) {
                          <p class="m-0 text-xs text-muted-foreground">{{ fact }}</p>
                        }
                        @if (row.citedIds.length) {
                          <p class="m-0 text-xs text-muted-foreground">
                            Cited:
                            <span class="font-data" translate="no">{{
                              row.citedIds.join(", ")
                            }}</span>
                          </p>
                        }
                        @if (row.droppedCitations.length) {
                          <p class="m-0 text-xs text-destructive">
                            Invented and removed before the visitor saw them:
                            <span class="font-data" translate="no">{{
                              row.droppedCitations.join(", ")
                            }}</span>
                          </p>
                        }
                        @let steps = row.trace?.steps ?? [];
                        @if (steps.length) {
                          <h3 class="m-0 text-xs font-medium">How it answered</h3>
                          <ol class="m-0 flex flex-col gap-1.5 pl-5 text-xs">
                            @for (step of steps; track $index) {
                              <li>
                                <p class="m-0">{{ stepSentence(step) }}</p>
                                @if (passedOverSentence(step); as passed) {
                                  <p class="m-0 text-muted-foreground">{{ passed }}</p>
                                }
                                @if (step.tools.length) {
                                  <ul class="m-0 flex flex-col gap-0.5 pl-4">
                                    @for (tool of step.tools; track $index) {
                                      <li class="break-all">
                                        <span class="font-data" translate="no"
                                          >{{ tool.name }} {{ tool.input }}</span
                                        >:
                                        <span [class]="toneClass(tool.outcome)">{{
                                          outcomeLabel(tool.outcome)
                                        }}</span>, {{ tool.resultChars | number }} characters.
                                      </li>
                                    }
                                  </ul>
                                }
                              </li>
                            }
                          </ol>
                        }
                        @if (source() === "terminal") {
                          <div class="flex flex-wrap items-start gap-2">
                            <app-diagnose-answer
                              [messageId]="row.id"
                              [describedBy]="'question-' + row.id"
                              (opened)="toJournal.emit($event)"
                            />
                            <app-freeze-case [message]="row" [describedBy]="'question-' + row.id" />
                          </div>
                        }
                      </div>
                    }
                  </td>
                </tr>
              </tbody>
            } @empty {
              <tbody hlmTBody>
                <tr hlmTr>
                  <td hlmTd colspan="5" class="whitespace-normal">
                    <div class="flex flex-wrap items-center gap-3 py-1">
                      <span class="text-muted-foreground">{{ empty() }}</span>
                      @if (filter() !== "all") {
                        <button
                          hlmBtn
                          type="button"
                          size="sm"
                          variant="outline"
                          (click)="showAll()"
                        >
                          Show all answers
                        </button>
                      }
                    </div>
                  </td>
                </tr>
              </tbody>
            }
          </table>
        </div>
        @if (more()) {
          <button
            hlmBtn
            type="button"
            size="sm"
            variant="outline"
            class="self-center"
            [disabled]="loadingOlder()"
            (click)="older()"
          >
            Show older answers
          </button>
        }
      }
    </section>
  `,
})
export class AssistantConversationsComponent implements OnInit {
  private readonly api = inject(AdminApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly injector = inject(Injector);
  private gone = false;

  /** A failure journal entry to open (plan phase 24: Diagnose). */
  readonly toJournal = output<string>();

  protected readonly filters = FILTERS;
  protected readonly sources = SOURCES;
  private readonly params = this.route.snapshot.queryParamMap;
  protected readonly filter = signal(filterFrom(this.params.get("filter")));
  protected readonly source = signal(sourceFrom(this.params.get("source")));
  protected readonly sort = signal(sortFrom(this.params.get("sort")));
  protected readonly rows = signal<ConversationRow[]>([]);
  protected readonly loading = signal(true);
  /** The API's reason when the answers did not arrive: never shown as "No answers". */
  protected readonly loadError = signal<string | null>(null);
  /** The last page came full: older answers may wait on the server. */
  protected readonly more = signal(false);
  protected readonly loadingOlder = signal(false);
  protected readonly opened = signal<ReadonlySet<string>>(new Set());
  /** The answer J and K move from: the last one opened or focused. */
  protected readonly cursor = signal<string | null>(null);

  /** The server sends the newest first; oldest first only turns the loaded rows round. */
  protected readonly shown = computed(() =>
    this.sort() === "oldest" ? this.rows().toReversed() : this.rows(),
  );
  protected readonly empty = computed(
    () => FILTERS.find((f) => f.id === this.filter())?.empty ?? "",
  );
  protected readonly countLine = computed(() => {
    const n = this.rows().length;
    return `${n} ${n === 1 ? "answer" : "answers"}, ${this.sort()} first.`;
  });

  private readonly heading = viewChild.required<ElementRef<HTMLElement>>("answersTitle");

  protected readonly ago = relativeTime;
  protected readonly exact = absoluteTime;
  protected readonly cost = cost;
  protected readonly facts = answerFacts;
  protected readonly happened = happenedWords;
  protected readonly stepSentence = stepSentence;
  protected readonly passedOverSentence = passedOverSentence;
  protected readonly outcomeLabel = toolOutcomeLabel;

  constructor() {
    inject(DestroyRef).onDestroy(() => (this.gone = true));
    // The address is the truth: Back, a link or a reload can change it under the view.
    this.route.queryParamMap.pipe(takeUntilDestroyed()).subscribe((params) => {
      if (params.get("view") !== "conversations") {
        return;
      }
      this.sort.set(sortFrom(params.get("sort")));
      const filter = filterFrom(params.get("filter"));
      const source = sourceFrom(params.get("source"));
      if (filter === this.filter() && source === this.source()) {
        return;
      }
      this.filter.set(filter);
      this.source.set(source);
      void this.load();
    });
  }

  ngOnInit(): void {
    void this.load();
  }

  protected onFilter(value: unknown): void {
    const filter = FILTERS.find((f) => f.id === value)?.id;
    if (!filter || filter === this.filter()) {
      return;
    }
    this.filter.set(filter);
    this.go({ filter: filter === "all" ? null : filter });
    void this.load();
  }

  protected onSource(value: unknown): void {
    const source = SOURCES.find((s) => s.id === value)?.id;
    if (!source || source === this.source()) {
      return;
    }
    this.source.set(source);
    this.go({ source: source === "terminal" ? null : source });
    void this.load();
  }

  protected async showAll(): Promise<void> {
    this.filter.set("all");
    this.go({ filter: null });
    await this.load();
    // The button went with the empty state: the focus goes to the heading, not the page.
    if (!this.gone) {
      afterNextRender(() => this.heading().nativeElement.focus(), { injector: this.injector });
    }
  }

  protected flipSort(): void {
    const sort = this.sort() === "oldest" ? "newest" : "oldest";
    this.sort.set(sort);
    this.go({ sort: sort === "oldest" ? sort : null });
  }

  /** The filter, the source and the order into the address, in place: Back leaves the view. */
  private go(params: Params): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: params,
      queryParamsHandling: "merge",
      replaceUrl: true,
    });
  }

  protected async load(): Promise<void> {
    const filter = this.filter();
    const source = this.source();
    this.loading.set(true);
    const result = await this.api.assistantConversations(filter, source);
    // A later choice's answer wins over an earlier one arriving late.
    if (filter !== this.filter() || source !== this.source()) {
      return;
    }
    this.loading.set(false);
    if (!result.ok) {
      this.loadError.set(result.error);
      return;
    }
    this.loadError.set(null);
    this.rows.set(result.data.messages);
    this.more.set(result.data.messages.length === PAGE);
    this.opened.set(new Set());
    this.cursor.set(null);
  }

  /** The next page back in time, after the oldest answer shown; the focus goes to the first that came. */
  protected async older(): Promise<void> {
    const oldest = this.rows().at(-1);
    if (!oldest || this.loadingOlder()) {
      return;
    }
    const filter = this.filter();
    const source = this.source();
    this.loadingOlder.set(true);
    // shortcut: `before` is the oldest answer's time to the millisecond, so a second answer in that
    // same millisecond is skipped; a cursor of time and id on the server would keep it.
    const result = await this.api.assistantConversations(filter, source, oldest.createdAt);
    this.loadingOlder.set(false);
    if (this.gone || filter !== this.filter() || source !== this.source()) {
      return;
    }
    if (!result.ok) {
      toast.error("Could not load older answers", { description: apiWords(result.error) });
      return;
    }
    const known = new Set(this.rows().map((row) => row.id));
    const fresh = result.data.messages.filter((row) => !known.has(row.id));
    this.rows.update((rows) => [...rows, ...fresh]);
    this.more.set(result.data.messages.length === PAGE);
    // The button may have gone with the last page: the focus goes on, never to the page.
    const first = this.sort() === "oldest" ? fresh.at(-1) : fresh.at(0);
    afterNextRender(
      () =>
        (first
          ? document.getElementById(`answer-${first.id}`)
          : this.heading().nativeElement
        )?.focus(),
      { injector: this.injector },
    );
  }

  protected isOpen(id: string): boolean {
    return this.opened().has(id);
  }

  protected toggle(id: string): void {
    this.cursor.set(id);
    this.opened.update((open) => {
      const next = new Set(open);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  /** J and K: the next or previous answer opens alone, its button taking the focus. */
  protected onKeydown(event: KeyboardEvent): void {
    const key = event.key.toLowerCase();
    if ((key !== "j" && key !== "k") || !isShortcutTarget(event)) {
      return;
    }
    const next = stepFrom(this.shown(), this.cursor(), key === "j" ? 1 : -1);
    if (!next) {
      return;
    }
    event.preventDefault();
    this.cursor.set(next.id);
    this.opened.set(new Set([next.id]));
    afterNextRender(() => document.getElementById(`answer-${next.id}`)?.focus(), {
      injector: this.injector,
    });
  }

  protected toneClass(outcome: ToolOutcome): string {
    return TONE_CLASS[toolTone(outcome)];
  }
}
