import { DecimalPipe } from "@angular/common";
import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from "@angular/core";
import { toast } from "@spartan-ng/brain/sonner";
import { HlmBadge } from "@spartan-ng/helm/badge";
import { HlmToggleGroupImports } from "@spartan-ng/helm/toggle-group";

import { AdminApiService } from "../admin-api.service";
import {
  checkLabel,
  checkTone,
  passedOverLine,
  stepLine,
  toolOutcomeLabel,
  toolTone,
  type Tone,
} from "../answer-trace";
import { FormSkeletonComponent } from "../components/load-state.component";
import type { ConversationFilter, ConversationRow, ToolOutcome } from "../assistant-types";
import { FreezeCaseComponent } from "./freeze-case.component";

const FILTERS: { id: ConversationFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "down", label: "Thumbs down" },
  { id: "unknown", label: "Didn't know" },
  { id: "failed", label: "Failed" },
  { id: "dropped", label: "Invented citations" },
  { id: "flagged", label: "Flagged" },
];

const TONE_CLASS: Record<Tone, string> = {
  ok: "text-muted-foreground",
  warn: "text-accent-orange",
  bad: "text-destructive",
};

/**
 * What visitors asked and what they got, redacted (no emails, phone numbers
 * or IPs) and kept 90 days. "Didn't know" lists answers that admitted the
 * portfolio has no answer — the candidates for an FAQ entry; "Flagged", the
 * ones a deterministic check marked (uncited, wrong language, a fallback…).
 * Each answer opens into its timeline: every step's model (and the ones
 * passed over), its tools with their outcomes, and the citations kept or
 * dropped.
 */
