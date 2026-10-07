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
  input,
  output,
  PLATFORM_ID,
  signal,
  untracked,
  viewChild,
  type WritableSignal,
} from "@angular/core";
import { FormsModule } from "@angular/forms";
import { toast } from "@spartan-ng/brain/sonner";
import { HlmBadge } from "@spartan-ng/helm/badge";
import { HlmButton } from "@spartan-ng/helm/button";

import { AdminApiService } from "../admin-api.service";
import type { RunRow } from "../assistant-types";
import { ConfirmService } from "../components/confirm-dialog.component";
import { isActive } from "../eval-runs";
import {
  decisionProblem,
  FIX_TYPES,
  HYPOTHESES,
  hypothesisName,
  leadingLine,
  locatedLine,
  NEXT,
  ratioLine,
  refusal,
  replayLines,
  statusLabel,
  symptomLabel,
  type FixType,
  type JournalEntry,
  type JournalPatch,
  type JournalStatus,
} from "../journal";
import { FreezeCaseComponent } from "./freeze-case.component";

const POLL_MS = 2_000;

/** The fields the admin edits, as the server last had them. */
interface Fields {
  rootCause: string;
  fixType: FixType | null;
  fix: string;
  fixRef: string;
  heuristic: string;
  /** The document named as holding the answer. */
  expected: string;
}

/** The button that moves an entry to each status. */
const DECISIONS: Record<JournalStatus, string> = {
  accepted: "Accept",
  fixed: "Mark fixed",
  retired: "Retire",
  proposed: "Reopen",
};

/**
 * One failure journal entry (plan phase 24): the hypotheses with the evidence
 * for and against each, where the fact sat, what was not tested and what
 * would separate the leaders; the admin's root cause, fix and heuristic; the
 * decisions; a regression case frozen from the answer; and the paid replay.
 */
