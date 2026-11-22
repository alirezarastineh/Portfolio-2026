import { DatePipe } from "@angular/common";
import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from "@angular/core";
import { toast } from "@spartan-ng/brain/sonner";
import { HlmTableImports } from "@spartan-ng/helm/table";

import { AdminApiService } from "../admin-api.service";
import { apiWords } from "../api-words";
import { LoadErrorComponent } from "../components/load-state.component";
import { WINDOWS } from "../perception";
import {
  escalationLine,
  falseSimpleLine,
  REASON_LABELS,
  sensitiveLine,
  tierRows,
  type RouterView,
} from "../routing";

/**
 * The router's report (plan phase 20): visitor answers by route tier, with
 * their speed, cost and helpful share; how often an answer moved up to the
 * deep chain mid-way; the careful topics; and the false-simple rate, the
 * book's measure of a router's costly error, with the answers behind it. A
 * week by default, the plan's weekly report on demand. In words (plan 5, U22).
 */
@Component({
  selector: "app-assistant-routing",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, HlmTableImports, LoadErrorComponent],
  host: { class: "block" },
  template: `
    <section class="flex flex-col gap-3" aria-labelledby="assistant-routing">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <h2 #heading id="assistant-routing" tabindex="-1" class="m-0 text-section-title">
          Routing
        </h2>
        <label class="flex items-center gap-2 text-xs text-muted-foreground">
          Window
          <select
            name="routing-window"
            aria-label="Routing window"
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
        @if (v.answers) {
          <p class="m-0 max-w-prose text-hint text-muted-foreground">
            How {{ v.answers }} visitor {{ v.answers === 1 ? "answer was" : "answers were" }} routed
            over the last {{ v.days }} days.
          </p>
          <p class="m-0 max-w-prose text-sm">
            <span class="font-medium">False-simple rate:</span>
            {{ falseSimpleLine(v) ?? "no answer was kept on the lite route yet." }}
          </p>

          <div hlmTableContainer>
            <table hlmTable>
              <caption class="sr-only">
                Answers by route tier
              </caption>
              <thead hlmTHead>
                <tr hlmTr>
                  <th hlmTh scope="col">Tier</th>
                  <th hlmTh scope="col" class="text-right">Answers</th>
                  <th hlmTh scope="col" class="text-right">
                    First word, typical / slowest 1 in 10
                  </th>
                  <th hlmTh scope="col" class="text-right">Cost</th>
                  <th hlmTh scope="col" class="text-right">Helpful</th>
                </tr>
              </thead>
              <tbody hlmTBody>
                @for (r of rows(v); track r.tier) {
                  <tr hlmTr class="font-data text-xs">
                    <th hlmTh scope="row" class="font-sans text-sm font-normal">
                      {{ r.label }}
                    </th>
                    <td hlmTd class="text-right">{{ r.answers }}</td>
                    <td hlmTd class="text-right">{{ r.ttft }}</td>
                    <td hlmTd class="text-right">{{ r.usdPerAnswer }}</td>
                    <td hlmTd class="text-right">{{ r.helpful }}</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
          @if (escalationLine(v); as line) {
            <p class="m-0 max-w-prose text-hint text-muted-foreground">{{ line }}.</p>
          }
          @if (sensitiveLine(v); as line) {
            <p class="m-0 max-w-prose text-hint text-muted-foreground">{{ line }}.</p>
          }

          @if (v.falseSimple.listed.length) {
            <div class="flex flex-col gap-2 text-sm">
              <h3 class="m-0 text-sm font-medium">Kept lite, then went wrong</h3>
              <p class="m-0 max-w-prose text-hint text-muted-foreground">
                Freeze one as a case in Conversations to replay it on the deep chain (<code
                  class="font-mono"
                  translate="no"
                  >ai:eval --suite production --on deep</code
                >, paid).
              </p>
              <ul class="m-0 flex list-none flex-col gap-2 p-0">
                @for (c of v.falseSimple.listed; track c.id) {
                  <li class="flex flex-col gap-0.5">
                    <span>{{ c.question }}</span>
                    <span class="text-hint text-muted-foreground">
                      {{ c.createdAt | date: "MMM d, HH:mm" }},
                      {{ c.tier === "lookup" ? "lookup" : "lite" }}, {{ reasons(c.reasons) }},
                      <span class="font-data" translate="no">{{ c.id }}</span>
                    </span>
                  </li>
                }
              </ul>
            </div>
          }
        } @else {
          <p class="m-0 text-hint text-muted-foreground">
            No visitor answer in the last {{ v.days }} days.
          </p>
        }
      } @else if (loadError(); as code) {
        <app-load-error
          compact
          title="Could not load the routing figures"
          [reason]="code"
          [refocus]="heading"
          (retry)="reload()"
        />
      } @else {
        <p class="m-0 text-hint text-muted-foreground">Loading the routing figures…</p>
      }
    </section>
  `,
})
export class AssistantRoutingComponent implements OnInit {
  private readonly api = inject(AdminApiService);

  protected readonly view = signal<RouterView | null>(null);
  /** Why the figures did not arrive (the API's code): said in their place, with Try again. */
  protected readonly loadError = signal<string | null>(null);
  protected readonly days = signal(7);

  protected readonly windows = WINDOWS;
  protected readonly rows = tierRows;
  protected readonly falseSimpleLine = falseSimpleLine;
  protected readonly escalationLine = escalationLine;
  protected readonly sensitiveLine = sensitiveLine;

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

  protected reasons(reasons: readonly (keyof typeof REASON_LABELS)[]): string {
    return reasons.map((r) => REASON_LABELS[r]).join(", ");
  }

  /** The latest load: an earlier, slower one must not overwrite it. */
  private loading = 0;

  private async load(): Promise<void> {
    const mine = ++this.loading;
    const result = await this.api.assistantRouting(this.days());
    if (mine !== this.loading) {
      return;
    }
    if (result.ok) {
      this.view.set(result.data);
      this.loadError.set(null);
    } else if (this.view()) {
      // Figures on screen stay; the window that did not load says so.
      toast.error("Could not load the routing figures", { description: apiWords(result.error) });
    } else {
      this.loadError.set(result.error);
    }
  }
}
