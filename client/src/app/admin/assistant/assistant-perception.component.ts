import { DecimalPipe } from "@angular/common";
import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from "@angular/core";
import { toast } from "@spartan-ng/brain/sonner";
import { HlmButton } from "@spartan-ng/helm/button";
import { HlmTableImports } from "@spartan-ng/helm/table";

import { AdminApiService } from "../admin-api.service";
import { apiWords } from "../api-words";
import { LoadErrorComponent } from "../components/load-state.component";
import {
  cacheShare,
  documentRows,
  layoutRows,
  localeMixLine,
  pagesLine,
  percent,
  rereadVerdict,
  searchLine,
  toolRows,
  windowLine,
  WINDOWS,
  withTier,
  type PerceptionView,
  type Tier,
} from "../perception";

/**
 * What the assistant reads and how it uses it (plan phase 16): the prefix per
 * answer language, the cached share of answers' first and later steps, the
 * re-read ratio, tokens per helpful answer, which documents are fetched and
 * cited, and the corpus tiers. The system only suggests a tier; the admin
 * applies it, and the next question reads the new core. A report in words
 * (plan 5, U22): its figures a table, not tiles.
 */
@Component({
  selector: "app-assistant-perception",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DecimalPipe, HlmButton, HlmTableImports, LoadErrorComponent],
  host: { class: "block" },
  template: `
    <section class="flex flex-col gap-3" aria-labelledby="assistant-perception">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <h2 #heading id="assistant-perception" tabindex="-1" class="m-0 text-section-title">
          Perception
        </h2>
        <label class="flex items-center gap-2 text-xs text-muted-foreground">
          Window
          <select
            name="perception-window"
            aria-label="Perception window"
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
            What the assistant reads and how it uses it, over the last {{ v.days }} days:
            {{ v.answers }} visitor {{ v.answers === 1 ? "answer" : "answers" }}.
          </p>
          <div hlmTableContainer>
            <table hlmTable class="max-w-xl">
              <caption class="sr-only">
                What the assistant read, over the last
                {{
                  v.days
                }}
                days
              </caption>
              <thead hlmTHead>
                <tr hlmTr>
                  <th hlmTh scope="col">Measure</th>
                  <th hlmTh scope="col" class="text-right">Value</th>
                </tr>
              </thead>
              <tbody hlmTBody>
                <tr hlmTr>
                  <th hlmTh scope="row" class="font-normal">Prefix, English / German</th>
                  <td hlmTd class="text-right font-data text-xs">
                    @if (v.coreTokens; as t) {
                      {{ t.en | number }} / {{ t.de | number }} tokens
                    } @else {
                      –
                    }
                  </td>
                </tr>
                <tr hlmTr>
                  <th hlmTh scope="row" class="font-normal">Cached, first / later steps</th>
                  <td hlmTd class="text-right font-data text-xs">
                    {{ cacheShare(v.cache.first) }} / {{ cacheShare(v.cache.later) }}
                  </td>
                </tr>
                <tr hlmTr>
                  <th hlmTh scope="row" class="font-normal">Re-read ratio</th>
                  <td hlmTd class="text-right font-data text-xs">
                    <span>{{ percent(v.rereadRatio) }}</span>
                    @if (verdict(v) === "high") {
                      <span class="font-sans text-destructive">, high</span>
                    }
                  </td>
                </tr>
                <tr hlmTr>
                  <th hlmTh scope="row" class="font-normal">Input tokens per answer</th>
                  <td hlmTd class="text-right font-data text-xs">
                    {{
                      v.tokens.inputPerAnswer === null
                        ? "–"
                        : (v.tokens.inputPerAnswer | number: "1.0-0")
                    }}
                  </td>
                </tr>
                <tr hlmTr>
                  <th hlmTh scope="row" class="font-normal">Tokens per helpful answer</th>
                  <td hlmTd class="text-right font-data text-xs">
                    {{
                      v.tokens.perHelpful === null ? "–" : (v.tokens.perHelpful | number: "1.0-0")
                    }}
                  </td>
                </tr>
                <tr hlmTr>
                  <th hlmTh scope="row" class="font-normal">Documents fetched</th>
                  <td hlmTd class="text-right font-data text-xs">
                    {{ v.fetches.whole + v.fetches.rest + v.fetches.handle + v.fetches.unknown }}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <p class="m-0 max-w-prose text-hint text-muted-foreground">
            Fetches: {{ v.fetches.whole }} re-read a document the prefix held whole (healthy under
            {{ percent(v.healthyReread) }}), {{ v.fetches.rest }} read the rest of one held cut
            short, {{ v.fetches.handle }} the other language's version, {{ v.fetches.unknown }} that
            no snapshot could place. Cached: {{ v.cache.first.steps }} first and
            {{ v.cache.later.steps }} later steps on models that cache.
          </p>
          @if (v.localeMix.length) {
            <p class="m-0 max-w-prose text-hint text-muted-foreground">
              {{ localeMixLine(v.localeMix) }}.
            </p>
          }
          @if (searchLine(v.search); as line) {
            <p class="m-0 max-w-prose text-hint text-muted-foreground">Searches {{ line }}.</p>
          }
          @if (windowLine(v); as line) {
            <p class="m-0 max-w-prose text-hint text-muted-foreground">{{ line }}.</p>
          }
          @if (pagesLine(v); as line) {
            <p class="m-0 max-w-prose text-hint text-muted-foreground">{{ line }}.</p>
          }

          <div hlmTableContainer>
            <table hlmTable>
              <caption class="sr-only">
                Before and after a core per language
              </caption>
              <thead hlmTHead>
                <tr hlmTr>
                  <th hlmTh scope="col">Layout read</th>
                  <th hlmTh scope="col" class="text-right">Answers</th>
                  <th hlmTh scope="col" class="text-right">Input tokens</th>
                  <th hlmTh scope="col" class="text-right">Cost</th>
                  <th hlmTh scope="col" class="text-right">Cached, first / later</th>
                  <th hlmTh scope="col" class="text-right">Re-reads</th>
                  <th hlmTh scope="col" class="text-right">Tokens per helpful</th>
                </tr>
              </thead>
              <tbody hlmTBody>
                @for (r of layouts(v); track r.layout) {
                  <tr hlmTr class="font-data text-xs">
                    <th hlmTh scope="row" class="font-sans text-sm font-normal">
                      {{ r.label }}
                    </th>
                    <td hlmTd class="text-right">{{ r.answers }}</td>
                    <td hlmTd class="text-right">{{ r.inputPerAnswer }}</td>
                    <td hlmTd class="text-right">{{ r.usdPerAnswer }}</td>
                    <td hlmTd class="text-right">{{ r.cached }}</td>
                    <td hlmTd class="text-right">{{ r.reread }}</td>
                    <td hlmTd class="text-right">{{ r.perHelpful }}</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>

          <div hlmTableContainer>
            <table hlmTable>
              <caption class="sr-only">
                The documents answers fetched or cited most
              </caption>
              <thead hlmTHead>
                <tr hlmTr>
                  <th hlmTh scope="col">Document</th>
                  <th hlmTh scope="col" class="text-right">Fetched</th>
                  <th hlmTh scope="col" class="text-right">Cited</th>
                  <th hlmTh scope="col">Tier</th>
                </tr>
              </thead>
              <tbody hlmTBody>
                @for (d of rows(v); track d.id) {
                  <tr hlmTr>
                    <th hlmTh scope="row" class="font-normal whitespace-normal">
                      {{ d.title }}
                      <span class="font-data text-xs text-muted-foreground" translate="no">{{
                        d.id
                      }}</span>
                    </th>
                    <td hlmTd class="text-right font-data text-xs">{{ d.fetched }}</td>
                    <td hlmTd class="text-right font-data text-xs">{{ d.cited }}</td>
                    <td hlmTd class="text-xs">{{ d.tier ? tierLabel[d.tier] : "–" }}</td>
                  </tr>
                } @empty {
                  <tr hlmTr>
                    <td hlmTd colspan="4" class="text-muted-foreground">
                      No answer fetched or cited a document yet.
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>

          @if (tools(v).length) {
            <div hlmTableContainer>
              <table hlmTable>
                <caption class="sr-only">
                  How each tool fared, its calls by outcome
                </caption>
                <thead hlmTHead>
                  <tr hlmTr>
                    <th hlmTh scope="col">Tool</th>
                    <th hlmTh scope="col" class="text-right">Per answer</th>
                    <th hlmTh scope="col" class="text-right">Not found</th>
                    <th hlmTh scope="col" class="text-right">Not allowed</th>
                    <th hlmTh scope="col" class="text-right">No hits</th>
                    <th hlmTh scope="col" class="text-right">Repeated</th>
                    <th hlmTh scope="col" class="text-right">Over budget</th>
                    <th hlmTh scope="col" class="text-right">Then cited</th>
                  </tr>
                </thead>
                <tbody hlmTBody>
                  @for (t of tools(v); track t.name) {
                    <tr hlmTr class="font-data text-xs">
                      <th hlmTh scope="row" class="font-normal" translate="no">{{ t.name }}</th>
                      <td hlmTd class="text-right">{{ t.perAnswer }}</td>
                      <td hlmTd class="text-right">{{ t.notFound }}</td>
                      <td hlmTd class="text-right">{{ t.notAllowed }}</td>
                      <td hlmTd class="text-right">{{ t.noHits }}</td>
                      <td hlmTd class="text-right">{{ t.repeated }}</td>
                      <td hlmTd class="text-right">{{ t.overBudget }}</td>
                      <td hlmTd class="text-right">{{ t.cited }}</td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          }
        } @else {
          <p class="m-0 text-hint text-muted-foreground">
            No visitor answer in the last {{ v.days }} days.
          </p>
        }

        <div class="flex flex-col gap-2 text-sm">
          <h3 class="m-0 text-sm font-medium">Tier suggestions</h3>
          <p class="m-0 max-w-prose text-hint text-muted-foreground">
            Promoted: held whole at the front of the prefix (fetched in more than
            {{ percent(v.rules.promoteShare) }} of at least
            {{ v.rules.promoteMinAnswers }} answers). Clipped harder: half its kind's length (no
            answer fetched or cited it in at least {{ v.rules.demoteMinAnswers }}). Nothing changes
            until you apply it.
          </p>
          <ul class="m-0 flex list-none flex-col gap-2 p-0">
            @for (s of v.suggestions.promote; track s.id) {
              <li class="flex flex-wrap items-center justify-between gap-2">
                <span>Promote {{ s.title }}: {{ s.why }}</span>
                <button
                  hlmBtn
                  size="sm"
                  variant="outline"
                  type="button"
                  [disabled]="saving()"
                  [attr.aria-label]="'Promote ' + s.title"
                  (click)="apply(v, s.id, 'promoted')"
                >
                  Promote
                </button>
              </li>
            }
            @for (s of v.suggestions.demote; track s.id) {
              <li class="flex flex-wrap items-center justify-between gap-2">
                <span>Clip {{ s.title }} harder: {{ s.why }}</span>
                <button
                  hlmBtn
                  size="sm"
                  variant="outline"
                  type="button"
                  [disabled]="saving()"
                  [attr.aria-label]="'Clip harder ' + s.title"
                  (click)="apply(v, s.id, 'demoted')"
                >
                  Clip harder
                </button>
              </li>
            }
            @if (!v.suggestions.promote.length && !v.suggestions.demote.length) {
              <li class="text-xs text-muted-foreground">No suggestion.</li>
            }
            @for (s of v.suggestions.considered.slice(0, 5); track s.id) {
              <li class="text-xs text-muted-foreground">
                Not suggested, {{ s.title }}: {{ s.why }}
              </li>
            }
          </ul>

          <h3 class="m-0 text-sm font-medium">Applied tiers</h3>
          <ul class="m-0 flex list-none flex-col gap-2 p-0">
            @for (entry of applied(v); track entry.id) {
              <li class="flex flex-wrap items-center justify-between gap-2">
                <span
                  >{{ tierLabel[entry.tier] }}: {{ v.titles[entry.id] ?? entry.id }}
                  <span class="font-data text-xs text-muted-foreground" translate="no">{{
                    entry.id
                  }}</span></span
                >
                <button
                  hlmBtn
                  size="sm"
                  variant="outline"
                  type="button"
                  [disabled]="saving()"
                  [attr.aria-label]="'Remove the tier of ' + (v.titles[entry.id] ?? entry.id)"
                  (click)="apply(v, entry.id, null)"
                >
                  Remove
                </button>
              </li>
            } @empty {
              <li class="text-xs text-muted-foreground">
                None: every document has its kind's place in the prefix.
              </li>
            }
          </ul>
        </div>
      } @else if (loadError(); as code) {
        <app-load-error
          compact
          title="Could not load the perception figures"
          [reason]="code"
          [refocus]="heading"
          (retry)="reload()"
        />
      } @else {
        <p class="m-0 text-hint text-muted-foreground">Loading the perception figures…</p>
      }
    </section>
  `,
})
export class AssistantPerceptionComponent implements OnInit {
  private readonly api = inject(AdminApiService);