@Component({
  selector: "app-journal-entry",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, FreezeCaseComponent, HlmBadge, HlmButton],
  host: { class: "block" },
  template: `
    @let e = entry();
    @let d = e.diagnosis;
    <article
      class="flex flex-col gap-3 rounded-lg border border-border p-4 text-sm"
      [attr.aria-labelledby]="'journal-' + e.id"
    >
      <header class="flex flex-wrap items-baseline justify-between gap-2">
        <!-- Focus lands here after a decision, whose button is gone by then. -->
        <h3 #heading tabindex="-1" [id]="'journal-' + e.id" class="m-0 text-sm font-medium">
          {{ symptom(e.category) }}: {{ leading() }}
        </h3>
        <div class="flex items-center gap-2 font-mono text-xs text-muted-foreground">
          <span hlmBadge [variant]="e.status === 'proposed' ? 'outline' : 'default'">{{
            statusLabel(e.status)
          }}</span>
          <span>{{ when(e.createdAt) }}</span>
        </div>
      </header>
      <p class="m-0 text-muted-foreground">
        @if (e.message) {
          “{{ e.message.question }}” · {{ e.message.id }}
        } @else {
          The answer was pruned (after 90 days); the diagnosis stays.
        }
      </p>

      <details class="rounded-md border border-border px-3 py-2" [open]="open()">
        <summary class="cursor-pointer font-mono text-xs text-muted-foreground">
          Evidence · {{ d.hypotheses.length }} hypotheses (a count, not a probability)
        </summary>
        <ol class="m-0 mt-2 flex list-none flex-col gap-2 p-0 text-xs" role="list">
          @for (h of d.hypotheses; track h.id) {
            <li class="flex flex-col gap-1">
              <p class="m-0">
                <span class="font-medium">{{ name(h.id) }}</span>
                <span class="text-muted-foreground"> · {{ ratio(h) }} · {{ hint(h.id) }}</span>
              </p>
              @if (h.evidence.length) {
                <ul class="m-0 flex list-none flex-col gap-0.5 pl-4" role="list">
                  @for (item of h.evidence; track $index) {
                    <li [class]="item.supports ? 'text-foreground' : 'text-muted-foreground'">
                      <span aria-hidden="true">{{ item.supports ? "+" : "−" }} </span>
                      <span class="sr-only">{{ item.supports ? "For: " : "Against: " }}</span>
                      {{ item.observation }}
                    </li>
                  }
                </ul>
              }
            </li>
          }
        </ol>
        @if (d.located) {
          <p class="m-0 mt-2 text-xs">Where the fact sat: {{ located() }}</p>
        }
        @if (d.addedSince) {
          <p class="m-0 mt-1 text-xs">Added since the answer: {{ d.addedSince }}</p>
        }
        @if (d.untested.length) {
          <p class="m-0 mt-2 text-xs font-medium">Not tested</p>
          <ul class="m-0 list-disc pl-5 text-xs text-muted-foreground">
            @for (line of d.untested; track $index) {
              <li>{{ line }}</li>
            }
          </ul>
        }
        @if (d.next.length) {
          <p class="m-0 mt-2 text-xs font-medium">What would tell them apart</p>
          <ul class="m-0 list-disc pl-5 text-xs text-muted-foreground">
            @for (line of d.next; track $index) {
              <li>{{ line }}</li>
            }
          </ul>
        }
      </details>

      <!-- The admin is the oracle a word search is not: where the answer is, by its id. -->
      @if (e.status === "proposed" && e.message) {
        <form
          class="flex flex-wrap items-end gap-2 text-xs"
          action="/admin/assistant"
          (submit)="$event.preventDefault(); rediagnose()"
        >
          <div class="flex min-w-48 flex-1 flex-col gap-1">
            <label class="flex flex-col gap-1">
              <span class="text-muted-foreground">Document that holds the answer</span>
              <input
                name="journal-expected"
                maxlength="160"
                class="h-8 rounded-md border border-border bg-background px-2 font-mono text-foreground"
                [attr.aria-describedby]="'journal-expected-hint-' + e.id"
                [ngModel]="expected()"
                (ngModelChange)="expected.set($event)"
              />
            </label>
            <p [id]="'journal-expected-hint-' + e.id" class="m-0 text-muted-foreground">
              Its id, such as project:atlas: the diagnosis then places the fact there rather than
              searching for the question's words.
            </p>
          </div>
          <button
            hlmBtn
            size="sm"
            variant="outline"
            type="submit"
            [attr.aria-describedby]="'journal-' + e.id"
            [disabled]="saving()"
          >
            Diagnose again
          </button>
          @if (d.located?.named) {
            <button
              hlmBtn
              size="sm"
              variant="ghost"
              type="button"
              [attr.aria-describedby]="'journal-' + e.id"
              [disabled]="saving()"
              (click)="rediagnose(null)"
            >
              Forget the named document
            </button>
          }
        </form>
      }

      @if (e.replay) {
        <div class="text-xs">
          <p class="m-0 font-medium">Replayed {{ when(e.replay.at) }}</p>
          <ul class="m-0 list-disc pl-5 text-muted-foreground">
            @for (line of replay(); track $index) {
              <li>{{ line }}</li>
            }
          </ul>
        </div>
      }

      <form
        class="flex flex-col gap-2 text-xs"
        action="/admin/assistant"
        (submit)="$event.preventDefault(); save()"
      >
        <p [id]="'journal-hint-' + e.id" class="m-0 text-muted-foreground">
          No visitor text here: the journal is kept until you delete it.
        </p>
        <label class="flex flex-col gap-1">
          <span class="text-muted-foreground">Root cause</span>
          <textarea
            name="journal-root-cause"
            rows="3"
            maxlength="2000"
            class="rounded-md border border-border bg-background px-2 py-1 text-foreground"
            [attr.aria-describedby]="'journal-hint-' + e.id"
            [ngModel]="rootCause()"
            (ngModelChange)="rootCause.set($event)"
          ></textarea>
        </label>
        <div class="flex flex-wrap gap-2">
          <label class="flex flex-col gap-1">
            <span class="text-muted-foreground">Fix type</span>
            <select
              name="journal-fix-type"
              class="h-8 rounded-md border border-border bg-background px-2 text-foreground"
              [ngModel]="fixType() ?? ''"
              (ngModelChange)="fixType.set($event || null)"
            >
              <option value="">None yet</option>
              @for (type of fixTypes; track type.id) {
                <option [value]="type.id">{{ type.label }}</option>
              }
            </select>
          </label>
          <div class="flex min-w-48 flex-1 flex-col gap-1">
            <label class="flex flex-col gap-1">
              <span class="text-muted-foreground">Fix reference</span>
              <input
                name="journal-fix-ref"
                maxlength="200"
                class="h-8 rounded-md border border-border bg-background px-2 font-mono text-foreground"
                [attr.aria-describedby]="'journal-ref-hint-' + e.id + ' journal-hint-' + e.id"
                [ngModel]="fixRef()"
                (ngModelChange)="fixRef.set($event)"
              />
            </label>
            <p [id]="'journal-ref-hint-' + e.id" class="m-0 text-muted-foreground">
              An FAQ entry's id, a prompt version, a document's id.
            </p>
          </div>
        </div>
        <label class="flex flex-col gap-1">
          <span class="text-muted-foreground">Fix</span>
          <textarea
            name="journal-fix"
            rows="2"
            maxlength="2000"
            class="rounded-md border border-border bg-background px-2 py-1 text-foreground"
            [attr.aria-describedby]="'journal-hint-' + e.id"
            [ngModel]="fix()"
            (ngModelChange)="fix.set($event)"
          ></textarea>
        </label>
        <label class="flex flex-col gap-1">
          <span class="text-muted-foreground">Heuristic</span>
          <textarea
            name="journal-heuristic"
            rows="2"
            maxlength="1000"
            class="rounded-md border border-border bg-background px-2 py-1 text-foreground"
            [attr.aria-describedby]="'journal-heuristic-hint-' + e.id + ' journal-hint-' + e.id"
            [ngModel]="heuristic()"
            (ngModelChange)="heuristic.set($event)"
          ></textarea>
        </label>
        <p [id]="'journal-heuristic-hint-' + e.id" class="m-0 text-muted-foreground">
          When it applies, and why: a lesson that transfers, never "be careful".
        </p>
        <!-- Each entry repeats these buttons: its heading says which entry they act on. -->
        <div class="flex flex-wrap gap-2">
          <button
            hlmBtn
            size="sm"
            variant="outline"
            type="submit"
            [attr.aria-describedby]="'journal-' + e.id"
            [disabled]="saving()"
          >
            Save
          </button>
          @for (status of next(); track status) {
            <button
              hlmBtn
              size="sm"
              type="button"
              [variant]="status === 'retired' ? 'ghost' : 'default'"
              [attr.aria-describedby]="'journal-' + e.id"
              [disabled]="saving()"
              (click)="decide(status)"
            >
              {{ decisionLabel(status) }}
            </button>
          }
        </div>
      </form>

      <div class="flex flex-wrap items-center gap-2 text-xs">
        @if (e.caseId) {
          <p class="m-0 font-mono text-muted-foreground">regression case {{ e.caseId }}</p>
        } @else if (e.message && e.status !== "retired") {
          <app-freeze-case
            [message]="e.message"
            [describedBy]="'journal-' + e.id"
            (caseFrozen)="linkCase($event)"
          />
        }
        @if (replayable()) {
          <!-- A replay that stopped is resumed: only the chains left answer (and spend). -->
          @if (resumable(); as run) {
            <button
              hlmBtn
              size="sm"
              variant="outline"
              type="button"
              [attr.aria-describedby]="'journal-' + e.id + ' journal-stopped-' + e.id"
              [disabled]="replaying()"
              (click)="resume(run.id)"
            >
              {{ replaying() ? "Replaying…" : "Resume the replay (paid)" }}
            </button>
          } @else {
            <button
              hlmBtn
              size="sm"
              variant="outline"
              type="button"
              [attr.aria-describedby]="'journal-' + e.id"
              [disabled]="replaying()"
              (click)="replayIt()"
            >
              {{ replaying() ? "Replaying…" : "Replay on both chains (paid)" }}
            </button>
          }
        }
        <button
          hlmBtn
          size="sm"
          variant="ghost"
          type="button"
          [attr.aria-describedby]="'journal-' + e.id"
          (click)="remove()"
        >
          Delete
        </button>
      </div>
      @if (replayable() && resumable(); as run) {
        <p [id]="'journal-stopped-' + e.id" class="m-0 text-xs text-muted-foreground">
          The last replay stopped: {{ run.error ?? run.status }}
        </p>
      }
      <!-- Always in the page, so what is put in it is announced. -->
      <p class="m-0 text-xs text-muted-foreground" role="status">{{ status() }}</p>
    </article>
  `,
})
export class JournalEntryComponent {
  private readonly api = inject(AdminApiService);
  private readonly confirm = inject(ConfirmService);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  readonly entry = input.required<JournalEntry>();
  /** Shows the evidence open (the entry the admin came to see). */
  readonly open = input(false);
  /** Its last replay, when it stopped short (a provider down, a fence): resumable. */
  readonly resumable = input<RunRow | null>(null);
  readonly changed = output<JournalEntry>();
  readonly deleted = output<string>();
  /** A replay ended: the list reads the entry again. */
  readonly replayed = output<void>();

