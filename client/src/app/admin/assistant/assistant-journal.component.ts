import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  Injector,
  input,
  OnInit,
  output,
  signal,
} from "@angular/core";
import { toast } from "@spartan-ng/brain/sonner";
import { HlmButton } from "@spartan-ng/helm/button";
import { HlmToggleGroupImports } from "@spartan-ng/helm/toggle-group";

import { AdminApiService } from "../admin-api.service";
import { apiWords } from "../api-words";
import { FormSkeletonComponent, LoadErrorComponent } from "../components/load-state.component";
import { MOD } from "../components/shortcut-sheet.component";
import { decisionKey } from "../decision-keys";
import {
  STATUSES,
  stoppedReplays,
  type JournalEntry,
  type JournalStatus,
  type JournalView,
} from "../journal";
import {
  promoteProblem,
  scopeFromEntries,
  type Lesson,
  type LessonSource,
  type LessonsView,
} from "../lessons";
import { JournalEntryComponent } from "./journal-entry.component";
import { JournalLessonsComponent } from "./journal-lessons.component";
import { LessonFormComponent } from "./lesson-form.component";

type Filter = "all" | JournalStatus;

/** Entries a lesson may come from. */
const decided = (entry: JournalEntry) => entry.status === "accepted" || entry.status === "fixed";

const formatCount = (n: number | null | undefined): string =>
  n === null || n === undefined ? "" : ` ${n}`;

/**
 * The failure journal (plan phase 24): why visitors' answers failed, worked
 * out by experiment with no model (Conversations → Diagnose), and what was
 * done about it. Each entry carries seven hypotheses with the evidence for
 * and against each; the admin writes the root cause and the heuristic,
 * accepts it, links the fix and a regression case, and marks it fixed or
 * retires it. Lessons come first (plan phase 25), the book's retrieval order:
 * lessons, then the entries they came from, then the answers.
 */
@Component({
  selector: "app-assistant-journal",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormSkeletonComponent,
    HlmButton,
    HlmToggleGroupImports,
    JournalEntryComponent,
    JournalLessonsComponent,
    LessonFormComponent,
    LoadErrorComponent,
  ],
  host: { class: "flex flex-col gap-8", "(document:keydown)": "onKeydown($event)" },
  template: `
    @if (lessonsError(); as reason) {
      <app-load-error
        compact
        title="Could not load the lessons"
        [reason]="reason"
        (retry)="load()"
      />
    } @else if (lessons(); as view) {
      <app-journal-lessons
        [lessons]="view.lessons"
        (changed)="replaceLesson($event)"
        (deleted)="dropLesson($event)"
      />
    }
    <section class="flex flex-col gap-4" aria-labelledby="journal-heading" data-queue>
      <div class="flex flex-col gap-1">
        <h2 id="journal-heading" class="m-0 text-base font-semibold">Failure journal</h2>
        <p class="m-0 text-sm text-muted-foreground">
          Why answers failed, by experiment and not by feel: Diagnose (in Conversations) weighs
          seven causes on the evidence and proposes a fix and a lesson. Nothing counts until you
          accept it.
        </p>
        <p class="m-0 text-hint text-muted-foreground pointer-coarse:hidden">
          J and K move, A accepts or marks fixed, X retires, {{ mod }} ↵ does the same from a field.
        </p>
      </div>
      <div
        hlmToggleGroup
        type="single"
        variant="outline"
        size="sm"
        aria-label="Journal filter"
        [nullable]="false"
        [value]="filter()"
        (valueChange)="onFilter($event)"
      >
        @for (option of filters(); track option.id) {
          <button hlmToggleGroupItem type="button" [value]="option.id">{{ option.label }}</button>
        }
      </div>

      @if (chosen().length) {
        <div class="flex flex-wrap items-center gap-2 text-xs">
          <button
            id="journal-promote"
            hlmBtn
            size="sm"
            variant="outline"
            type="button"
            aria-describedby="journal-promote-hint"
            (click)="promoting.set(true)"
          >
            Make a lesson from {{ chosen().length }} selected
          </button>
          <p id="journal-promote-hint" class="m-0 text-muted-foreground">
            {{ promoteHint() ?? "Enough to corroborate a lesson." }}
          </p>
        </div>
      }
      @if (promoting() && chosen().length) {
        <app-lesson-form
          key="journal"
          heading="A lesson from the selected entries"
          [source]="promoteSource()"
          [scope]="promoteScope()"
          [sourceProblem]="promoteHint()"
          (made)="lessonMade($event)"
          (cancelled)="cancelPromote()"
        />
      }

      @if (loading()) {
        <app-form-skeleton kind="list" [rows]="2" label="Loading the journal…" />
      } @else if (journalError(); as reason) {
        <app-load-error title="Could not load the journal" [reason]="reason" (retry)="load()" />
      } @else {
        @if (waitingLine(); as line) {
          <!-- Also the done line: the last decision gives it the focus. -->
          <p id="journal-waiting" tabindex="-1" class="m-0 text-sm" data-queue-done>{{ line }}</p>
        }
        <ul class="m-0 flex list-none flex-col gap-3 p-0" role="list">
          @for (entry of shown(); track entry.id) {
            <li class="flex flex-col gap-1">
              @if (isDecided(entry)) {
                <label class="flex items-center gap-2 text-xs text-muted-foreground">
                  <input
                    type="checkbox"
                    class="size-4 accent-foreground"
                    [attr.aria-describedby]="'journal-' + entry.id"
                    [checked]="selected().has(entry.id)"
                    (change)="toggle(entry.id)"
                  />
                  Use in a lesson
                </label>
              }
              <app-journal-entry
                [entry]="entry"
                [open]="entry.id === focus()"
                [resumable]="resumable()[entry.id] ?? null"
                (changed)="replace($event)"
                (deleted)="drop($event)"
                (replayed)="load()"
                (toFaqProposal)="toFaqProposal.emit($event)"
              />
            </li>
          } @empty {
            <li class="text-sm text-muted-foreground">
              Nothing here yet: open Conversations and Diagnose an answer that went wrong.
            </li>
          }
        </ul>
      }
    </section>
  `,
})
export class AssistantJournalComponent implements OnInit {
  private readonly api = inject(AdminApiService);
  private readonly injector = inject(Injector);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  protected readonly mod = MOD;

