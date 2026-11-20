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
  signal,
  viewChild,
} from "@angular/core";
import { RouterLink } from "@angular/router";
import { NgIcon, provideIcons } from "@ng-icons/core";
import {
  lucideCircleAlert,
  lucideCircleCheck,
  lucideRefreshCw,
  lucideTriangleAlert,
} from "@ng-icons/lucide";
import { toast } from "@spartan-ng/brain/sonner";
import { HlmButton } from "@spartan-ng/helm/button";

import { AdminApiService } from "../admin-api.service";
import { filterStatuses } from "../agent";
import { FormSkeletonComponent, LoadErrorComponent } from "../components/load-state.component";
import { noticeLine } from "../lessons";
import {
  joiner,
  modelLines,
  QUEUE_ROW,
  shareOf,
  spendRows,
  stateLine,
  switchedOff,
  usd,
  WAITING_ROW,
} from "../now";
import { AdminPulseService } from "../pulse.service";
import { needsYou, QUEUE_NAMES, QUEUES, sentence, type QueueFacts } from "../today";
import { AssistantTrustComponent } from "./assistant-trust.component";

/** An icon beside the words, never alone: status is not told by colour (plan 5, Colour). */
const ICONS = {
  ok: "lucideCircleCheck",
  warn: "lucideTriangleAlert",
  off: "lucideCircleAlert",
  trying: "lucideRefreshCw",
} as const;

const TONES = {
  ok: "text-available",
  warn: "text-destructive",
  off: "text-destructive",
  trying: "text-muted-foreground",
} as const;

/**
 * Now, the Assistant's first view (plan 5, U18): one screen at 1280×800 that says whether it
 * answers, what waits for you, what today costs against the budget, and how each model is doing,
 * in words. The reports went to Quality.
 */
