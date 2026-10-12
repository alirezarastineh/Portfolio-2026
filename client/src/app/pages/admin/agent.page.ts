import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject,
  Injector,
  OnInit,
  signal,
} from "@angular/core";
import { toast } from "@spartan-ng/brain/sonner";
import { HlmBadge } from "@spartan-ng/helm/badge";
import { HlmButton } from "@spartan-ng/helm/button";
import { HlmField, HlmFieldLabel } from "@spartan-ng/helm/field";
import { HlmInput } from "@spartan-ng/helm/input";
import { HlmTextarea } from "@spartan-ng/helm/textarea";
import { HlmToggleGroupImports } from "@spartan-ng/helm/toggle-group";

import { AdminApiService } from "../../admin/admin-api.service";
import {
  agentWords,
  CONTENT_GOALS,
  filterProposals,
  filterStatuses,
  GOAL_NAMES,
  groupProposals,
  isContentRun,
  isOpen,
  plainText,
  PROPOSAL_FILTERS,
  RUN_LIMITS,
  runSummary,
  splitLabel,
  startWords,
  statusName,
  summaryLine,
  type ContentGoal,
  type Proposal,
  type ProposalFilter,
} from "../../admin/agent";
import type { RunRow } from "../../admin/assistant-types";
import {
  FormSkeletonComponent,
  LoadErrorComponent,
} from "../../admin/components/load-state.component";
import { AdminPageHeaderComponent } from "../../admin/components/page-header.component";
import { canResume, isActive } from "../../admin/eval-runs";

/** How often the page reads a running run again. */
const POLL_MS = 3_000;

/** Refusals that leave the proposal as it was on the server: no need to read the list again. */
const UNCHANGED_BY: ReadonlySet<string> = new Set(["invalid_input", "no_text"]);

/**
 * The content agent (plan phases 29–30): start a run that drafts the content's
 * gaps into proposals, follow it, and decide each proposal. Apply writes the
 * draft content, never the live site; a field changed since its draft is
 * never overwritten (stale); an applied one can be reverted. Publishing stays
 * in Review & publish.
 */