  protected readonly view = signal<PerceptionView | null>(null);
  /** Why the figures did not arrive (the API's code): said in their place, with Try again. */
  protected readonly loadError = signal<string | null>(null);
  protected readonly saving = signal(false);
  /** The window in days; after a deploy, a short one shows the new layout alone sooner. */
  protected readonly days = signal(30);

  protected readonly windows = WINDOWS;
  protected readonly percent = percent;
  protected readonly cacheShare = cacheShare;
  protected readonly localeMixLine = localeMixLine;
  protected readonly verdict = rereadVerdict;
  protected readonly rows = documentRows;
  protected readonly layouts = layoutRows;
  protected readonly searchLine = searchLine;
  protected readonly tools = toolRows;
  protected readonly windowLine = windowLine;
  protected readonly pagesLine = pagesLine;
  protected readonly tierLabel: Record<Tier, string> = {
    promoted: "Promoted",
    demoted: "Clipped harder",
  };

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
    const result = await this.api.assistantPerception(this.days());
    if (mine !== this.loading) {
      return;
    }
    if (result.ok) {
      this.view.set(result.data);
      this.loadError.set(null);
    } else if (this.view()) {
      // Figures on screen stay; the window that did not load says so.
      toast.error("Could not load the perception figures", { description: apiWords(result.error) });
    } else {
      this.loadError.set(result.error);
    }
  }

  protected applied(v: PerceptionView): { id: string; tier: Tier }[] {
    return [
      ...v.tiers.promoted.map((id) => ({ id, tier: "promoted" as const })),
      ...v.tiers.demoted.map((id) => ({ id, tier: "demoted" as const })),
    ];
  }

  protected async apply(v: PerceptionView, id: string, tier: Tier | null): Promise<void> {
    this.saving.set(true);
    const result = await this.api.setCorpusTiers(withTier(v.tiers, id, tier));
    this.saving.set(false);
    if (!result.ok) {
      toast.error("Could not change the tiers", { description: apiWords(result.error) });
      return;
    }
    toast.success(tier ? "Tier applied" : "Tier removed", {
      description: "The next question reads the new prefix.",
    });
    await this.load();
  }
}