@Component({
  selector: "app-assistant-now",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    AssistantTrustComponent,
    FormSkeletonComponent,
    HlmButton,
    LoadErrorComponent,
    NgIcon,
    RouterLink,
  ],
  viewProviders: [
    provideIcons({ lucideCircleAlert, lucideCircleCheck, lucideRefreshCw, lucideTriangleAlert }),
  ],
  host: { class: "flex flex-col gap-6" },
  template: `
    <section aria-labelledby="now-state">
      <h2 id="now-state" class="sr-only">State</h2>
      @if (lead(); as line) {
        <p class="m-0 flex items-start gap-2 text-sm">
          <ng-icon
            [name]="icons[line.tone]"
            size="16"
            class="mt-0.5 shrink-0"
            [class]="tones[line.tone]"
            aria-hidden="true"
          />
          <span>{{ line.words }}</span>
        </p>
      } @else if (pulse.failed().has("assistant")) {
        <app-load-error
          compact
          title="Could not load the assistant's state"
          (retry)="retryState()"
        />
      } @else {
        <app-form-skeleton kind="list" [rows]="1" label="Loading the assistant's state…" />
      }
    </section>

    <div class="grid items-start gap-6 lg:grid-cols-2">
      <section class="group flex flex-col gap-2" aria-labelledby="now-waits">
        <!-- Focus waits here when a row's button goes. -->
        <h2 #waitsTitle id="now-waits" tabindex="-1" class="m-0 text-section-title outline-none">
          Waits for you
        </h2>
        <div class="-ml-3 border-border has-[li]:border-t">
          <app-assistant-trust part="waiting" (acted)="focusWaits()" />
          <ul class="m-0 list-none p-0" role="list">
            @if (notice(); as n) {
              <li [class]="waitingRow">
                <p id="now-notice" class="m-0 min-w-0">{{ noticeWords(n) }}</p>
                <span class="flex shrink-0 gap-2">
                  <a
                    hlmBtn
                    size="sm"
                    variant="outline"
                    routerLink="/admin/assistant"
                    [queryParams]="{ view: 'questions' }"
                    aria-describedby="now-notice"
                    >Open Insights</a
                  >
                  <button
                    hlmBtn
                    size="sm"
                    variant="ghost"
                    type="button"
                    aria-describedby="now-notice"
                    (click)="seen(n.id)"
                  >
                    Seen
                  </button>
                </span>
              </li>
            }
            @if (unchecked(); as names) {
              <li>
                <button type="button" [class]="queueRow" (click)="retryQueues()">
                  <span class="min-w-0">Could not check {{ names }}.</span>&ngsp;<span
                    class="text-right font-medium"
                    >Try again</span
                  >
                </button>
              </li>
            }
          </ul>
        </div>
        <!-- Each queue's count, a link to it, in one sentence: Today lists them as rows. -->
        @if (rows().length) {
          <p class="m-0 text-sm">
            In the queues:
            @for (row of rows(); track row.words; let i = $index, n = $count) {
              <a
                class="touch-manipulation underline decoration-muted-foreground underline-offset-4 hover:decoration-foreground"
                [routerLink]="row.link"
                [queryParams]="row.query ?? null"
                >{{ row.words }}</a>{{ joiner(i, n) }}
            }
          </p>
        }
        @if (quiet()) {
          <p class="m-0 text-sm group-has-[li]:hidden">Nothing waits for you.</p>
        } @else if (!queues()) {
          <app-form-skeleton kind="list" [rows]="2" label="Checking what waits…" />
        }
      </section>

      @if (pulse.assistant(); as h) {
        <section class="flex flex-col gap-2" aria-labelledby="now-spend">
          <h2 id="now-spend" class="m-0 text-section-title">Spent today</h2>
          @if (h.spend; as s) {
            <!-- One scale for every bar, the day's budget; the line where the admin's tools stop
                 (the visitors' reserve) runs through them all. -->
            <ul class="m-0 flex list-none flex-col gap-1 p-0 text-sm" role="list">
              <li [class]="spendRow">
                <span class="text-figure tabular-nums">{{ usd(s.totalUsd) }}</span>
                <span class="relative h-2.5 bg-surface-2" aria-hidden="true">
                  <span
                    class="absolute inset-y-0 left-0 rounded-r bg-foreground"
                    [style.width.%]="share(s, s.totalUsd) * 100"
                  ></span>
                  <span
                    class="absolute -inset-y-2 w-px bg-muted-foreground"
                    [style.left.%]="fence(s) * 100"
                  ></span>
                </span>
                <span class="text-right text-muted-foreground"
                  >of <span class="font-data text-xs">{{ usd(s.budgetUsd) }}</span></span
                >
              </li>
              @for (row of spend(); track row.feature) {
                <li [class]="spendRow">
                  <span>{{ row.label }}</span>
                  <span class="relative h-1.5 bg-surface-2" aria-hidden="true">
                    <!-- A sliver of a cent still shows as spent. -->
                    <span
                      class="absolute inset-y-0 left-0 rounded-r bg-foreground"
                      [style.width.%]="row.share * 100"
                      [style.min-width.px]="row.spentUsd > 0 ? 2 : 0"
                    ></span>
                    <span
                      class="absolute -inset-y-2 w-px bg-muted-foreground"
                      [style.left.%]="fence(s) * 100"
                    ></span>
                  </span>
                  <span class="text-right font-data text-xs">{{ usd(row.spentUsd) }}</span>
                  @if (row.stopped) {
                    <span class="col-span-2 col-start-2 text-hint text-muted-foreground">{{
                      row.stopped
                    }}</span>
                  }
                </li>
              }
            </ul>
            <p class="m-0 text-hint text-muted-foreground">
              The admin's tools stop at the line,
              <span class="font-data">{{ usd(s.reserveLineUsd) }}</span>: the rest is kept for
              visitors.{{ h.models?.freeOnly ? " List prices: the free tier bills nothing." : "" }}
              @if (off(); as names) {
                Switched off: {{ names }}.
                <a
                  routerLink="/admin/assistant"
                  [queryParams]="{ view: 'settings' }"
                  class="touch-manipulation underline underline-offset-4 hover:text-foreground"
                  >Settings</a
                >
              }
            </p>
          } @else if (h.state.state !== "off") {
            <!-- An API older than the spending fences: the day's sum alone. -->
            <p class="m-0 text-figure tabular-nums">
              {{ usd(h.state.spentUsd) }}
              <span class="text-sm font-normal text-muted-foreground"
                >of {{ usd(h.state.budgetUsd) }}</span
              >
            </p>
          }
        </section>
      }
    </div>

    @if (pulse.assistant(); as h) {
      <section class="flex flex-col gap-2" aria-labelledby="now-models">
        <h2 id="now-models" class="m-0 text-section-title">Models</h2>
        @if (h.models?.freeOnly === false) {
          <p class="m-0 flex items-start gap-2 text-sm">
            <ng-icon
              name="lucideTriangleAlert"
              size="16"
              class="mt-0.5 shrink-0 text-destructive"
              aria-hidden="true"
            />
            <span>The free-tier guard is off on this server: models that bill may be called.</span>
          </p>
        }
        <ul class="m-0 grid list-none gap-x-6 gap-y-1.5 p-0 text-sm lg:grid-cols-2" role="list">
          @for (m of models(); track m.model) {
            <li class="flex items-start gap-2">
              <ng-icon
                [name]="icons[m.tone]"
                size="16"
                class="mt-0.5 shrink-0"
                [class]="tones[m.tone]"
                aria-hidden="true"
              />
              <div class="min-w-0">
                <p class="m-0">
                  <span class="font-data text-xs wrap-anywhere" translate="no">{{ m.model }}</span>:
                  {{ m.words }}
                </p>
                @if (m.error; as error) {
                  <p class="m-0 line-clamp-1 text-hint text-muted-foreground" [title]="error">
                    {{ error }}
                  </p>
                }
              </div>
            </li>
          } @empty {
            <li class="text-muted-foreground">No model is set up on this server.</li>
          }
        </ul>
      </section>
    }
  `,
})
export class AssistantNowComponent implements OnInit {
  protected readonly pulse = inject(AdminPulseService);
  private readonly api = inject(AdminApiService);
  private readonly injector = inject(Injector);
  private readonly waitsTitle = viewChild<ElementRef<HTMLElement>>("waitsTitle");
  private gone = false;