@Component({
  selector: "app-admin-agent",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    AdminPageHeaderComponent,
    FormSkeletonComponent,
    HlmBadge,
    HlmButton,
    HlmField,
    HlmFieldLabel,
    HlmInput,
    HlmTextarea,
    HlmToggleGroupImports,
    LoadErrorComponent,
  ],
  host: { class: "block" },
  template: `
    <div class="mx-auto flex max-w-5xl flex-col gap-8 pb-12">
      <app-page-header
        title="Agent"
        description="The content agent drafts translations, alt text and search descriptions into proposals. Nothing reaches your draft until you apply it, and nothing goes live until you publish."
      />

      <section aria-labelledby="agent-start-title" class="flex flex-col gap-3">
        <h2 id="agent-start-title" class="m-0 text-h4">Start a run</h2>
        <p class="m-0 text-sm text-muted-foreground">
          Paid: it spends under Admin agents' switch and cap (Settings → Spending), and stops at its
          own limit. Each draft is checked, repaired, and ranked or read twice, as the editors'
          copilot does.
        </p>
        <fieldset class="m-0 flex flex-wrap gap-4 border-0 p-0">
          <legend class="mb-2 text-sm font-medium">What to draft</legend>
          @for (goal of goals; track goal) {
            <label class="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                class="size-4 accent-foreground"
                [checked]="chosen()[goal]"
                (change)="choose(goal, $any($event.target).checked)"
              />
              {{ goalName[goal] }}
            </label>
          }
        </fieldset>
        <div class="flex flex-wrap items-end gap-4">
          <div hlmField class="w-40">
            <label hlmFieldLabel for="agent-items">Items, at most</label>
            <input
              hlmInput
              id="agent-items"
              type="number"
              [min]="limits.items.min"
              [max]="limits.items.max"
              [value]="maxItems()"
              (input)="maxItems.set($any($event.target).valueAsNumber)"
            />
          </div>
          <div hlmField class="w-40">
            <label hlmFieldLabel for="agent-usd">Spend limit (USD)</label>
            <input
              hlmInput
              id="agent-usd"
              type="number"
              step="0.01"
              [min]="limits.usd.min"
              [max]="limits.usd.max"
              [value]="maxUsd()"
              (input)="maxUsd.set($any($event.target).valueAsNumber)"
            />
          </div>
          <button hlmBtn type="button" [disabled]="!canStart()" (click)="start()">
            {{ starting() ? "Starting…" : "Start a run" }}
          </button>
        </div>
      </section>

      <section aria-labelledby="agent-runs-title" class="flex flex-col gap-3">
        <h2 id="agent-runs-title" class="m-0 text-h4">Runs</h2>
        @if (runsError(); as reason) {
          <app-load-error title="Could not load the runs" [reason]="reason" (retry)="load()" />
        } @else if (runs() === null) {
          <app-form-skeleton kind="list" [rows]="2" label="Loading the runs…" />
        } @else if (!contentRuns().length) {
          <p class="m-0 text-sm text-muted-foreground">No content runs yet.</p>
        } @else {
          <ul class="m-0 flex list-none flex-col gap-2 p-0" role="list">
            @for (run of contentRuns(); track run.id) {
              <li
                class="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md border border-border px-3 py-2 text-sm"
              >
                <span class="font-medium">{{ runStatus(run) }}</span>
                <span class="font-mono text-xs tabular-nums">
                  {{ run.progress.done }} of {{ run.progress.total }} items · {{ cost(run.usd) }}
                </span>
                @if (summaryOf(run); as line) {
                  <span class="text-muted-foreground">{{ line }}</span>
                }
                @if (run.error) {
                  <span class="text-destructive">{{ run.error }}</span>
                }
                <span class="ml-auto flex gap-2">
                  @if (active(run)) {
                    <button hlmBtn variant="outline" size="sm" type="button" (click)="cancel(run)">
                      Cancel
                    </button>
                  } @else if (resumable(run)) {
                    <button hlmBtn variant="outline" size="sm" type="button" (click)="resume(run)">
                      Resume
                    </button>
                  }
                </span>
              </li>
            }
          </ul>
        }
      </section>

      <section aria-labelledby="agent-proposals-title" class="flex flex-col gap-4">
        <h2 id="agent-proposals-title" tabindex="-1" class="m-0 text-h4 outline-none">Proposals</h2>
        <p class="m-0 text-sm text-muted-foreground">
          Applying writes your draft, never the live site. An editor already open on the same item
          keeps the text it loaded: reload it before you save there, or its save puts the old text
          back.
        </p>
        <div
          hlmToggleGroup
          type="single"
          variant="outline"
          size="sm"
          aria-label="Proposal filter"
          [nullable]="false"
          [value]="filter()"
          (valueChange)="onFilter($event)"
        >
          @for (option of filters; track option.id) {
            <button hlmToggleGroupItem type="button" [value]="option.id">{{ option.label }}</button>
          }
        </div>

        @if (selectedOpen().length) {
          <div
            class="flex flex-wrap items-center gap-2 text-sm"
            role="group"
            aria-label="Selected proposals"
          >
            <span>{{ selectedOpen().length }} selected</span>
            <button
              hlmBtn
              size="sm"
              type="button"
              [disabled]="!!busy()"
              (click)="decideSelected('apply')"
            >
              Apply selected
            </button>
            <button
              hlmBtn
              variant="outline"
              size="sm"
              type="button"
              [disabled]="!!busy()"
              (click)="decideSelected('reject')"
            >
              Reject selected
            </button>
          </div>
        }

        @if (proposals() === null && !loadError()) {
          <app-form-skeleton kind="list" [rows]="3" label="Loading the proposals…" />
        } @else if (loadError(); as reason) {
          <app-load-error title="Could not load the proposals" [reason]="reason" (retry)="load()" />
        } @else if (!groups().length) {
          <p class="m-0 text-sm text-muted-foreground">{{ emptyText() }}</p>
        } @else {
          @if (limited()) {
            <p class="m-0 text-xs text-muted-foreground">
              The newest 200 are shown: decide some, or pick another filter, to reach older ones.
            </p>
          }
          @for (group of groups(); track group.entity; let g = $index) {
            <section [attr.aria-labelledby]="'agent-group-' + g" class="flex flex-col gap-2">
              <h3 [id]="'agent-group-' + g" class="m-0 text-base font-medium">
                {{ group.entity }}
              </h3>
              @for (p of group.proposals; track p.id) {
                <article
                  [attr.aria-labelledby]="'proposal-' + p.id"
                  class="flex flex-col gap-2 rounded-md border border-border p-3"
                >
                  <div class="flex flex-wrap items-center gap-2">
                    @if (open(p)) {
                      <input
                        type="checkbox"
                        class="size-4 accent-foreground"
                        [attr.aria-label]="'Select ' + p.label"
                        [checked]="selected().has(p.id)"
                        (change)="select(p.id, $any($event.target).checked)"
                      />
                    }
                    <h4
                      [id]="'proposal-' + p.id"
                      tabindex="-1"
                      class="m-0 text-sm font-medium outline-none"
                    >
                      {{ field(p) }}
                    </h4>
                    <span hlmBadge variant="outline" class="font-mono text-xs">{{
                      status(p)
                    }}</span>
                  </div>
                  @if (open(p) && p.changed) {
                    <p class="m-0 text-xs text-accent-orange">
                      Its field changed since the draft: applying it would not overwrite it.
                    </p>
                  }
                  @if (p.notes.length) {
                    <ul class="m-0 flex list-disc flex-col gap-0.5 pl-5 text-xs text-accent-orange">
                      @for (note of p.notes; track $index) {
                        <li>{{ note }}</li>
                      }
                    </ul>
                  }
                  <div class="grid gap-3 text-sm sm:grid-cols-2">
                    <div class="min-w-0">
                      <p class="eyebrow m-0 mb-1 text-muted-foreground">Before</p>
                      <p class="m-0 whitespace-pre-wrap wrap-break-word">
                        {{ shown(p.before) || "(empty)" }}
                      </p>
                    </div>
                    <div class="min-w-0">
                      <p class="eyebrow m-0 mb-1 text-muted-foreground">After</p>
                      @if (editing() === p.id) {
                        <div hlmField>
                          <label hlmFieldLabel class="sr-only" [for]="'proposal-' + p.id + '-text'">
                            Text for {{ p.label }}
                          </label>
                          <textarea
                            hlmTextarea
                            rows="4"
                            [id]="'proposal-' + p.id + '-text'"
                            [value]="draftText()"
                            (input)="draftText.set($any($event.target).value)"
                          ></textarea>
                        </div>
                      } @else {
                        <p class="m-0 whitespace-pre-wrap wrap-break-word">
                          {{ p.after === null ? "(no draft)" : shown(p.after) }}
                        </p>
                      }
                    </div>
                  </div>
                  <div class="flex flex-wrap gap-2">
                    @if (open(p)) {
                      @if (editing() === p.id) {
                        <button
                          hlmBtn
                          size="sm"
                          type="button"
                          [disabled]="!!busy() || !draftText().trim()"
                          (click)="apply(p, draftText())"
                        >
                          Apply this text
                        </button>
                        <button
                          hlmBtn
                          variant="ghost"
                          size="sm"
                          type="button"
                          (click)="stopEditing(p)"
                        >
                          Cancel
                        </button>
                      } @else {
                        <button
                          hlmBtn
                          size="sm"
                          type="button"
                          [disabled]="!!busy() || p.after === null"
                          [attr.aria-label]="'Apply ' + p.label"
                          (click)="apply(p)"
                        >
                          Apply
                        </button>
                        <button
                          hlmBtn
                          variant="outline"
                          size="sm"
                          type="button"
                          [disabled]="!!busy()"
                          [attr.aria-label]="'Edit ' + p.label"
                          (click)="edit(p)"
                        >
                          Edit
                        </button>
                        <button
                          hlmBtn
                          variant="ghost"
                          size="sm"
                          type="button"
                          [disabled]="!!busy()"
                          [attr.aria-label]="'Reject ' + p.label"
                          (click)="reject(p)"
                        >
                          Reject
                        </button>
                      }
                    } @else if (p.status === "applied") {
                      <button
                        hlmBtn
                        variant="outline"
                        size="sm"
                        type="button"
                        [disabled]="!!busy()"
                        [attr.aria-label]="'Revert ' + p.label"
                        (click)="revert(p)"
                      >
                        Revert
                      </button>
                    }
                  </div>
                </article>
              }
            </section>
          }
        }
      </section>
      <p id="agent-said" class="sr-only" aria-live="polite">{{ said() }}</p>
    </div>
  `,
})
export default class AdminAgentPage implements OnInit {
  private readonly api = inject(AdminApiService);
  private readonly injector = inject(Injector);

