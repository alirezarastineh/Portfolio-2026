import { DecimalPipe } from "@angular/common";
import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from "@angular/core";
import { toast } from "@spartan-ng/brain/sonner";
import { HlmBadge } from "@spartan-ng/helm/badge";
import { HlmSkeleton } from "@spartan-ng/helm/skeleton";
import { HlmTabsImports } from "@spartan-ng/helm/tabs";

import { AdminApiService } from "../admin-api.service";
import type { ConversationFilter, ConversationRow } from "../assistant-types";

const FILTERS: { id: ConversationFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "down", label: "Thumbs down" },
  { id: "unknown", label: "Didn't know" },
  { id: "failed", label: "Failed" },
];

/**
 * What visitors asked and what they got, redacted (no emails, phone numbers
 * or IPs) and kept 90 days. "Didn't know" lists answers that admitted the
 * portfolio has no answer — the candidates for an FAQ entry.
 */
@Component({
  selector: "app-assistant-conversations",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DecimalPipe, HlmBadge, HlmSkeleton, HlmTabsImports],
  host: { class: "block" },
  template: `
    <div class="flex flex-col gap-4">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <div hlmTabs [tab]="filter()" (tabActivated)="setFilter($any($event))">
          <div hlmTabsList aria-label="Conversation filter">
            @for (option of filters; track option.id) {
              <button [hlmTabsTrigger]="option.id">{{ option.label }}</button>
            }
          </div>
        </div>
        <label class="flex items-center gap-2 text-xs text-muted-foreground">
          <input type="checkbox" [checked]="source() === 'playground'" (change)="toggleSource()" />
          Playground instead of visitors
        </label>
      </div>

      @if (loading()) {
        <hlm-skeleton class="h-64 w-full" />
      } @else {
        <ul class="m-0 flex list-none flex-col gap-3 p-0" role="list">
          @for (row of rows(); track row.id) {
            <li class="flex flex-col gap-2 rounded-lg border border-border p-4 text-sm">
              <div class="flex flex-wrap items-baseline justify-between gap-2">
                <p class="m-0 font-medium">{{ row.question }}</p>
                <p class="m-0 font-mono text-[0.7rem] text-muted-foreground">
                  {{ when(row.createdAt) }} · {{ row.locale.toUpperCase() }} · session
                  {{ row.session }}
                </p>
              </div>
              <p class="m-0 whitespace-pre-wrap text-foreground/85">
                {{ row.answer || "(no answer)" }}
              </p>
              <div
                class="flex flex-wrap items-center gap-2 font-mono text-[0.68rem] text-muted-foreground"
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
                <p class="m-0 font-mono text-[0.68rem] text-muted-foreground">
                  cited: {{ row.citedIds.join(", ") }}
                </p>
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
}