  /** The entry the admin came to see: listed first, its evidence open. */
  readonly focus = input<string | null>(null);
  /** An FAQ proposal drafted from an entry (plan phase 31): it waits in the FAQ tab. */
  readonly toFaqProposal = output<string>();

  protected readonly filter = signal<Filter>("all");
  protected readonly data = signal<JournalView | null>(null);
  protected readonly loading = signal(true);
  /** Per entry, its newest replay when that one stopped short: the entry offers to resume it. */
  protected readonly resumable = signal<ReturnType<typeof stoppedReplays>>({});
  /** Lessons (plan phase 25); null until loaded, or from an API without them. */
  protected readonly lessons = signal<LessonsView | null>(null);
  /** Why the first read of the journal or of the lessons failed, said in its place; a later one toasts. */
  protected readonly journalError = signal<string | null>(null);
  protected readonly lessonsError = signal<string | null>(null);
  /** "2 journal entries wait for a decision.", or the done line once none does; null while empty. */
  protected readonly waitingLine = computed(() => {
    const counts = this.data()?.counts;
    if (!counts || !Object.values(counts).some((n) => n > 0)) {
      return null;
    }
    const waiting = counts.proposed;
    if (!waiting) {
      return "No journal entry waits for a decision.";
    }
    return waiting === 1
      ? "1 journal entry waits for a decision."
      : `${waiting} journal entries wait for a decision.`;
  });
  /** Entries ticked for a lesson. */
  protected readonly selected = signal<ReadonlySet<string>>(new Set());
  protected readonly promoting = signal(false);

  protected readonly isDecided = decided;
  /** The ticked entries still accepted or fixed. */
  protected readonly chosen = computed(() =>
    (this.data()?.entries ?? []).filter((e) => this.selected().has(e.id) && decided(e)),
  );
  protected readonly promoteHint = computed(() => promoteProblem(this.chosen()));
  protected readonly promoteSource = computed<LessonSource>(() => ({
    source: "journal",
    journalIds: this.chosen().map((e) => e.id),
  }));
  protected readonly promoteScope = computed(() => scopeFromEntries(this.chosen()));

  protected readonly filters = computed<{ id: Filter; label: string }[]>(() => {
    const counts = this.data()?.counts;
    const total = counts ? Object.values(counts).reduce((sum, n) => sum + n, 0) : null;
    return [
      { id: "all", label: `All${formatCount(total)}` },
      ...STATUSES.map((s) => ({ id: s.id, label: `${s.label}${formatCount(counts?.[s.id])}` })),
    ];
  });