  protected readonly icons = ICONS;
  protected readonly tones = TONES;
  protected readonly waitingRow = WAITING_ROW;
  protected readonly queueRow = QUEUE_ROW;
  /** Label, bar, sum: fixed columns, so every bar starts and ends at the same place. */
  protected readonly spendRow =
    "grid grid-cols-[8.5rem_minmax(0,1fr)_4.5rem] items-center gap-x-3 gap-y-0.5";
  protected readonly usd = usd;
  protected readonly share = shareOf;
  protected readonly noticeWords = noticeLine;
  protected readonly joiner = joiner;

  /** Each queue's read, as its own screen asks; null until they answer. */
  protected readonly queues = signal<QueueFacts | null>(null);

  protected readonly lead = computed(() => {
    const health = this.pulse.assistant();
    return health ? stateLine(health) : null;
  });
  protected readonly notice = computed(() => this.pulse.assistant()?.learning?.notice ?? null);
  protected readonly spend = computed(() => {
    const spend = this.pulse.assistant()?.spend;
    return spend ? spendRows(spend) : [];
  });
  protected readonly off = computed(() => {
    const spend = this.pulse.assistant()?.spend;
    return spend ? sentence(switchedOff(spend)) : "";
  });
  protected readonly models = computed(() => {
    const health = this.pulse.assistant();
    return health ? modelLines(health) : [];
  });

  /** Today's rows for the queues alone: the same counts as Today and each queue's screen. */
  protected readonly rows = computed(() => {
    const queues = this.queues();
    if (!queues) {
      return [];
    }
    const none = { totpOff: false, reconcile: null, alert: null, messages: null, copies: [] };
    return needsYou({ ...none, ...queues });
  });

  /** The queues whose read failed, in words: never "Nothing waits" while one is unknown. */
  protected readonly unchecked = computed(() => {
    const queues = this.queues();
    if (!queues) {
      return "";
    }
    const failed = QUEUES.filter((key) => queues[key] === null);
    return sentence(failed.map((key) => QUEUE_NAMES[key]));
  });

  /** Everything has answered and nothing waits; a trust row shown meanwhile hides it (CSS). */
  protected readonly quiet = computed(() => {
    const health = this.pulse.assistant();
    const trust = health?.trust;
    return (
      health !== null &&
      this.queues() !== null &&
      !this.unchecked() &&
      !this.rows().length &&
      !this.notice() &&
      !trust?.alerts &&
      !trust?.demoted.length
    );
  });

  constructor() {
    inject(DestroyRef).onDestroy(() => (this.gone = true));
  }

  ngOnInit(): void {
    // Fresh numbers on arrival: the rail's are from the layout's last look.
    void this.pulse.refresh(["assistant"]);
    void this.loadQueues();
  }

  /** Where the admin's tools stop, on the day's scale. */
  protected fence(spend: { publicReserve: number }): number {
    return 1 - spend.publicReserve;
  }

  protected retryState(): void {
    void this.pulse.refresh(["assistant"]);
  }

  /** Asks again; once nothing failed, the button is gone and the heading has the focus. */
  protected async retryQueues(): Promise<void> {
    await this.loadQueues();
    if (!this.unchecked()) {
      this.focusWaits();
    }
  }

  private async loadQueues(): Promise<void> {
    const [reviews, proposals, faq, journal, lessons] = await Promise.all([
      this.api.assistantReviews(),
      // The Agent page's own question: its "Open" filter (as Today asks).
      this.api.proposals(filterStatuses("open")),
      this.api.faqProposals(["proposed", "needs_you"]),
      this.api.assistantJournal("proposed"),
      this.api.assistantLessons(),
    ]);
    this.queues.set({
      reviews: reviews.ok ? reviews.data : null,
      proposals: proposals.ok ? proposals.data.proposals : null,
      faq: faq.ok ? faq.data.proposals : null,
      journal: journal.ok ? journal.data : null,
      lessons: lessons.ok ? lessons.data : null,
    });
  }

  /** The nightly check's insights, seen: the notice goes, and the focus with it to the heading. */
  protected async seen(id: string): Promise<void> {
    const result = await this.api.insightsSeen(id);
    if (!result.ok) {
      toast.error("Could not mark the insights seen", { description: result.error });
      return;
    }
    this.pulse.assistant.update((h) => (h ? { ...h, learning: { notice: null } } : h));
    toast.success("Marked as seen");
    this.focusWaits();
  }

  /** A row's button went: the list's heading takes the focus, once the row is gone. */
  protected focusWaits(): void {
    if (this.gone) {
      return;
    }
    afterNextRender(() => this.waitsTitle()?.nativeElement.focus(), { injector: this.injector });
  }
}