  protected readonly fixTypes = FIX_TYPES;
  protected readonly statusLabel = statusLabel;
  protected readonly symptom = symptomLabel;
  protected readonly ratio = ratioLine;
  protected readonly name = hypothesisName;

  protected readonly rootCause = signal("");
  protected readonly fixType = signal<FixType | null>(null);
  protected readonly fix = signal("");
  protected readonly fixRef = signal("");
  protected readonly heuristic = signal("");
  /** The document the admin names as holding the answer. */
  protected readonly expected = signal("");
  protected readonly saving = signal(false);
  protected readonly replaying = signal(false);
  /** What the live region says: the last save, decision or replay. */
  protected readonly status = signal("");
  /** The server's values the fields last took, to tell an unsaved edit from a stale value. */
  private seen: Fields | null = null;
  private readonly heading = viewChild<ElementRef<HTMLElement>>("heading");
  private readonly injector = inject(Injector);
  private timer?: ReturnType<typeof setTimeout>;

  protected readonly leading = computed(() => leadingLine(this.entry().diagnosis));
  protected readonly located = computed(() => {
    const located = this.entry().diagnosis.located;
    return located ? locatedLine(located) : "";
  });
  protected readonly replay = computed(() => replayLines(this.entry().replay?.results ?? []));
  protected readonly next = computed(() => NEXT[this.entry().status]);
  protected readonly replayable = computed(() => {
    const e = this.entry();
    return !!e.message && (e.status === "proposed" || e.status === "accepted");
  });

