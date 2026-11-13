import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  OnInit,
  signal,
  untracked,
} from "@angular/core";
import { RouterLink } from "@angular/router";
import { NgIcon, provideIcons } from "@ng-icons/core";
import { lucideTriangleAlert } from "@ng-icons/lucide";
import { HlmButton } from "@spartan-ng/helm/button";

import {
  AdminApiService,
  type ApiResult,
  type MediaReconcile,
} from "../../admin/admin-api.service";
import { filterStatuses, type Proposal } from "../../admin/agent";
import type { ReviewQueue } from "../../admin/assistant-types";
import { FormSkeletonComponent } from "../../admin/components/load-state.component";
import { AdminPageHeaderComponent } from "../../admin/components/page-header.component";
import { ReadinessCardComponent } from "../../admin/components/readiness-card.component";
import type { FaqProposal } from "../../admin/faq-proposals";
import type { JournalView } from "../../admin/journal";
import type { LessonsView } from "../../admin/lessons";
import { AdminSessionService } from "../../admin/admin-session.service";
import { AdminPulseService, type PulsePart } from "../../admin/pulse.service";
import { RecoveryService, type RecoveryCopy } from "../../admin/recovery.service";
import { absoluteTime, relativeTime } from "../../admin/relative-time";
import { needsYou, TODAY_ROW } from "../../admin/today";
import { trustAlert } from "../../admin/trust";

/** Today's own reads, beside the pulse's: the media check and each queue's count. */
type Source = "reconcile" | "reviews" | "proposals" | "faq" | "journal" | "lessons";
const SOURCES: readonly Source[] = [
  "reconcile",
  "reviews",
  "proposals",
  "faq",
  "journal",
  "lessons",
];

/** What could not be checked, in words. */
const SOURCE_NAMES: Record<Source | "messages" | "assistant", string> = {
  messages: "the inbox",
  assistant: "the assistant",
  reconcile: "the media",
  reviews: "the answers to review",
  proposals: "the content agent's drafts",
  faq: "the FAQ proposals",
  journal: "the journal",
  lessons: "the lessons",
};

/** Dollars, to the cent; a sliver of a cent still shows as spent. */
function usd(value: number): string {
  if (value > 0 && value < 0.01) return "<$0.01";
  return `$${value.toFixed(2)}`;
}

/** "the inbox", "the inbox and the journal", "a, b and c". */
const sentence = (names: readonly string[]): string =>
  names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : (names[0] ?? "");

/**
 * Today: where the site stands in two sentences (what is live, the assistant's day, the inbox),
 * then everything that waits for you, worst first, each a row that leads where it is settled,
 * then what still makes the site look unfinished. The pulse's numbers are the rail's too.
 */
