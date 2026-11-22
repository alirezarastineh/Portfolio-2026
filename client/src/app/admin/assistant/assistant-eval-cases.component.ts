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
import { toast } from "@spartan-ng/brain/sonner";
import { HlmButton } from "@spartan-ng/helm/button";
import { HlmTableImports } from "@spartan-ng/helm/table";

import { AdminApiService } from "../admin-api.service";
import { apiWords } from "../api-words";
import { ConfirmService } from "../components/confirm-dialog.component";
import { LoadErrorComponent } from "../components/load-state.component";
import { sortCases, STALE_LABELS, type EvalCaseRow } from "../eval-cases";

/**
 * The production eval cases: visitor answers frozen with the corpus as it was
 * (plan phase 12), after the questions asked before them, listed first (visitor
 * plan V3). They run with `pnpm -C server ai:eval --suite production`.
 * Stale ones come first: a document they cite is gone or has changed since,
 * the quarterly review's list. A retired case stops running but keeps its
 * question and snapshot; deleting it removes the question, and the snapshot
 * is then pruned once nothing else refers to it. A table in words (plan 5, U22).
 */
@Component({
  selector: "app-assistant-eval-cases",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [HlmButton, HlmTableImports, LoadErrorComponent],
  host: { class: "block" },
  template: `
    <section class="flex flex-col gap-2" aria-labelledby="eval-cases-title">
      <h2 #heading id="eval-cases-title" tabindex="-1" class="m-0 text-section-title">
        Production eval cases
      </h2>
      <p class="m-0 max-w-prose text-hint text-muted-foreground">
        Frozen from visitor answers, each with the corpus it was answered from; run them with
        <code translate="no">ai:eval --suite production</code>.
      </p>
      <div hlmTableContainer>
        <table hlmTable>
          <caption class="sr-only">
            The production eval cases, the stale ones first
          </caption>
          <thead hlmTHead>
            <tr hlmTr>
              <th hlmTh scope="col">Question</th>
              <th hlmTh scope="col">Language</th>
              <th hlmTh scope="col">Must cite</th>
              <th hlmTh scope="col">Must include</th>
              <th hlmTh scope="col">Status</th>
              <th hlmTh scope="col"><span class="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody hlmTBody>
            @if (loadError(); as code) {
              <tr hlmTr>
                <td hlmTd colspan="6" class="whitespace-normal">
                  <app-load-error
                    compact
                    title="Could not load the eval cases"
                    [reason]="code"
                    [refocus]="heading"
                    (retry)="reload()"
                  />
                </td>
              </tr>
            } @else if (!loaded()) {
              <tr hlmTr>
                <td hlmTd colspan="6" class="text-muted-foreground">Loading the eval cases…</td>
              </tr>
            } @else {
              @for (row of cases(); track row.id) {
                <tr hlmTr class="align-top">
                  <th hlmTh scope="row" class="min-w-64 font-normal whitespace-normal">
                    @if (row.turns?.length) {
                      <ol
                        class="m-0 mb-1 flex flex-col gap-0.5 pl-5 text-xs text-muted-foreground"
                        aria-label="Asked before it"
                      >
                        @for (turn of row.turns; track $index) {
                          <li>{{ turn }}</li>
                        }
                      </ol>
                    }
                    {{ row.question }}
                  </th>
                  <td hlmTd>{{ language(row.locale) }}</td>
                  <td hlmTd class="font-data text-xs whitespace-normal" translate="no">
                    {{ row.mustCite.length ? row.mustCite.join(", ") : "nothing" }}
                  </td>
                  <td hlmTd class="font-data text-xs whitespace-normal" translate="no">
                    {{ row.mustInclude.length ? row.mustInclude.join(", ") : "nothing" }}
                  </td>
                  <td hlmTd class="min-w-40 whitespace-normal">
                    {{ row.status === "active" ? "Active" : "Retired" }}
                    @if (row.stale) {
                      <span class="block">Stale: {{ staleLabels[row.stale] }}.</span>
                    }
                  </td>
                  <td hlmTd class="text-right">
                    <button
                      hlmBtn
                      size="sm"
                      variant="ghost"
                      type="button"
                      [disabled]="busy()"
                      (click)="toggle(row)"
                    >
                      {{ row.status === "active" ? "Retire" : "Reactivate"
                      }}<span class="sr-only"> “{{ row.question }}”</span>
                    </button>
                    <button
                      hlmBtn
                      size="sm"
                      variant="ghost"
                      type="button"
                      [disabled]="busy()"
                      (click)="remove(row)"
                    >
                      Delete<span class="sr-only"> “{{ row.question }}”</span>
                    </button>
                  </td>
                </tr>
              } @empty {
                <tr hlmTr>
                  <td hlmTd colspan="6" class="text-muted-foreground">
                    None yet: freeze one from Conversations or Reviews.
                  </td>
                </tr>
              }
            }
          </tbody>
        </table>
      </div>
    </section>
  `,
})
export class AssistantEvalCasesComponent implements OnInit {
  private readonly api = inject(AdminApiService);
  private readonly confirm = inject(ConfirmService);
  private readonly injector = inject(Injector);
  private readonly heading = viewChild.required<ElementRef<HTMLElement>>("heading");
  private gone = false;

  protected readonly staleLabels = STALE_LABELS;
  private readonly rows = signal<EvalCaseRow[]>([]);
  /** The cases arrived at least once: until then the table says it is loading. */
  protected readonly loaded = signal(false);
  /** Why the cases did not arrive (the API's code): said in the table, never "None yet". */
  protected readonly loadError = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly cases = computed(() => sortCases(this.rows()));

  constructor() {
    inject(DestroyRef).onDestroy(() => (this.gone = true));
  }

  ngOnInit(): void {
    void this.load();
  }

  private async load(): Promise<void> {
    const result = await this.api.evalCases();
    if (result.ok) {
      this.rows.set(result.data.cases);
      this.loadError.set(null);
      this.loaded.set(true);
    } else if (this.loaded()) {
      toast.error("Could not load the eval cases", { description: apiWords(result.error) });
    } else {
      this.loadError.set(result.error);
    }
  }

  protected reload(): void {
    void this.load();
  }

  protected language(locale: string): string {
    return locale === "de" ? "German" : "English";
  }

  protected async toggle(row: EvalCaseRow): Promise<void> {
    this.busy.set(true);
    const status = row.status === "active" ? "retired" : "active";
    const result = await this.api.setEvalCaseStatus(row.id, status);
    this.busy.set(false);
    if (!result.ok) {
      toast.error("Could not change the case", { description: apiWords(result.error) });
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
    if (!go) {
      return;
    }
    this.busy.set(true);
    const result = await this.api.deleteEvalCase(row.id);
    this.busy.set(false);
    if (!result.ok) {
      toast.error("Not deleted", { description: apiWords(result.error) });
      return;
    }
    await this.load();
    // The row went with its buttons: the focus goes to the list's heading.
    if (!this.gone) {
      afterNextRender(() => this.heading().nativeElement.focus(), { injector: this.injector });
    }
  }
}
