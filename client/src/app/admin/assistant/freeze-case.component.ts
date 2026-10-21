import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from "@angular/core";
import { FormsModule } from "@angular/forms";
import { toast } from "@spartan-ng/brain/sonner";
import { HlmButton } from "@spartan-ng/helm/button";

import { AdminApiService } from "../admin-api.service";
import type { ConversationRow } from "../assistant-types";
import { freezeRequest } from "../eval-cases";

const REFUSALS: Record<string, string> = {
  no_snapshot:
    "This answer's corpus has no snapshot: it was answered before snapshots were kept, so it cannot be re-run as it was.",
  not_found: "This answer is gone (pruned after 90 days) or is not a visitor's.",
};

/**
 * "Freeze as eval case": a visitor's answer becomes a production eval case
 * that re-runs against the corpus as it was (plan phase 12). The case keeps
 * the redacted question, or the admin's rewrite of it, and up to three
 * questions asked before it in the session (visitor plan V3), rewritten the
 * same way; what it must cite starts as what the answer cited.
 */
@Component({
  selector: "app-freeze-case",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, HlmButton],
  host: { class: "block" },
  template: `
    @if (frozen()) {
      <p class="m-0 font-mono text-xs text-muted-foreground">frozen as an eval case</p>
    } @else if (!open()) {
      <button
        hlmBtn
        size="sm"
        variant="outline"
        type="button"
        [attr.aria-describedby]="describedBy()"
        (click)="openForm()"
      >
        Freeze as eval case
      </button>
    } @else {
      <form
        class="flex flex-col gap-2 rounded-md border border-border p-3 text-xs"
        action="/admin/assistant"
        (submit)="$event.preventDefault(); freeze()"
      >
        @if (earlier().length) {
          <div class="flex flex-col gap-1">
            <p [id]="'freeze-turns-hint-' + message().id" class="m-0 text-muted-foreground">
              Asked before it in the session, oldest first. A replay answers them first; empty one
              to leave it out.
            </p>
            @for (turn of earlier(); track $index) {
              <label class="flex flex-col gap-1">
                <span class="text-muted-foreground">Earlier question {{ $index + 1 }}</span>
                <textarea
                  [name]="'freeze-turn-' + $index"
                  rows="2"
                  maxlength="600"
                  class="rounded-md border border-border bg-background px-2 py-1 text-foreground"
                  [attr.aria-describedby]="'freeze-turns-hint-' + message().id"
                  [ngModel]="turn"
                  (ngModelChange)="setTurn($index, $event)"
                ></textarea>
              </label>
            }
          </div>
        }
        <div class="flex flex-col gap-1">
          <label class="flex flex-col gap-1">
            <span class="text-muted-foreground">Question</span>
            <textarea
              name="freeze-question"
              rows="2"
              maxlength="600"
              class="rounded-md border border-border bg-background px-2 py-1 text-foreground"
              [attr.aria-describedby]="'freeze-hint-' + message().id"
              [ngModel]="question()"
              (ngModelChange)="question.set($event)"
            ></textarea>
          </label>
          <p [id]="'freeze-hint-' + message().id" class="m-0 text-muted-foreground">
            Remove anything personal: the case is kept until you delete it.
          </p>
        </div>
        <label class="flex flex-col gap-1">
          <span class="text-muted-foreground">Must cite (ids, comma-separated)</span>
          <input
            name="freeze-must-cite"
            class="h-8 rounded-md border border-border bg-background px-2 font-mono text-foreground"
            [ngModel]="mustCite()"
            (ngModelChange)="mustCite.set($event)"
          />
        </label>
        <label class="flex flex-col gap-1">
          <span class="text-muted-foreground">Must include (patterns, comma-separated)</span>
          <input
            name="freeze-must-include"
            class="h-8 rounded-md border border-border bg-background px-2 font-mono text-foreground"
            [ngModel]="mustInclude()"
            (ngModelChange)="mustInclude.set($event)"
          />
        </label>
        <label class="flex items-center gap-2">
          <input
            type="checkbox"
            name="freeze-personal-checked"
            [ngModel]="personalChecked()"
            (ngModelChange)="personalChecked.set($event)"
          />
          <span>Nothing personal is left in the {{ keepsTurns() ? "questions" : "question" }}</span>
        </label>
        <div class="flex gap-2">
          <button
            hlmBtn
            size="sm"
            type="submit"
            [attr.aria-describedby]="describedBy()"
            [disabled]="saving() || loadingEarlier() || !personalChecked()"
          >
            Freeze
          </button>
          <button
            hlmBtn
            size="sm"
            variant="ghost"
            type="button"
            [attr.aria-describedby]="describedBy()"
            (click)="open.set(false)"
          >
            Cancel
          </button>
        </div>
      </form>
    }
  `,
})
export class FreezeCaseComponent {
  private readonly api = inject(AdminApiService);

