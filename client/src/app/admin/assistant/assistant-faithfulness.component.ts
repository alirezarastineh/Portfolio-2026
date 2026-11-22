import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  OnInit,
  signal,
} from "@angular/core";
import { toast } from "@spartan-ng/brain/sonner";
import { HlmTableImports } from "@spartan-ng/helm/table";

import { AdminApiService } from "../admin-api.service";
import { apiWords } from "../api-words";
import { LoadErrorComponent } from "../components/load-state.component";
import {
  faithfulLine,
  helpfulLine,
  judgesLine,
  nightlyLine,
  routeLabel,
  type FaithfulnessRow,
  type FaithfulnessView,
} from "../faithfulness";
import { WINDOWS } from "../perception";

const byModel = (key: string): string => key;

/**
 * Overview → Faithfulness (plan phase 26): what the judge found on visitors'
 * answers, per model and per route, over a window. The nightly judge's random
 * sample is the fair view and the one the trust monitor demotes on; "all
 * judged" adds the flagged and reviewed answers, which lean toward bad ones.
 * Under it, what the last night did. A report in words (plan 5, U22).
 */
@Component({
  selector: "app-assistant-faithfulness",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [HlmTableImports, LoadErrorComponent],
  host: { class: "block" },
  template: `
    <section class="flex flex-col gap-3" aria-labelledby="assistant-faithfulness">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <h2 #heading id="assistant-faithfulness" tabindex="-1" class="m-0 text-section-title">
          Faithfulness
        </h2>
        <label class="flex items-center gap-2 text-xs text-muted-foreground">
          Window
          <select
            name="faithfulness-window"
            aria-label="Faithfulness window"
            class="h-9 pointer-coarse:h-11 rounded-lg border border-input-line bg-card px-2 text-sm pointer-coarse:text-base text-foreground"
            [value]="days()"
            (change)="choose(+$any($event.target).value)"
          >
            @for (w of windows; track w) {
              <option [value]="w">{{ w }} days</option>
            }
          </select>
        </label>
      </div>
      @if (view(); as v) {
        <p class="m-0 max-w-prose text-hint text-muted-foreground">
          The share of each answer's claims its cited documents support (faithful at 0.8) over the
          last {{ v.days }} days, {{ judges(v) }}. The random sample is the fair view; all judged
          adds the flagged and reviewed answers, which lean toward bad ones.
        </p>
        @for (table of tables(); track table.caption) {
          <div hlmTableContainer>
            <table hlmTable>
              <caption class="sr-only">
                {{
                  table.caption
                }}
              </caption>
              <thead hlmTHead>
                <tr hlmTr>
                  <th hlmTh scope="col">{{ table.head }}</th>
                  <th hlmTh scope="col" class="text-right">Random sample</th>
                  <th hlmTh scope="col" class="text-right">All judged</th>
                  <th hlmTh scope="col" class="text-right">Helpfulness, sample</th>
                  <th hlmTh scope="col" class="text-right">Helpfulness, all</th>
                </tr>
              </thead>
              <tbody hlmTBody>
                @for (r of table.rows; track r.key) {
                  <tr hlmTr class="font-data text-xs">
                    <th hlmTh scope="row" class="font-sans text-sm font-normal">
                      {{ table.label(r.key) }}
                    </th>
                    <td hlmTd class="text-right">{{ faithful(r.sampled) }}</td>
                    <td hlmTd class="text-right">{{ faithful(r.all) }}</td>
                    <td hlmTd class="text-right">{{ helpful(r.sampled) }}</td>
                    <td hlmTd class="text-right">{{ helpful(r.all) }}</td>
                  </tr>
                } @empty {
                  <tr hlmTr>
                    <td hlmTd colspan="5" class="text-muted-foreground">
                      No answer judged in the last {{ v.days }} days.
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }
        <p class="m-0 max-w-prose text-hint text-muted-foreground">{{ nightly(v.nightly) }}</p>
      } @else if (loadError(); as code) {
        <app-load-error
          compact
          title="Could not load the faithfulness figures"
          [reason]="code"
          [refocus]="heading"
          (retry)="reload()"
        />
      } @else {
        <p class="m-0 text-hint text-muted-foreground">Loading the faithfulness figures…</p>
      }
    </section>
  `,
})
export class AssistantFaithfulnessComponent implements OnInit {
  private readonly api = inject(AdminApiService);

  protected readonly view = signal<FaithfulnessView | null>(null);
  /** Why the figures did not arrive (the API's code): said in their place, with Try again. */
  protected readonly loadError = signal<string | null>(null);
  protected readonly days = signal(30);

  protected readonly windows = WINDOWS;
  protected readonly faithful = faithfulLine;
  protected readonly helpful = helpfulLine;
  protected readonly nightly = nightlyLine;
  protected readonly judges = judgesLine;

  /** Two tables: by model, by route. */
  protected readonly tables = computed(() => {
    const v = this.view();
    if (!v) {
      return [];
    }
    return [
      { caption: "Judged faithfulness by model", head: "Model", rows: v.byModel, label: byModel },
      {
        caption: "Judged faithfulness by route",
        head: "Route",
        rows: v.byRoute,
        label: routeLabel,
      },
    ] satisfies {
      caption: string;
      head: string;
      rows: FaithfulnessRow[];
      label: (key: string) => string;
    }[];
  });

  ngOnInit(): void {
    void this.load();
  }

  protected choose(days: number): void {
    this.days.set(days);
    void this.load();
  }

  protected reload(): void {
    void this.load();
  }

  /** The latest load: an earlier, slower one must not overwrite it. */
  private loading = 0;

  private async load(): Promise<void> {
    const mine = ++this.loading;
    const result = await this.api.assistantFaithfulness(this.days());
    if (mine !== this.loading) {
      return;
    }
    if (result.ok) {
      this.view.set(result.data);
      this.loadError.set(null);
    } else if (this.view()) {
      // Figures on screen stay; the window that did not load says so.
      toast.error("Could not load the faithfulness figures", {
        description: apiWords(result.error),
      });
    } else {
      this.loadError.set(result.error);
    }
  }
}
