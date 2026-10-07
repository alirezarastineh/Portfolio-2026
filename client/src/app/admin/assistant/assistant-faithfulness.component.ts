import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  OnInit,
  signal,
} from "@angular/core";
import { toast } from "@spartan-ng/brain/sonner";

import { AdminApiService } from "../admin-api.service";
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

/**
 * Overview → Faithfulness (plan phase 26): what the judge found on visitors'
 * answers, per model and per route, over a window. The nightly judge's random
 * sample is the fair view and the one the trust monitor demotes on; "all
 * judged" adds the flagged and reviewed answers, which lean toward bad ones.
 * Under it, what the last night did.
 */
@Component({
  selector: "app-assistant-faithfulness",
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: "block" },
  template: `
    <section class="flex flex-col gap-3" aria-labelledby="assistant-faithfulness">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <h2 id="assistant-faithfulness" class="m-0 text-sm font-medium">Faithfulness</h2>
        <label class="flex items-center gap-2 text-xs text-muted-foreground">
          Window
          <select
            name="faithfulness-window"
            aria-label="Faithfulness window"
            class="h-8 rounded-md border border-border bg-background px-2 text-sm text-foreground"
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
        <p class="m-0 text-xs text-muted-foreground">
          The share of each answer's claims its cited documents support (faithful at 0.8) over the
          last {{ v.days }} days, {{ judges(v) }}. The random sample is the fair view; all judged
          adds the flagged and reviewed answers, which lean toward bad ones.
        </p>
        @for (table of tables(); track table.caption) {
          <div class="overflow-x-auto rounded-lg border border-border">
            <table class="w-full text-sm">
              <caption class="sr-only">
                {{
                  table.caption
                }}
              </caption>
              <thead class="text-left text-xs text-muted-foreground">
                <tr>
                  <th class="p-2 font-normal">{{ table.head }}</th>
                  <th class="p-2 text-right font-normal">Random sample</th>
                  <th class="p-2 text-right font-normal">All judged</th>
                  <th class="p-2 text-right font-normal">Helpfulness, sample</th>
                  <th class="p-2 text-right font-normal">Helpfulness, all</th>
                </tr>
              </thead>
              <tbody>
                @for (r of table.rows; track r.key) {
                  <tr class="border-t border-border font-mono text-xs">
                    <th scope="row" class="p-2 text-left font-sans text-sm font-normal">
                      {{ table.label(r.key) }}
                    </th>
                    <td class="p-2 text-right">{{ faithful(r.sampled) }}</td>
                    <td class="p-2 text-right">{{ faithful(r.all) }}</td>
                    <td class="p-2 text-right">{{ helpful(r.sampled) }}</td>
                    <td class="p-2 text-right">{{ helpful(r.all) }}</td>
                  </tr>
                } @empty {
                  <tr>
                    <td class="p-2 text-muted-foreground" colspan="5">No answer judged yet.</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }
        <p class="m-0 text-xs text-muted-foreground">{{ nightly(v.nightly) }}</p>
      } @else if (failed()) {
        <p class="m-0 text-xs text-destructive">Could not load the faithfulness figures.</p>
      } @else {
        <p class="m-0 text-xs text-muted-foreground">Loading…</p>
      }
    </section>
  `,
})
export class AssistantFaithfulnessComponent implements OnInit {
  private readonly api = inject(AdminApiService);

  protected readonly view = signal<FaithfulnessView | null>(null);
  protected readonly failed = signal(false);
  protected readonly days = signal(30);

  protected readonly windows = WINDOWS;
  protected readonly faithful = faithfulLine;
  protected readonly helpful = helpfulLine;
  protected readonly nightly = nightlyLine;
  protected readonly judges = judgesLine;

  /** Two tables: by model, by route. */
  protected readonly tables = computed(() => {
    const v = this.view();
    if (!v) return [];
    const byModel = (key: string) => key;
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

  /** The latest load: an earlier, slower one must not overwrite it. */
  private loading = 0;

  private async load(): Promise<void> {
    const mine = ++this.loading;
    const result = await this.api.assistantFaithfulness(this.days());
    if (mine !== this.loading) return;
    if (result.ok) {
      this.view.set(result.data);
      this.failed.set(false);
    } else {
      this.failed.set(true);
      toast.error("Could not load the faithfulness figures", { description: result.error });
    }
  }
}
