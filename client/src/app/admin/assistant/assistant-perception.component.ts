import { DecimalPipe } from "@angular/common";
import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from "@angular/core";
import { toast } from "@spartan-ng/brain/sonner";
import { HlmButton } from "@spartan-ng/helm/button";

import { AdminApiService } from "../admin-api.service";
import {
  cacheShare,
  documentRows,
  layoutRows,
  localeMixLine,
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
 * applies it, and the next question reads the new core.
 */
@Component({
  selector: "app-assistant-perception",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DecimalPipe, HlmButton],
  host: { class: "block" },
  template: `
    <section class="flex flex-col gap-3" aria-labelledby="assistant-perception">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <h2 id="assistant-perception" class="m-0 text-sm font-medium">Perception</h2>
        <label class="flex items-center gap-2 text-xs text-muted-foreground">
          Window
          <select
            name="perception-window"
            aria-label="Perception window"
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
          What the assistant reads and how it uses it, over the last {{ v.days }} days:
          {{ v.answers }} visitor {{ v.answers === 1 ? "answer" : "answers" }}.
        </p>
        <dl class="m-0 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <div class="flex flex-col gap-0.5 rounded-lg border border-border p-3">
            <dt class="text-xs text-muted-foreground">Prefix, English / German</dt>
            <dd class="m-0 font-mono text-lg">
              @if (v.coreTokens; as t) {
                {{ t.en | number }} / {{ t.de | number }}
              } @else {
                –
              }
            </dd>
          </div>
          <div class="flex flex-col gap-0.5 rounded-lg border border-border p-3">
            <dt class="text-xs text-muted-foreground">Cached, first / later steps</dt>
            <dd class="m-0 font-mono text-lg">
              {{ cacheShare(v.cache.first) }} / {{ cacheShare(v.cache.later) }}
            </dd>
          </div>
          <div class="flex flex-col gap-0.5 rounded-lg border border-border p-3">
            <dt class="text-xs text-muted-foreground">Re-read ratio</dt>
            <dd
              class="m-0 font-mono text-lg"
              [class]="verdict(v) === 'high' ? 'text-destructive' : ''"
            >
              {{ percent(v.rereadRatio) }}
            </dd>
          </div>
          <div class="flex flex-col gap-0.5 rounded-lg border border-border p-3">
            <dt class="text-xs text-muted-foreground">Input tokens per answer</dt>
            <dd class="m-0 font-mono text-lg">
              {{
                v.tokens.inputPerAnswer === null ? "–" : (v.tokens.inputPerAnswer | number: "1.0-0")
              }}
            </dd>
          </div>
          <div class="flex flex-col gap-0.5 rounded-lg border border-border p-3">
            <dt class="text-xs text-muted-foreground">Tokens per helpful answer</dt>
            <dd class="m-0 font-mono text-lg">
              {{ v.tokens.perHelpful === null ? "–" : (v.tokens.perHelpful | number: "1.0-0") }}
            </dd>
          </div>
          <div class="flex flex-col gap-0.5 rounded-lg border border-border p-3">
            <dt class="text-xs text-muted-foreground">Documents fetched</dt>
            <dd class="m-0 font-mono text-lg">
              {{ v.fetches.whole + v.fetches.rest + v.fetches.handle + v.fetches.unknown }}
            </dd>
          </div>
        </dl>
        <p class="m-0 text-xs text-muted-foreground">
          Fetches: {{ v.fetches.whole }} re-read a document the prefix held whole (healthy under
          {{ percent(v.healthyReread) }}), {{ v.fetches.rest }} read the rest of one held cut short,
          {{ v.fetches.handle }} the other language's version, {{ v.fetches.unknown }} that no
          snapshot could place. Cached: {{ v.cache.first.steps }} first and
          {{ v.cache.later.steps }} later steps on models that cache.
        </p>
        @if (v.localeMix.length) {
          <p class="m-0 text-xs text-muted-foreground">{{ localeMixLine(v.localeMix) }}</p>
        }
        @if (searchLine(v.search); as line) {
          <p class="m-0 text-xs text-muted-foreground">Searches: {{ line }}.</p>
        }
        @if (windowLine(v); as line) {
          <p class="m-0 text-xs text-muted-foreground">{{ line }}.</p>
        }

        <div class="overflow-x-auto rounded-lg border border-border">
          <table class="w-full text-sm">
            <caption class="sr-only">
              Before and after a core per language
            </caption>
            <thead class="text-left text-xs text-muted-foreground">
              <tr>
                <th class="p-2 font-normal">Layout read</th>
                <th class="p-2 text-right font-normal">Answers</th>
                <th class="p-2 text-right font-normal">Input tokens</th>
                <th class="p-2 text-right font-normal">Cost</th>
                <th class="p-2 text-right font-normal">Cached, first / later</th>
                <th class="p-2 text-right font-normal">Re-reads</th>
                <th class="p-2 text-right font-normal">Tokens per helpful</th>
              </tr>
            </thead>
            <tbody>
              @for (r of layouts(v); track r.layout) {
                <tr class="border-t border-border font-mono text-xs">
                  <th scope="row" class="p-2 text-left font-sans text-sm font-normal">
                    {{ r.label }}
                  </th>
                  <td class="p-2 text-right">{{ r.answers }}</td>
                  <td class="p-2 text-right">{{ r.inputPerAnswer }}</td>
                  <td class="p-2 text-right">{{ r.usdPerAnswer }}</td>
                  <td class="p-2 text-right">{{ r.cached }}</td>
                  <td class="p-2 text-right">{{ r.reread }}</td>
                  <td class="p-2 text-right">{{ r.perHelpful }}</td>
                </tr>
              }
            </tbody>
          </table>
        </div>

        <div class="overflow-x-auto rounded-lg border border-border">
          <table class="w-full text-sm">
            <caption class="sr-only">
              The documents answers fetched or cited most
            </caption>
            <thead class="text-left text-xs text-muted-foreground">
              <tr>
                <th class="p-2 font-normal">Document</th>
                <th class="p-2 text-right font-normal">Fetched</th>
                <th class="p-2 text-right font-normal">Cited</th>
                <th class="p-2 font-normal">Tier</th>
              </tr>
            </thead>
            <tbody>
              @for (d of rows(v); track d.id) {
                <tr class="border-t border-border">
                  <td class="p-2">
                    {{ d.title }}
                    <span class="font-mono text-xs text-muted-foreground">{{ d.id }}</span>
                  </td>
                  <td class="p-2 text-right font-mono text-xs">{{ d.fetched }}</td>
                  <td class="p-2 text-right font-mono text-xs">{{ d.cited }}</td>
                  <td class="p-2 text-xs">{{ d.tier ? tierLabel[d.tier] : "–" }}</td>
                </tr>
              } @empty {
                <tr>
                  <td class="p-2 text-muted-foreground" colspan="4">
                    No answer fetched or cited a document yet.
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>

        @if (tools(v).length) {
          <div class="overflow-x-auto rounded-lg border border-border">
            <table class="w-full text-sm">
              <caption class="sr-only">
                How each tool fared, its calls by outcome
              </caption>
              <thead class="text-left text-xs text-muted-foreground">
                <tr>
                  <th class="p-2 font-normal">Tool</th>
                  <th class="p-2 text-right font-normal">Per answer</th>
                  <th class="p-2 text-right font-normal">Not found</th>
                  <th class="p-2 text-right font-normal">Not allowed</th>
                  <th class="p-2 text-right font-normal">No hits</th>
                  <th class="p-2 text-right font-normal">Repeated</th>
                  <th class="p-2 text-right font-normal">Over budget</th>
                  <th class="p-2 text-right font-normal">Then cited</th>
                </tr>
              </thead>
              <tbody>
                @for (t of tools(v); track t.name) {
                  <tr class="border-t border-border font-mono text-xs">
                    <th scope="row" class="p-2 text-left font-normal">{{ t.name }}</th>
                    <td class="p-2 text-right">{{ t.perAnswer }}</td>
                    <td class="p-2 text-right">{{ t.notFound }}</td>
                    <td class="p-2 text-right">{{ t.notAllowed }}</td>
                    <td class="p-2 text-right">{{ t.noHits }}</td>
                    <td class="p-2 text-right">{{ t.repeated }}</td>
                    <td class="p-2 text-right">{{ t.overBudget }}</td>
                    <td class="p-2 text-right">{{ t.cited }}</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }

        <div class="flex flex-col gap-2 rounded-lg border border-border p-3 text-sm">
          <h3 class="m-0 text-sm font-medium">Tier suggestions</h3>
          <p class="m-0 text-xs text-muted-foreground">
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
                  <span class="font-mono text-xs text-muted-foreground">{{ entry.id }}</span></span
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
      } @else if (failed()) {
        <p class="m-0 text-xs text-destructive">Could not load the perception figures.</p>
      } @else {
        <p class="m-0 text-xs text-muted-foreground">Loading…</p>
      }
    </section>
  `,
})
export class AssistantPerceptionComponent implements OnInit {
  private readonly api = inject(AdminApiService);

  protected readonly view = signal<PerceptionView | null>(null);
  protected readonly failed = signal(false);
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

  /** The latest load: an earlier, slower one must not overwrite it. */
  private loading = 0;

  private async load(): Promise<void> {
    const mine = ++this.loading;
    const result = await this.api.assistantPerception(this.days());
    if (mine !== this.loading) return;
    if (result.ok) {
      this.view.set(result.data);
      this.failed.set(false);
    } else {
      this.failed.set(true);
      toast.error("Could not load the perception figures", { description: result.error });
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
      toast.error("Could not change the tiers", { description: result.error });
      return;
    }
    toast.success(tier ? "Tier applied" : "Tier removed", {
      description: "The next question reads the new prefix.",
    });
    await this.load();
  }
}
