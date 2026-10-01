import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  OnInit,
  signal,
} from "@angular/core";
import { toast } from "@spartan-ng/brain/sonner";
import { HlmButton } from "@spartan-ng/helm/button";

import { AdminApiService } from "../admin-api.service";
import { ConfirmService } from "../components/confirm-dialog.component";
import { sortCases, STALE_LABELS, type EvalCaseRow } from "../eval-cases";

/**
 * The production eval cases: visitor answers frozen with the corpus as it was
 * (plan phase 12). They run with `pnpm -C server ai:eval --suite production`.
 * Stale ones come first: a document they cite is gone or has changed since,
 * the quarterly review's list. A retired case stops running but keeps its
 * question and snapshot; deleting it removes the question, and the snapshot
 * is then pruned once nothing else refers to it.
 */
@Component({
  selector: "app-assistant-eval-cases",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [HlmButton],
  host: { class: "block" },
  template: `
    <section class="flex flex-col gap-2" aria-labelledby="eval-cases-title">
      <h2 id="eval-cases-title" class="m-0 text-sm font-medium">Production eval cases</h2>
      <p class="m-0 text-xs text-muted-foreground">
        Frozen from visitor answers, each with the corpus it was answered from; run them with
        <code>ai:eval --suite production</code>.
      </p>
      @if (cases().length) {
        <ul class="m-0 flex list-none flex-col gap-2 p-0" role="list">
          @for (row of cases(); track row.id) {
            <li
              class="flex flex-col gap-1 rounded-lg border border-border p-3 text-sm"
              [class.opacity-60]="row.status === 'retired'"
            >
              <p class="m-0">{{ row.question }}</p>
              <p class="m-0 font-mono text-xs text-muted-foreground">
                {{ row.locale.toUpperCase() }} · must cite
                {{ row.mustCite.length ? row.mustCite.join(", ") : "nothing" }}
                @if (row.mustInclude.length) {
                  · must include {{ row.mustInclude.join(", ") }}
                }
                · {{ row.status }}
              </p>
              @if (row.stale) {
                <p class="m-0 text-xs text-amber-700 dark:text-amber-400">
                  Stale: {{ staleLabels[row.stale] }}.
                </p>
              }
              <div class="flex gap-2">
                <button
                  hlmBtn
                  size="sm"
                  variant="ghost"
                  type="button"
                  [disabled]="busy()"
                  (click)="toggle(row)"
                >
                  {{ row.status === "active" ? "Retire" : "Reactivate" }}
                </button>
                <button
                  hlmBtn
                  size="sm"
                  variant="ghost"
                  type="button"
                  [disabled]="busy()"
                  (click)="remove(row)"
                >
                  Delete
                </button>
              </div>
            </li>
          }
        </ul>
      } @else {
        <p class="m-0 text-xs text-muted-foreground">
          None yet: freeze one from Conversations or Reviews.
        </p>
      }
    </section>
  `,
})
export class AssistantEvalCasesComponent implements OnInit {
  private readonly api = inject(AdminApiService);
  private readonly confirm = inject(ConfirmService);

  protected readonly staleLabels = STALE_LABELS;
  private readonly rows = signal<EvalCaseRow[]>([]);
  protected readonly busy = signal(false);
  protected readonly cases = computed(() => sortCases(this.rows()));

  ngOnInit(): void {
    void this.load();
  }

  private async load(): Promise<void> {
    const result = await this.api.evalCases();
    if (result.ok) this.rows.set(result.data.cases);
    else toast.error("Could not load the eval cases", { description: result.error });
  }

  protected async toggle(row: EvalCaseRow): Promise<void> {
    this.busy.set(true);
    const status = row.status === "active" ? "retired" : "active";
    const result = await this.api.setEvalCaseStatus(row.id, status);
    this.busy.set(false);
    if (!result.ok) {
      toast.error("Could not change the case", { description: result.error });
      return;
    }
    await this.load();
  }

  protected async remove(row: EvalCaseRow): Promise<void> {
    const go = await this.confirm.ask({
      title: "Delete this eval case?",
      description: "Its question is deleted for good; retire it instead to keep it.",
      confirmLabel: "Delete case",
      destructive: true,
    });
    if (!go) return;
    this.busy.set(true);
    const result = await this.api.deleteEvalCase(row.id);
    this.busy.set(false);
    if (!result.ok) {
      toast.error("Not deleted", { description: result.error });
      return;
    }
    await this.load();
  }
}
