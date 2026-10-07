import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  inject,
  Injector,
  OnInit,
  output,
  signal,
  viewChild,
} from "@angular/core";
import { toast } from "@spartan-ng/brain/sonner";
import { HlmBadge } from "@spartan-ng/helm/badge";
import { HlmButton } from "@spartan-ng/helm/button";
import { HlmSpinner } from "@spartan-ng/helm/spinner";

import { AdminApiService } from "../admin-api.service";
import type { InsightTopic } from "../assistant-types";
import { scopeFromTitle, topicProblem, type InsightSnapshot, type InsightsView } from "../lessons";
import { LessonFormComponent } from "./lesson-form.component";

/**
 * What visitors keep asking, grouped into topics by one model call over the
 * last 30 days of questions (redacted), and what the assistant could not
 * answer. Each run is kept (plan phase 25): the last one shows here without
 * a model call, the admin's or the one the nightly check ran when failures
 * rose. Each topic can become an FAQ entry, and an unanswered one a lesson.
 */
@Component({
  selector: "app-assistant-insights",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [HlmBadge, HlmButton, HlmSpinner, LessonFormComponent],
  host: { class: "block" },
  template: `
    <section class="flex flex-col gap-4" aria-labelledby="insights-heading">
      <h2 id="insights-heading" class="m-0 text-base font-semibold">What visitors ask</h2>
      <div class="flex flex-wrap items-center gap-3">
        <button hlmBtn size="sm" [disabled]="loading()" (click)="analyse(false)">
          @if (loading()) {
            <hlm-spinner class="size-4" />
          } @else {
            Analyse visitor questions
          }
        </button>
        @if (topics() !== null) {
          <button hlmBtn variant="ghost" size="sm" [disabled]="loading()" (click)="analyse(true)">
            Refresh
          </button>
          <span class="text-xs text-muted-foreground">
            {{ analysed() }} question(s){{ cached() ? " · cached" : "" }}
          </span>
        }
      </div>
      <p class="m-0 text-xs text-muted-foreground">
        One model call (a fraction of a cent), counted toward the daily budget. The last run shows
        here without one.
      </p>
      @if (runLine(); as line) {
        <p class="m-0 text-xs">{{ line }}</p>
      }
      @if (view()?.trigger; as check) {
        <p class="m-0 text-xs text-muted-foreground">
          The nightly check, {{ when(check.at) }}: {{ check.reason }}
        </p>
      }

      @if (topics(); as list) {
        <ul class="m-0 flex list-none flex-col gap-3 p-0" role="list">
          @for (topic of list; track $index) {
            <li class="flex flex-col gap-2 rounded-lg border border-border p-4 text-sm">
              <div class="flex flex-wrap items-center gap-2">
                <strong [id]="'insight-topic-' + $index" class="font-medium">{{
                  topic.title
                }}</strong>
                <span hlmBadge variant="outline" class="font-mono">{{ topic.questions }}×</span>
                @if (topic.unanswered) {
                  <!-- Outlined: the filled destructive badge is under 4.5:1 at this size. -->
                  <span hlmBadge variant="outline" class="font-mono text-destructive"
                    >not answered</span
                  >
                }
              </div>
              <p class="m-0 text-muted-foreground">{{ topic.summary }}</p>
              <ul class="m-0 list-disc pl-5 text-foreground/85">
                @for (example of topic.examples; track $index) {
                  <li>{{ example }}</li>
                }
              </ul>
              <!-- Each topic repeats these buttons: its title says which one they act on. -->
              <div class="flex flex-wrap gap-2">
                <button
                  hlmBtn
                  variant="outline"
                  size="sm"
                  [attr.aria-describedby]="'insight-topic-' + $index"
                  (click)="toFaq.emit(topic.examples[0] ?? topic.title)"
                >
                  Turn into FAQ entry
                </button>
                @if (lessonReady()[$index] && lessonFor() !== $index) {
                  <button
                    hlmBtn
                    variant="outline"
                    size="sm"
                    [id]="'insight-make-' + $index"
                    [attr.aria-describedby]="'insight-topic-' + $index"
                    (click)="lessonFor.set($index)"
                  >
                    Make a lesson
                  </button>
                }
              </div>
              @if (lessonFor() === $index && snapshotId(); as snapshot) {
                <app-lesson-form
                  [key]="'topic-' + $index"
                  [heading]="'A lesson from “' + topic.title + '”'"
                  [source]="{ source: 'insight', snapshotId: snapshot, topic: $index }"
                  [scope]="scopes()[$index] ?? []"
                  (made)="lessonMade($index)"
                  (cancelled)="cancelLesson($index)"
                />
              }
              @if (made() === $index) {
                <p class="m-0 text-xs">
                  Lesson made: it is in the Journal tab, under Lessons.
                  <button
                    #journalLink
                    hlmBtn
                    variant="link"
                    size="sm"
                    class="h-auto p-0 text-xs"
                    (click)="toJournal.emit()"
                  >
                    Open the Journal
                  </button>
                </p>
              }
            </li>
          } @empty {
            <li class="text-sm text-muted-foreground">No visitor questions in the last 30 days.</li>
          }
        </ul>
      }
      <!-- Always in the page, so what is put in it is announced. -->
      <p class="sr-only" role="status">{{ said() }}</p>
    </section>
  `,
})
export class AssistantInsightsComponent implements OnInit {
  readonly toFaq = output<string>();
  /** A lesson was made: it lives in the Journal tab. */
  readonly toJournal = output<void>();