  readonly message = input.required<Pick<ConversationRow, "id" | "question" | "citedIds">>();
  /** The new case's id, once frozen (the failure journal links it as a regression case). */
  readonly caseFrozen = output<string>();
  /** The id of what the buttons act on (a list repeats them), for their description. */
  readonly describedBy = input<string | null>(null);
  /** The answer by id: the same answer read again (a list reloaded) keeps the form as it is. */
  private readonly messageId = computed(() => this.message().id);

  protected readonly open = signal(false);
  protected readonly saving = signal(false);
  protected readonly frozen = signal(false);
  protected readonly question = signal("");
  protected readonly mustCite = signal("");
  protected readonly mustInclude = signal("");
  /** The admin's word that nothing personal is left: Freeze waits for it. */
  protected readonly personalChecked = signal(false);
  /** The session's questions before this answer, as the admin edits them. */
  protected readonly earlier = signal<string[]>([]);
  /** Freeze waits for them, or the case would leave them out unseen. */
  protected readonly loadingEarlier = signal(false);
  protected readonly keepsTurns = computed(() => this.earlier().some((turn) => turn.trim()));
  /** The answer whose earlier questions were loaded: reopening the form keeps the edits. */
  private earlierOf: string | null = null;

  constructor() {
    // Another answer (the Reviews pane keeps this one): start over, with its citations.
    effect(() => {
      this.messageId();
      untracked(() => {
        const message = this.message();
        this.open.set(false);
        this.frozen.set(false);
        this.question.set(message.question);
        this.mustCite.set(message.citedIds.join(", "));
        this.mustInclude.set("");
        this.personalChecked.set(false);
        this.earlier.set([]);
        this.loadingEarlier.set(false);
        this.earlierOf = null;
      });
    });
  }

  protected openForm(): void {
    this.open.set(true);
    void this.loadEarlier();
  }

  /** What was asked before it: none when the API cannot say (an older API, a pruned answer). */
  private async loadEarlier(): Promise<void> {
    const id = this.message().id;
    if (this.earlierOf === id) return;
    this.earlierOf = id;
    this.loadingEarlier.set(true);
    const result = await this.api.earlierQuestions(id);
    // Another answer came meanwhile, and started over.
    if (this.earlierOf !== id) return;
    this.earlier.set(result.ok ? result.data.questions : []);
    this.loadingEarlier.set(false);
  }

  protected setTurn(index: number, text: string): void {
    this.earlier.update((turns) => turns.map((turn, i) => (i === index ? text : turn)));
  }

  protected async freeze(): Promise<void> {
    const request = freezeRequest(this.message().question, {
      question: this.question(),
      turns: this.earlier(),
      mustCite: this.mustCite(),
      mustInclude: this.mustInclude(),
      personalChecked: this.personalChecked(),
    });
    if (!request.ok) {
      toast.error(request.error);
      return;
    }
    this.saving.set(true);
    const result = await this.api.freezeEvalCase(this.message().id, request.body);
    this.saving.set(false);
    if (!result.ok) {
      toast.error("Could not freeze the answer", {
        description: REFUSALS[result.error] ?? result.error,
      });
      return;
    }
    this.frozen.set(true);
    this.caseFrozen.emit(result.data.id);
    toast.success("Frozen as an eval case", {
      description: "It re-runs against this answer's corpus with `--suite production`.",
    });
  }
}
