import { DatePipe } from "@angular/common";
import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from "@angular/core";
import { toast } from "@spartan-ng/brain/sonner";

import { AdminApiService } from "../admin-api.service";
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
 * week by default, the plan's weekly report on demand.
 */
@Component({
  selector: "app-assistant-routing",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe],
  host: { class: "block" },
  template: `
    <section class="flex flex-col gap-3" aria-labelledby="assistant-routing">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <h2 id="assistant-routing" class="m-0 text-sm font-medium">Routing</h2>
        <label class="flex items-center gap-2 text-xs text-muted-foreground">
          Window
          <select
            name="routing-window"
            aria-label="Routing window"
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
          How {{ v.answers }} visitor {{ v.answers === 1 ? "answer was" : "answers were" }} routed
          over the last {{ v.days }} days.
        </p>
        <div class="flex flex-col gap-1 rounded-lg border border-border p-3">
          <p class="m-0 text-xs text-muted-foreground">False-simple rate</p>
          <p class="m-0 text-sm">
            {{ falseSimpleLine(v) ?? "No answer was kept on the lite route yet." }}
          </p>
        </div>

        <div class="overflow-x-auto rounded-lg border border-border">
          <table class="w-full text-sm">
            <caption class="sr-only">
              Answers by route tier
            </caption>
            <thead class="text-left text-xs text-muted-foreground">
              <tr>
                <th class="p-2 font-normal">Tier</th>
                <th class="p-2 text-right font-normal">Answers</th>
                <th class="p-2 text-right font-normal">First token, median / 90th</th>
                <th class="p-2 text-right font-normal">Cost</th>
                <th class="p-2 text-right font-normal">Helpful</th>
              </tr>
            </thead>
            <tbody>
              @for (r of rows(v); track r.tier) {
                <tr class="border-t border-border font-mono text-xs">
                  <th scope="row" class="p-2 text-left font-sans text-sm font-normal">
                    {{ r.label }}
                  </th>
                  <td class="p-2 text-right">{{ r.answers }}</td>
                  <td class="p-2 text-right">{{ r.ttft }}</td>
                  <td class="p-2 text-right">{{ r.usdPerAnswer }}</td>
                  <td class="p-2 text-right">{{ r.helpful }}</td>
                </tr>
              } @empty {
                <tr>
                  <td class="p-2 text-muted-foreground" colspan="5">No visitor answer yet.</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
        @if (escalationLine(v); as line) {
          <p class="m-0 text-xs text-muted-foreground">{{ line }}.</p>
        }
        @if (sensitiveLine(v); as line) {
          <p class="m-0 text-xs text-muted-foreground">{{ line }}.</p>
        }

        @if (v.falseSimple.listed.length) {
          <div class="flex flex-col gap-2 rounded-lg border border-border p-3 text-sm">
            <h3 class="m-0 text-sm font-medium">Kept lite, then went wrong</h3>
            <p class="m-0 text-xs text-muted-foreground">
              Freeze one as a case in Conversations to replay it on the deep chain (<code
                class="font-mono"
                >ai:eval --suite production --on deep</code
              >, paid).
            </p>
            <ul class="m-0 flex list-none flex-col gap-2 p-0">
              @for (c of v.falseSimple.listed; track c.id) {
                <li class="flex flex-col gap-0.5">
                  <span>{{ c.question }}</span>
                  <span class="text-xs text-muted-foreground">
                    {{ c.createdAt | date: "MMM d, HH:mm" }} ·
                    {{ c.tier === "lookup" ? "lookup" : "lite" }} · {{ reasons(c.reasons) }} ·
                    <span class="font-mono">{{ c.id }}</span>
                  </span>
                </li>
              }
            </ul>
          </div>
        }
      } @else if (failed()) {
        <p class="m-0 text-xs text-destructive">Could not load the routing figures.</p>
      } @else {
        <p class="m-0 text-xs text-muted-foreground">Loading…</p>
      }
    </section>
  `,
})
export class AssistantRoutingComponent implements OnInit {
  private readonly api = inject(AdminApiService);

  protected readonly view = signal<RouterView | null>(null);
  protected readonly failed = signal(false);
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

  protected reasons(reasons: readonly (keyof typeof REASON_LABELS)[]): string {
    return reasons.map((r) => REASON_LABELS[r]).join(", ");
  }

  /** The latest load: an earlier, slower one must not overwrite it. */
  private loading = 0;

  private async load(): Promise<void> {
    const mine = ++this.loading;
    const result = await this.api.assistantRouting(this.days());
    if (mine !== this.loading) return;
    if (result.ok) {
      this.view.set(result.data);
      this.failed.set(false);
    } else {
      this.failed.set(true);
      toast.error("Could not load the routing figures", { description: result.error });
    }
  }
}