  private readonly api = inject(AdminApiService);
  private readonly injector = inject(Injector);
  /** The last run kept and the nightly check's last word; null until loaded. */
  protected readonly view = signal<InsightsView | null>(null);
  protected readonly topics = signal<InsightTopic[] | null>(null);
  protected readonly analysed = signal(0);
  protected readonly cached = signal(false);
  protected readonly loading = signal(false);
  /** The topic a lesson is being written for. */
  protected readonly lessonFor = signal<number | null>(null);
  /** The topic a lesson was just made from. */
  protected readonly made = signal<number | null>(null);
  protected readonly said = signal("");
  private readonly journalLink = viewChild<ElementRef<HTMLElement>>("journalLink");

  /** The run the topics shown came from: a lesson names it. */
  protected readonly snapshotId = computed(() => this.view()?.snapshot?.id ?? null);

  protected readonly lessonReady = computed(() =>
    (this.topics() ?? []).map((t) => !!this.snapshotId() && !topicProblem(t)),
  );

  protected readonly scopes = computed(() =>
    (this.topics() ?? []).map((t) => scopeFromTitle(t.title)),
  );

  protected readonly runLine = computed(() => {
    const run = this.view()?.snapshot;
    if (!run) return null;
    const at = this.when(run.createdAt);
    return run.trigger === "auto"
      ? `Run by the nightly check, ${at}, because ${run.reason}.`
      : `Run by you, ${at}.`;
  });

  /** The latest request: an earlier, slower answer never overwrites a later one. */
  private latest = 0;

  ngOnInit(): void {
    void this.load();
  }

  /** The last run kept, with no model call. */
  private async load(): Promise<void> {
    const mine = ++this.latest;
    const result = await this.api.latestInsights();
    // An API without kept runs: the button still works.
    if (!result.ok || mine !== this.latest) return;
    this.view.set(result.data);
    const run = result.data.snapshot;
    if (run) this.show(run.topics, run.analysed, false);
    await this.seen(run);
  }

  private show(topics: InsightTopic[], analysed: number, cached: boolean): void {
    this.topics.set(topics);
    this.analysed.set(analysed);
    this.cached.set(cached);
  }

  /** Shown here, the nightly check's run is seen, and every run before it: the notice goes. */
  private async seen(run: InsightSnapshot | null): Promise<void> {
    if (run?.trigger !== "auto" || run.seenAt) return;
    const seen = await this.api.insightsSeen(run.id);
    if (!seen.ok) return;
    this.view.update((v) =>
      v?.snapshot?.id === run.id
        ? { ...v, snapshot: { ...run, seenAt: new Date().toISOString() } }
        : v,
    );
  }

  protected async analyse(refresh: boolean): Promise<void> {
    const mine = ++this.latest;
    this.loading.set(true);
    this.lessonFor.set(null);
    this.made.set(null);
    const result = await this.api.assistantInsights(refresh);
    if (mine !== this.latest) return;
    this.loading.set(false);
    if (!result.ok) {
      toast.error("No insights", { description: result.error });
      return;
    }
    // The topics and the run they come from, from one answer: a lesson names that run.
    const run = result.data.snapshot ?? null;
    this.view.update((v) => ({ trigger: v?.trigger ?? null, snapshot: run }));
    this.show(result.data.topics, result.data.analysed, !!result.data.cached);
    await this.seen(run);
  }

  /** The form is gone: back to the topic's button. */
  protected cancelLesson(topic: number): void {
    this.lessonFor.set(null);
    afterNextRender(() => document.getElementById(`insight-make-${topic}`)?.focus(), {
      injector: this.injector,
    });
  }

  protected lessonMade(topic: number): void {
    this.lessonFor.set(null);
    this.made.set(topic);
    this.said.set("Lesson made: it is in the Journal tab, under Lessons.");
    // The form is gone: the admin lands on the way to the lesson.
    afterNextRender(() => this.journalLink()?.nativeElement.focus(), {
      injector: this.injector,
    });
  }

  protected when(iso: string): string {
    return new Date(iso).toLocaleString();
  }
}
