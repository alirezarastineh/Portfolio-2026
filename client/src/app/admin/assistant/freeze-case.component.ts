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
 * the redacted question, or the admin's rewrite of it; what it must cite
 * starts as what the answer cited.
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
        (click)="open.set(true)"
      >
        Freeze as eval case
      </button>
    } @else {
      <form
        class="flex flex-col gap-2 rounded-md border border-border p-3 text-xs"
        action="/admin/assistant"
        (submit)="$event.preventDefault(); freeze()"
      >
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
          <span>Nothing personal is left in the question</span>
        </label>
        <div class="flex gap-2">
          <button
            hlmBtn
            size="sm"
            type="submit"
            [attr.aria-describedby]="describedBy()"
            [disabled]="saving() || !personalChecked()"
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
      });
    });
  }

  protected async freeze(): Promise<void> {
    const request = freezeRequest(this.message().question, {
      question: this.question(),
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