@Component({
  selector: "app-admin-dashboard",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    AdminPageHeaderComponent,
    FormSkeletonComponent,
    HlmButton,
    NgIcon,
    ReadinessCardComponent,
    RouterLink,
  ],
  viewProviders: [provideIcons({ lucideTriangleAlert })],
  host: { class: "block" },
  template: `
    <div class="flex max-w-4xl flex-col gap-6 pb-12">
      <app-page-header title="Today" />

      <!-- Where the site stands: what is live, the assistant's day, the inbox. -->
      <div class="-mt-4 flex flex-col gap-0.5 text-sm">
        @if (pulse.status(); as s) {
          @if (!s.lastPublish) {
            <p class="m-0">Nothing is live yet. {{ draftWords() }}</p>
          } @else if (live(); as id) {
            <p class="m-0">
              Published
              <time [attr.datetime]="s.lastPublish" [title]="absolute(s.lastPublish)">{{
                relative(s.lastPublish)
              }}</time>
              as
              <a class="font-data underline underline-offset-4" routerLink="/admin/publications"
                >#{{ id }}</a
              >. {{ draftWords() }}
            </p>
          } @else {
            <p class="m-0">
              Published
              <time [attr.datetime]="s.lastPublish" [title]="absolute(s.lastPublish)">{{
                relative(s.lastPublish)
              }}</time
              >. {{ draftWords() }}
            </p>
          }
        } @else if (isFailed("status")) {
          <p class="m-0">
            Could not check what is live.
            <button
              hlmBtn
              variant="link"
              size="sm"
              type="button"
              class="h-auto p-0 text-sm text-foreground underline"
              (click)="retryStatus()"
            >
              Try again
            </button>
          </p>
        }
        @if (spend(); as s) {
          <p class="m-0">
            The assistant is {{ s.word }}: <span class="font-data">{{ s.spent }}</span> of
            <span class="font-data">{{ s.budget }}</span> spent today. {{ inboxWords() }}
          </p>
        } @else if (assistantOff(); as reason) {
          <p class="m-0">The assistant is off: {{ reason }}. {{ inboxWords() }}</p>
        } @else if (isFailed("assistant")) {
          <p class="m-0">Could not check the assistant. {{ inboxWords() }}</p>
        } @else if (inboxWords()) {
          <p class="m-0">{{ inboxWords() }}</p>
        }
      </div>

      <section class="flex flex-col gap-2" aria-labelledby="needs-title">
        <!-- Focus waits here when a row's button goes. -->
        <h2 id="needs-title" tabindex="-1" class="m-0 text-section-title outline-none">
          Needs you
        </h2>
        @if (rows().length || failedNames()) {
          <ul class="m-0 -ml-3 list-none border-t border-border p-0" role="list">
            @if (failedNames(); as names) {
              <li>
                <button type="button" [class]="row" (click)="retry()">
                  <span class="min-w-0">Could not check {{ names }}.</span>&ngsp;<span
                  ></span>&ngsp;<span
                    class="text-right font-medium max-sm:col-start-2 max-sm:row-start-1"
                    >Try again</span
                  >
                </button>
              </li>
            }
            @for (item of rows(); track item.words) {
              <li>
                <a [class]="row" [routerLink]="item.link" [queryParams]="item.query ?? null">
                  <span class="min-w-0 wrap-anywhere">
                    @if (item.sign) {
                      <ng-icon
                        name="lucideTriangleAlert"
                        size="16"
                        class="mr-1.5 inline-block align-[-3px]"
                        [class]="item.sign === 'error' ? 'text-destructive' : 'text-accent-orange'"
                        aria-hidden="true"
                      />
                    }
                    {{ item.words }}</span
                  >&ngsp;<span
                    class="font-data text-xs text-faint-foreground max-sm:col-start-1 max-sm:row-start-2"
                    >{{ item.when }}</span
                  >&ngsp;<span
                    class="text-right font-medium max-sm:col-start-2 max-sm:row-span-2 max-sm:row-start-1"
                    >{{ item.action }}</span
                  >
                </a>
              </li>
            }
          </ul>
        } @else if (settled()) {
          <div class="flex flex-col gap-0.5">
            <p class="m-0 text-sm">Nothing needs you.</p>
            @if (pulse.status()?.lastPublish; as at) {
              @if (live(); as id) {
                <p class="m-0 text-hint text-muted-foreground">
                  Last published
                  <time [attr.datetime]="at" [title]="absolute(at)">{{ relative(at) }}</time> as
                  <span class="font-data">#{{ id }}</span
                  >.
                </p>
              } @else {
                <p class="m-0 text-hint text-muted-foreground">
                  Last published
                  <time [attr.datetime]="at" [title]="absolute(at)">{{ relative(at) }}</time
                  >.
                </p>
              }
            }
          </div>
        } @else {
          <app-form-skeleton kind="list" [rows]="3" label="Checking what needs you…" />
        }
      </section>

      <!-- While the site still shows placeholder content, it says so here. -->
      <app-readiness-card />
    </div>
  `,
})
export default class AdminDashboardPage implements OnInit {
  private readonly api = inject(AdminApiService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  protected readonly pulse = inject(AdminPulseService);
  private readonly recovery = inject(RecoveryService);
  private readonly session = inject(AdminSessionService);

  protected readonly row = TODAY_ROW;

  /** The live publication's number: it links to History. */
  protected readonly live = signal<number | null>(null);
  /** Unsaved edits kept in this browser, the newest of each page; null until read. */
  private readonly copies = signal<RecoveryCopy[] | null>(null);
  private readonly reconcile = signal<MediaReconcile | null>(null);
  private readonly reviews = signal<ReviewQueue | null>(null);
  private readonly proposals = signal<Proposal[] | null>(null);
  private readonly faq = signal<FaqProposal[] | null>(null);
  private readonly journal = signal<JournalView | null>(null);
  private readonly lessons = signal<LessonsView | null>(null);
  /** Today's reads whose last answer failed. */
  private readonly failed = signal<ReadonlySet<Source>>(new Set());

  protected readonly rows = computed(() =>
    needsYou({
      totpOff: this.session.user()?.totpEnrolled === false,
      reconcile: this.reconcile(),
      alert: this.pulse.assistantAlert(),
      trust: trustAlert(this.pulse.assistant()?.trust) !== null,
      messages: this.pulse.messages(),
      copies: (this.copies() ?? []).map(({ page, href, at }) => ({ page, href, at })),
      reviews: this.reviews(),
      proposals: this.proposals(),
      faq: this.faq(),
      journal: this.journal(),
      lessons: this.lessons(),
    }),
  );

  /** What could not be checked: a row says so, so an empty list is never a guess. */
  protected readonly failedNames = computed(() =>
    sentence(
      [
        ...(["messages", "assistant"] as const).filter((part) => this.pulse.failed().has(part)),
        ...this.failed(),
      ].map((source) => SOURCE_NAMES[source]),
    ),
  );

  /** Every source has answered: only then may Today say that nothing needs you. */
  protected readonly settled = computed(
    () =>
      this.copies() !== null &&
      this.pulse.messages() !== null &&
      this.pulse.assistant() !== null &&
      [
        this.reconcile(),
        this.reviews(),
        this.proposals(),
        this.faq(),
        this.journal(),
        this.lessons(),
      ].every((read) => read !== null),
  );

  /** What publishing now would change, as the top bar's Publish counts it. */
  protected readonly draftWords = computed(() => {
    if (!this.pulse.status()?.hasUnpublishedChanges) return "Everything is live.";
    const review = this.pulse.review();
    if (review?.issues) {
      return `${review.issues} ${review.issues === 1 ? "problem stops" : "problems stop"} the next publish.`;
    }
    if (review?.total) {
      return `${review.total} ${review.total === 1 ? "change is" : "changes are"} not live.`;
    }
    return "Changes are not live.";
  });

  protected readonly inboxWords = computed(() => {
    if (this.pulse.messages() === null) return "";
    const fresh = this.pulse.newMessages();
    return fresh ? `Inbox: ${fresh} new.` : "Inbox: nothing new.";
  });

  /** Today's spend against the budget, while the assistant is on. */
  protected readonly spend = computed(() => {
    const state = this.pulse.assistant()?.state;
    if (!state || state.state === "off") return null;
    return {
      word: state.state === "resting" ? "resting" : "answering",
      spent: usd(state.spentUsd),
      budget: usd(state.budgetUsd),
    };
  });

  protected readonly assistantOff = computed(() => {
    const state = this.pulse.assistant()?.state;
    return state?.state === "off" ? state.reason : null;
  });

  constructor() {
    // A publish from the dialog moves the live number.
    effect(() => {
      if (this.pulse.publishes() > 0) untracked(() => void this.loadLive());
    });
  }

  ngOnInit(): void {
    void this.pulse.refreshIfStale();
    void this.loadLive();
    void this.loadCopies();
    void this.load(SOURCES);
  }

  protected isFailed(part: PulsePart): boolean {
    return this.pulse.failed().has(part);
  }

  protected retryStatus(): void {
    void this.pulse.refresh(["status", "review"]);
  }

  /** Asks again for what failed; once nothing has, the button is gone and the heading has the focus. */
  protected async retry(): Promise<void> {
    const parts = (["messages", "assistant"] as const).filter((part) => this.isFailed(part));
    await Promise.all([this.pulse.refresh(parts), this.load(Array.from(this.failed()))]);
    if (!this.failedNames())
      this.host.nativeElement.querySelector<HTMLElement>("#needs-title")?.focus();
  }

  private load(sources: readonly Source[]): Promise<unknown> {
    return Promise.all(
      sources.map((source) => {
        switch (source) {
          case "reconcile":
            return this.read(source, this.api.mediaReconcile(), (d) => this.reconcile.set(d));
          case "reviews":
            return this.read(source, this.api.assistantReviews(), (d) => this.reviews.set(d));
          case "proposals":
            // The Agent page's own question: its "Open" filter.
            return this.read(source, this.api.proposals(filterStatuses("open")), (d) =>
              this.proposals.set(d.proposals),
            );
          case "faq":
            return this.read(source, this.api.faqProposals(["proposed", "needs_you"]), (d) =>
              this.faq.set(d.proposals),
            );
          case "journal":
            return this.read(source, this.api.assistantJournal("proposed"), (d) =>
              this.journal.set(d),
            );
          case "lessons":
            return this.read(source, this.api.assistantLessons(), (d) => this.lessons.set(d));
        }
      }),
    );
  }

  /** A failed read keeps what was there, and says so in the list. */
  private async read<T>(
    source: Source,
    request: Promise<ApiResult<T>>,
    apply: (data: T) => void,
  ): Promise<void> {
    const result = await request;
    if (result.ok) apply(result.data);
    this.failed.update((failed) => {
      const next = new Set(failed);
      if (result.ok) next.delete(source);
      else next.add(source);
      return next;
    });
  }

  private async loadCopies(): Promise<void> {
    const newest = new Map<string, RecoveryCopy>();
    for (const copy of await this.recovery.list()) {
      const seen = newest.get(copy.href);
      if (!seen || copy.at > seen.at) newest.set(copy.href, copy);
    }
    this.copies.set([...newest.values()].sort((a, b) => b.at - a.at));
  }

  private async loadLive(): Promise<void> {
    const result = await this.api.publications();
    if (result.ok) this.live.set(result.data.publications.find((p) => p.live)?.id ?? null);
  }

  protected relative(iso: string): string {
    return relativeTime(iso);
  }

  protected absolute(iso: string): string {
    return absoluteTime(iso);
  }
}