  protected readonly goals = CONTENT_GOALS;
  protected readonly goalName = GOAL_NAMES;
  protected readonly limits = RUN_LIMITS;
  protected readonly filters = PROPOSAL_FILTERS;
  protected readonly open = isOpen;
  protected readonly status = (p: Proposal) => statusName(p.status);
  protected readonly field = (p: Proposal) => splitLabel(p.label).field || p.label;
  protected readonly shown = plainText;
  protected readonly active = isActive;
  protected readonly resumable = canResume;

  protected readonly chosen = signal<Record<ContentGoal, boolean>>({
    translations: true,
    alt: true,
    seo: true,
  });
  protected readonly maxItems = signal<number>(RUN_LIMITS.items.default);
  protected readonly maxUsd = signal<number>(RUN_LIMITS.usd.default);
  protected readonly starting = signal(false);

  protected readonly runs = signal<RunRow[] | null>(null);
  /** Why the runs did not load, in words. */
  protected readonly runsError = signal<string | null>(null);
  protected readonly contentRuns = computed(() => (this.runs() ?? []).filter(isContentRun));

  protected readonly proposals = signal<Proposal[] | null>(null);
  /** The server listed its newest 200 of this filter; there are more. */
  protected readonly limited = signal(false);
  protected readonly loadError = signal<string | null>(null);
  protected readonly filter = signal<ProposalFilter>("open");
  protected readonly groups = computed(() =>
    groupProposals(filterProposals(this.proposals() ?? [], this.filter())),
  );
  protected readonly selected = signal<ReadonlySet<string>>(new Set());
  /** The selection still open (a decided proposal leaves it). */
  protected readonly selectedOpen = computed(() =>
    (this.proposals() ?? []).filter((p) => isOpen(p) && this.selected().has(p.id)),
  );
  protected readonly editing = signal<string | null>(null);
  protected readonly draftText = signal("");
  /** A decision in flight: a proposal's id, or "batch". */
  protected readonly busy = signal<string | null>(null);
  /** The last decision, for the polite live region. */
  protected readonly said = signal("");