  constructor() {
    inject(DestroyRef).onDestroy(() => clearTimeout(this.timer));
    // The entry as the server has it (a save, a new analysis, the list read again): a field
    // follows it unless the admin has typed in it since, so nothing unsaved is lost.
    effect(() => {
      const e = this.entry();
      untracked(() => {
        const located = e.diagnosis.located;
        const server: Fields = {
          rootCause: e.rootCause,
          fixType: e.fixType,
          fix: e.fix,
          fixRef: e.fixRef ?? "",
          heuristic: e.heuristic,
          expected: located?.named ? located.id : "",
        };
        const seen = this.seen;
        const follow = <K extends keyof Fields>(key: K, field: WritableSignal<Fields[K]>) => {
          if (!seen || field() === seen[key]) field.set(server[key]);
        };
        follow("rootCause", this.rootCause);
        follow("fixType", this.fixType);
        follow("fix", this.fix);
        follow("fixRef", this.fixRef);
        follow("heuristic", this.heuristic);
        follow("expected", this.expected);
        this.seen = server;
      });
    });
  }

  protected hint(id: keyof typeof HYPOTHESES): string {
    return HYPOTHESES[id].hint;
  }

  protected decisionLabel(status: JournalStatus): string {
    return DECISIONS[status];
  }

  protected when(iso: string): string {
    return new Date(iso).toLocaleString();
  }

  private fields(): JournalPatch {
    return {
      rootCause: this.rootCause(),
      fixType: this.fixType(),
      fix: this.fix(),
      fixRef: this.fixRef().trim() || null,
      heuristic: this.heuristic(),
    };
  }

  protected save(): Promise<void> {
    return this.send(this.fields(), "Saved");
  }

  protected decide(status: JournalStatus): Promise<void> {
    const patch = { ...this.fields(), status };
    const problem = decisionProblem(status, {
      rootCause: patch.rootCause ?? "",
      heuristic: patch.heuristic ?? "",
      fixType: patch.fixType ?? null,
      fixRef: patch.fixRef ?? null,
      caseId: this.entry().caseId,
    });
    if (problem) {
      toast.error(problem);
      return Promise.resolve();
    }
    return this.send(patch, `${DECISIONS[status]}: done`);
  }