@Component({
  selector: "app-assistant-conversations",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DecimalPipe,
    FormSkeletonComponent,
    FreezeCaseComponent,
    HlmBadge,
    HlmToggleGroupImports,
  ],
  host: { class: "block" },
  template: `
    <div class="flex flex-col gap-4">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <div
          hlmToggleGroup
          type="single"
          variant="outline"
          size="sm"
          aria-label="Conversation filter"
          [nullable]="false"
          [value]="filter()"
          (valueChange)="onFilter($event)"
        >
          @for (option of filters; track option.id) {
            <button hlmToggleGroupItem type="button" [value]="option.id">{{ option.label }}</button>
          }
        </div>
        <label class="flex items-center gap-2 text-xs text-muted-foreground">
          <input type="checkbox" [checked]="source() === 'playground'" (change)="toggleSource()" />
          Playground instead of visitors
        </label>
      </div>

      @if (loading()) {
        <app-form-skeleton kind="list" [rows]="3" label="Loading conversations…" />
      } @else {
        <ul class="m-0 flex list-none flex-col gap-3 p-0" role="list">
          @for (row of rows(); track row.id) {
            <li class="flex flex-col gap-2 rounded-lg border border-border p-4 text-sm">
              <div class="flex flex-wrap items-baseline justify-between gap-2">
                <p class="m-0 font-medium">{{ row.question }}</p>
                <p class="m-0 font-mono text-xs text-muted-foreground">
                  {{ when(row.createdAt) }} · {{ row.locale.toUpperCase() }} · session
                  {{ row.session }}
                </p>
              </div>
              <p class="m-0 whitespace-pre-wrap text-foreground/85">
                {{ row.answer || "(no answer)" }}
              </p>
              <div
                class="flex flex-wrap items-center gap-2 font-mono text-xs text-muted-foreground"
              >
                <span hlmBadge variant="outline">{{ row.model ?? "no model" }}</span>
                <span hlmBadge variant="outline">{{ row.route }}</span>
                @if (row.finishReason.startsWith("error") || row.finishReason === "aborted") {
                  <span hlmBadge variant="destructive">{{ row.finishReason }}</span>
                }
                @if (row.feedback === 1) {
                  <span hlmBadge>+1</span>
                } @else if (row.feedback === -1) {
                  <span hlmBadge variant="destructive">−1</span>
                }
                @for (flag of row.checks?.flags ?? []; track flag) {
                  <span
                    hlmBadge
                    [variant]="checkTone(flag) === 'bad' ? 'destructive' : 'outline'"
                    >{{ checkLabel(flag) }}</span
                  >
                }
                <span>first token {{ row.ttftMs ?? "–" }} ms · total {{ row.totalMs }} ms</span>
                <span>
                  {{ row.tokens.input | number }} in ({{
                    row.tokens.input
                      ? ((row.tokens.cached / row.tokens.input) * 100 | number: "1.0-0")
                      : 0
                  }}
                  % cached) · {{ row.tokens.output | number }} out · \${{
                    row.usd | number: "1.4-5"
                  }}
                </span>
                @if (row.toolCalls.length) {
                  <span>tools: {{ row.toolCalls.join(", ") }}</span>
                }
                @if (row.attempts.length > 1) {
                  <span>attempts: {{ attempts(row) }}</span>
                }
              </div>
              @if (row.citedIds.length) {
                <p class="m-0 font-mono text-xs text-muted-foreground">
                  cited: {{ row.citedIds.join(", ") }}
                </p>
              }
              @if (row.droppedCitations.length) {
                <p class="m-0 font-mono text-xs text-destructive">
                  dropped (invented, never shown): {{ row.droppedCitations.join(", ") }}
                </p>
              }
              @if (source() === "terminal") {
                <app-freeze-case [message]="row" />
              }
              @if (row.trace?.steps.length) {
                @let steps = row.trace!.steps;
                <details class="rounded-md border border-border px-3 py-2">
                  <summary class="cursor-pointer font-mono text-xs text-muted-foreground">
                    Timeline · {{ steps.length }} {{ steps.length === 1 ? "step" : "steps" }}
                  </summary>
                  <ol
                    class="m-0 mt-2 flex list-none flex-col gap-2 p-0 font-mono text-xs"
                    role="list"
                  >
                    @for (step of steps; track $index) {
                      <li class="flex flex-col gap-1">
                        <p class="m-0">
                          <span class="text-muted-foreground">{{ $index + 1 }}.</span>
                          {{ stepLine(step) }}
                        </p>
                        @if (passedOverLine(step); as passed) {
                          <p class="m-0 pl-4 text-muted-foreground">passed over: {{ passed }}</p>
                        }
                        @for (tool of step.tools; track $index) {
                          <p class="m-0 break-all pl-4">
                            {{ tool.name }} {{ tool.input }} →
                            <span [class]="toneClass(tool.outcome)">{{
                              outcomeLabel(tool.outcome)
                            }}</span>
                            · {{ tool.resultChars | number }} chars
                          </p>
                        }
                      </li>
                    }
                  </ol>
                </details>
              }
            </li>
          } @empty {
            <li class="text-sm text-muted-foreground">Nothing here.</li>
          }
        </ul>
      }
    </div>
  `,
})
export class AssistantConversationsComponent implements OnInit {
  private readonly api = inject(AdminApiService);

  protected readonly filters = FILTERS;
  protected readonly filter = signal<ConversationFilter>("all");
  protected readonly source = signal<"terminal" | "playground">("terminal");
  protected readonly rows = signal<ConversationRow[]>([]);
  protected readonly loading = signal(true);

  ngOnInit(): void {
    void this.load();
  }

  protected onFilter(value: unknown): void {
    const filter = FILTERS.find((f) => f.id === value)?.id;
    if (filter) this.setFilter(filter);
  }

  protected setFilter(filter: ConversationFilter): void {
    this.filter.set(filter);
    void this.load();
  }

  protected toggleSource(): void {
    this.source.update((s) => (s === "terminal" ? "playground" : "terminal"));
    void this.load();
  }

  async load(): Promise<void> {
    this.loading.set(true);
    const result = await this.api.assistantConversations(this.filter(), this.source());
    this.loading.set(false);
    if (result.ok) this.rows.set(result.data.messages);
    else toast.error("Could not load conversations", { description: result.error });
  }

  protected when(iso: string): string {
    return new Date(iso).toLocaleString();
  }

  protected attempts(row: ConversationRow): string {
    return row.attempts.map((a) => `${a.model} ${a.outcome}`).join(" → ");
  }

  protected readonly stepLine = stepLine;
  protected readonly passedOverLine = passedOverLine;
  protected readonly outcomeLabel = toolOutcomeLabel;
  protected readonly checkLabel = checkLabel;
  protected readonly checkTone = checkTone;

  protected toneClass(outcome: ToolOutcome): string {
    return TONE_CLASS[toolTone(outcome)];
  }
}