  protected readonly shown = computed(() => {
    const entries = this.data()?.entries ?? [];
    const focus = this.focus();
    const first = entries.find((e) => e.id === focus);
    return first ? [first, ...entries.filter((e) => e !== first)] : entries;
  });

  constructor() {
    // Nothing left to promote (unticked, or filtered out of the list): the form closes, and a
    // later tick or filter shows the button again without reopening the form under focus.
    effect(() => {
      if (!this.chosen().length) {
        this.promoting.set(false);
      }
    });
  }

  ngOnInit(): void {
    void this.load();
  }

  /** J, K, A, X and Ctrl/⌘ Enter on the lessons, then the entries, in page order (plan 5, U21). */
  protected onKeydown(event: KeyboardEvent): void {
    decisionKey(event, this.host.nativeElement);
  }

  protected onFilter(value: unknown): void {
    const filter = this.filters().find((f) => f.id === value)?.id;
    if (!filter) {
      return;
    }
    this.filter.set(filter);
    void this.load();
  }

  async load(): Promise<void> {
    this.loading.set(!this.data());
    const filter = this.filter();
    const [result, runs, lessons] = await Promise.all([
      this.api.assistantJournal(filter === "all" ? undefined : filter),
      this.api.listRuns(),
      this.api.assistantLessons(),
    ]);
    this.loading.set(false);
    if (runs.ok) {
      this.resumable.set(stoppedReplays(runs.data.runs));
    }
    // An API without lessons answers 404: there are none. A later failure keeps what is shown.
    if (lessons.ok) {
      this.lessons.set(lessons.data);
      this.lessonsError.set(null);
    } else if (lessons.error !== "http_404" && !this.lessons()) {
      this.lessonsError.set(lessons.error);
    }
    if (result.ok) {
      this.data.set(result.data);
      this.journalError.set(null);
    } else if (this.data()) {
      // The entries stay, and what was typed in them: a toast says the read failed.
      toast.error("Could not load the journal", { description: apiWords(result.error) });
    } else {
      this.journalError.set(result.error);
    }
  }

  protected replace(entry: JournalEntry): void {
    const current = this.data();
    if (!current) {
      return;
    }
    const before = current.entries.find((e) => e.id === entry.id);
    const counts = { ...current.counts };
    if (before && before.status !== entry.status) {
      counts[before.status]--;
      counts[entry.status]++;
    }
    this.data.set({
      counts,
      entries: current.entries.map((e) => (e.id === entry.id ? entry : e)),
    });
  }

  protected drop(id: string): void {
    const current = this.data();
    if (!current) {
      return;
    }
    const gone = current.entries.find((e) => e.id === id);
    const counts = { ...current.counts };
    if (gone) {
      counts[gone.status]--;
    }
    this.data.set({ counts, entries: current.entries.filter((e) => e.id !== id) });
    toast.success("Entry deleted");
  }

  protected toggle(id: string): void {
    this.selected.update((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  /** The form is gone: back to the button that opened it. */
  protected cancelPromote(): void {
    this.promoting.set(false);
    afterNextRender(() => document.getElementById("journal-promote")?.focus(), {
      injector: this.injector,
    });
  }

  protected lessonMade(lesson: Lesson): void {
    const view = this.lessons();
    if (view) {
      this.lessons.set({
        lessons: [lesson, ...view.lessons],
        counts: { ...view.counts, [lesson.status]: view.counts[lesson.status] + 1 },
      });
    }
    this.promoting.set(false);
    this.selected.set(new Set());
    // The form is gone: the admin lands on the new lesson.
    afterNextRender(() => document.getElementById(`lesson-${lesson.id}`)?.focus(), {
      injector: this.injector,
    });
  }

  protected replaceLesson(lesson: Lesson): void {
    const view = this.lessons();
    if (!view) {
      return;
    }
    const before = view.lessons.find((l) => l.id === lesson.id);
    const counts = { ...view.counts };
    if (before && before.status !== lesson.status) {
      counts[before.status]--;
      counts[lesson.status]++;
    }
    this.lessons.set({
      counts,
      lessons: view.lessons.map((l) => (l.id === lesson.id ? lesson : l)),
    });
  }

  protected dropLesson(id: string): void {
    const view = this.lessons();
    if (!view) {
      return;
    }
    const gone = view.lessons.find((l) => l.id === id);
    const counts = { ...view.counts };
    if (gone) {
      counts[gone.status]--;
    }
    this.lessons.set({ counts, lessons: view.lessons.filter((l) => l.id !== id) });
    toast.success("Lesson deleted");
  }
}