  protected readonly canStart = computed(() => {
    const items = this.maxItems();
    const usd = this.maxUsd();
    return (
      !this.starting() &&
      CONTENT_GOALS.some((goal) => this.chosen()[goal]) &&
      Number.isInteger(items) &&
      items >= RUN_LIMITS.items.min &&
      items <= RUN_LIMITS.items.max &&
      usd >= RUN_LIMITS.usd.min &&
      usd <= RUN_LIMITS.usd.max
    );
  });

  protected readonly emptyText = computed(() =>
    this.filter() === "open"
      ? "No proposals wait for you. Start a run to draft the content's gaps."
      : "No proposals with this status.",
  );

  private timer: ReturnType<typeof setTimeout> | null = null;
  /** The page is gone: a load still in flight sets nothing and polls no more. */
  private destroyed = false;
  /** The latest load: an earlier, slower answer (another filter's, say) never lands. */
  private latest = 0;

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.destroyed = true;
      this.stopPolling();
    });
  }

  ngOnInit(): void {
    void this.load();
  }

  protected async load(): Promise<void> {
    const mine = ++this.latest;
    const [runs, proposals] = await Promise.all([
      this.api.listRuns(),
      this.api.proposals(filterStatuses(this.filter())),
    ]);
    if (this.destroyed || mine !== this.latest) return;
    if (runs.ok) {
      this.runs.set(runs.data.runs);
      this.runsError.set(null);
    } else {
      this.runsError.set(agentWords(runs.error));
    }
    if (proposals.ok) {
      this.proposals.set(proposals.data.proposals);
      this.limited.set(proposals.data.limited ?? false);
      this.loadError.set(null);
    } else {
      this.loadError.set(agentWords(proposals.error));
    }
    this.poll();
  }

  /** While a content run is going, read the runs and the proposals again soon. */
  private poll(): void {
    this.stopPolling();
    if (!this.destroyed && this.contentRuns().some(isActive)) {
      this.timer = setTimeout(() => void this.load(), POLL_MS);
    }
  }

  private stopPolling(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  protected choose(goal: ContentGoal, on: boolean): void {
    this.chosen.update((chosen) => ({ ...chosen, [goal]: on }));
  }

  protected async start(): Promise<void> {
    if (!this.canStart()) return;
    this.starting.set(true);
    const result = await this.api.startContentRun({
      goals: CONTENT_GOALS.filter((goal) => this.chosen()[goal]),
      maxItems: this.maxItems(),
      maxUsd: this.maxUsd(),
    });
    this.starting.set(false);
    if (!result.ok) {
      toast.error("The run did not start", { description: startWords(result.error) });
      return;
    }
    toast.success("Run started: its proposals appear below as it drafts them.");
    await this.load();
  }

  protected async cancel(run: RunRow): Promise<void> {
    const result = await this.api.cancelRun(run.id);
    if (!result.ok)
      toast.error("Could not cancel the run", { description: agentWords(result.error) });
    await this.load();
  }

  protected async resume(run: RunRow): Promise<void> {
    const result = await this.api.resumeRun(run.id);
    if (!result.ok)
      toast.error("Could not resume the run", { description: agentWords(result.error) });
    await this.load();
  }

  protected runStatus(run: RunRow): string {
    const when = new Date(run.startedAt ?? run.createdAt).toLocaleString();
    const goals = ((run.params["goals"] as ContentGoal[] | undefined) ?? [])
      .map((goal) => GOAL_NAMES[goal] ?? goal)
      .join(", ");
    return `${run.status[0]!.toUpperCase()}${run.status.slice(1)} · ${goals} · ${when}`;
  }

  protected summaryOf(run: RunRow): string | null {
    const summary = runSummary(run);
    return summary ? summaryLine(summary) : null;
  }

  protected cost(usd: number): string {
    // A run costs cents: four places under a dollar.
    return "$" + usd.toFixed(usd < 1 ? 4 : 2);
  }

  /** Another filter: the server lists its proposals (the newest 200 of them). */
  protected onFilter(value: unknown): void {
    const filter = PROPOSAL_FILTERS.find((f) => f.id === value)?.id;
    if (!filter || filter === this.filter()) return;
    this.filter.set(filter);
    void this.load();
  }

  protected select(id: string, on: boolean): void {
    this.selected.update((selected) => {
      const next = new Set(selected);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  protected edit(p: Proposal): void {
    this.editing.set(p.id);
    this.draftText.set(p.after ?? p.before);
    this.focusLater(`proposal-${p.id}-text`);
  }

  protected stopEditing(p: Proposal): void {
    this.editing.set(null);
    this.focusLater(`proposal-${p.id}`);
  }

  protected async apply(p: Proposal, text?: string): Promise<void> {
    await this.decide(p, () => this.api.applyProposal(p.id, text), "Applied to the draft");
  }

  protected async reject(p: Proposal): Promise<void> {
    await this.decide(p, () => this.api.rejectProposal(p.id), "Rejected");
  }

  protected async revert(p: Proposal): Promise<void> {
    await this.decide(p, () => this.api.revertProposal(p.id), "Reverted");
  }

  /** One decision: the proposal replaced by what the server says it is now, and said. */
  private async decide(
    p: Proposal,
    call: () => ReturnType<AdminApiService["rejectProposal"]>,
    done: string,
  ): Promise<void> {
    this.busy.set(p.id);
    const result = await call();
    this.busy.set(null);
    if (result.ok) {
      this.replace([result.data.proposal]);
      this.editing.set(null);
      this.said.set(`${done}: ${p.label}.`);
    } else {
      const words = agentWords(result.error);
      this.said.set(`${p.label}: ${words}`);
      toast.error("Not done", { description: words });
      // It moved on the server (stale, decided in another tab, gone) or the request failed:
      // read the list again. A text refused for its field changed nothing.
      if (!UNCHANGED_BY.has(result.error)) await this.load();
    }
    this.focusAfter(p.id);
  }

  protected async decideSelected(action: "apply" | "reject"): Promise<void> {
    const ids = this.selectedOpen().map((p) => p.id);
    if (!ids.length) return;
    this.busy.set("batch");
    const result = await this.api.decideProposals(ids, action);
    this.busy.set(null);
    if (!result.ok) {
      toast.error("Not done", { description: agentWords(result.error) });
      // Some may have been decided before it failed: the server's list says which.
      await this.load();
      return;
    }
    const decided = result.data.results.flatMap((r) => ("proposal" in r ? [r.proposal] : []));
    const failed = result.data.results.flatMap((r) => ("error" in r ? [r] : []));
    this.replace(decided);
    this.selected.set(new Set());
    const verb = action === "apply" ? "Applied" : "Rejected";
    this.said.set(
      failed.length
        ? `${verb} ${decided.length}; ${failed.length} not: ${agentWords(failed[0]!.error)}`
        : `${verb} ${decided.length}.`,
    );
    if (failed.length) await this.load();
    this.focusLater("agent-proposals-title");
  }

  private replace(updated: readonly Proposal[]): void {
    const byId = new Map(updated.map((p) => [p.id, p]));
    this.proposals.update((all) => (all ?? []).map((p) => byId.get(p.id) ?? p));
  }

  /** A decided proposal's buttons go: its heading takes focus, or the list's when it left the filter. */
  private focusAfter(id: string): void {
    afterNextRender(
      () => {
        const heading = document.getElementById(`proposal-${id}`);
        (heading ?? document.getElementById("agent-proposals-title"))?.focus();
      },
      { injector: this.injector },
    );
  }

  private focusLater(id: string): void {
    afterNextRender(() => document.getElementById(id)?.focus(), { injector: this.injector });
  }
}