  protected linkCase(caseId: string): Promise<void> {
    return this.send({ caseId }, "Linked as the regression case");
  }

  /** Diagnose again with the document the admin names, or none (forgotten). */
  protected async rediagnose(
    expected: string | null = this.expected().trim() || null,
  ): Promise<void> {
    const message = this.entry().message;
    if (!message) return;
    this.saving.set(true);
    const result = await this.api.diagnoseAnswer(message.id, expected);
    this.saving.set(false);
    if (!result.ok) {
      toast.error("Could not diagnose again", { description: refusal(result.error) });
      return;
    }
    const done = expected ? `Diagnosed again, with ${expected} named` : "Diagnosed again";
    toast.success(done);
    this.status.set(done);
    this.changed.emit(result.data.entry);
  }

  /** A replay that stopped, resumed: only the chains that did not answer are asked. Paid. */
  protected async resume(runId: string): Promise<void> {
    const go = await this.confirm.ask({
      title: "Resume the replay (paid)?",
      description:
        "Only the chains that did not answer are asked again, on today's corpus. It spends as Admin agents (Settings → Spending).",
      confirmLabel: "Resume",
    });
    if (!go) return;
    this.replaying.set(true);
    this.status.set("Answering the question again on the chains left…");
    const resumed = await this.api.resumeRun(runId);
    if (!resumed.ok) {
      this.replaying.set(false);
      this.status.set("");
      toast.error("The replay did not resume", { description: refusal(resumed.error) });
      return;
    }
    this.follow(resumed.data.id);
  }

  private async send(patch: JournalPatch, done: string): Promise<void> {
    this.saving.set(true);
    const result = await this.api.updateJournalEntry(this.entry().id, patch);
    this.saving.set(false);
    if (!result.ok) {
      toast.error("Could not save the entry", { description: refusal(result.error) });
      return;
    }
    toast.success(done);
    this.status.set(done);
    const moved = patch.status !== undefined && patch.status !== this.entry().status;
    this.changed.emit(result.data.entry);
    // The decision's button is gone once the entry re-renders: keep focus in the entry.
    if (moved) {
      afterNextRender(() => this.heading()?.nativeElement.focus(), { injector: this.injector });
    }
  }

  protected async remove(): Promise<void> {
    const go = await this.confirm.ask({
      title: "Delete this entry?",
      description:
        "Its diagnosis and your decisions go for good; the answer itself is not touched.",
      confirmLabel: "Delete entry",
      destructive: true,
    });
    if (!go) return;
    const result = await this.api.deleteJournalEntry(this.entry().id);
    if (!result.ok) {
      toast.error("Could not delete the entry", { description: refusal(result.error) });
      return;
    }
    this.deleted.emit(this.entry().id);
  }

  /** A paid background run: the question answered again on both chains. */
  protected async replayIt(): Promise<void> {
    const go = await this.confirm.ask({
      title: "Replay this question (paid)?",
      description:
        "It is answered again on today's corpus by the lite and the deep chain: two answers, about $0.002–0.005 at paid prices, nothing on the free tier. It spends as Admin agents (Settings → Spending).",
      confirmLabel: "Replay",
    });
    if (!go) return;
    this.replaying.set(true);
    this.status.set("Answering the question again on the lite and the deep chain…");
    const started = await this.api.startReplayRun(this.entry().id);
    if (!started.ok) {
      this.replaying.set(false);
      this.status.set("");
      toast.error("The replay did not start", { description: refusal(started.error) });
      return;
    }
    this.follow(started.data.id);
  }

  /** Until the replay run ends; then the entry is read again with its evidence. */
  private follow(id: string): void {
    if (!this.isBrowser) return;
    this.timer = setTimeout(async () => {
      const result = await this.api.getRun(id);
      if (result.ok && isActive(result.data.run)) return this.follow(id);
      this.replaying.set(false);
      const error = result.ok ? result.data.run.error : result.error;
      if (error) toast.error("The replay stopped", { description: error });
      this.status.set(
        error ? `The replay stopped: ${error}` : "Replay finished: its evidence is in.",
      );
      this.replayed.emit();
    }, POLL_MS);
  }
}
