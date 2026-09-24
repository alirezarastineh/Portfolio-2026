import { ChangeDetectionStrategy, Component, inject, output, signal } from "@angular/core";
import { toast } from "@spartan-ng/brain/sonner";
import { HlmBadge } from "@spartan-ng/helm/badge";
import { HlmButton } from "@spartan-ng/helm/button";
import { HlmSpinner } from "@spartan-ng/helm/spinner";

import { AdminApiService } from "../admin-api.service";
import type { InsightTopic } from "../assistant-types";

/**
 * What visitors keep asking, grouped into topics by one model call over the
 * last 30 days of questions (redacted), and what the assistant could not
 * answer. Cached for a while; each topic can become an FAQ entry.
 */
@Component({
  selector: "app-assistant-insights",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [HlmBadge, HlmButton, HlmSpinner],
  host: { class: "block" },
  template: `
    <div class="flex flex-col gap-4">
      <div class="flex flex-wrap items-center gap-3">
        <button hlmBtn size="sm" [disabled]="loading()" (click)="analyse(false)">
          @if (loading()) {
            <hlm-spinner class="size-4" />
          } @else {
            Analyse visitor questions
          }
        </button>
        @if (topics() !== null) {
          <button hlmBtn variant="ghost" size="sm" [disabled]="loading()" (click)="analyse(true)">
            Refresh
          </button>
          <span class="text-xs text-muted-foreground">
            {{ analysed() }} question(s){{ cached() ? " · cached" : "" }}
          </span>
        }
      </div>
      <p class="m-0 text-xs text-muted-foreground">
        One model call (a fraction of a cent), counted toward the daily budget.
      </p>

      @if (topics(); as list) {
        <ul class="m-0 flex list-none flex-col gap-3 p-0" role="list">
          @for (topic of list; track topic.title) {
            <li class="flex flex-col gap-2 rounded-lg border border-border p-4 text-sm">
              <div class="flex flex-wrap items-center gap-2">
                <strong class="font-medium">{{ topic.title }}</strong>
                <span hlmBadge variant="outline" class="font-mono text-[0.65rem]"
                  >{{ topic.questions }}×</span
                >
                @if (topic.unanswered) {
                  <span hlmBadge variant="destructive" class="font-mono text-[0.65rem]"
                    >not answered</span
                  >
                }
              </div>
              <p class="m-0 text-muted-foreground">{{ topic.summary }}</p>
              <ul class="m-0 list-disc pl-5 text-foreground/85">
                @for (example of topic.examples; track $index) {
                  <li>{{ example }}</li>
                }
              </ul>
              <div>
                <button
                  hlmBtn
                  variant="outline"
                  size="sm"
                  (click)="toFaq.emit(topic.examples[0] ?? topic.title)"
                >
                  Turn into FAQ entry
                </button>
              </div>
            </li>
          } @empty {
            <li class="text-sm text-muted-foreground">No visitor questions in the last 30 days.</li>
          }
        </ul>
      }
    </div>
  `,
})
export class AssistantInsightsComponent {
  readonly toFaq = output<string>();

  private readonly api = inject(AdminApiService);
  protected readonly topics = signal<InsightTopic[] | null>(null);
  protected readonly analysed = signal(0);
  protected readonly cached = signal(false);
  protected readonly loading = signal(false);

  protected async analyse(refresh: boolean): Promise<void> {
    this.loading.set(true);
    const result = await this.api.assistantInsights(refresh);
    this.loading.set(false);
    if (!result.ok) {
      toast.error("No insights", { description: result.error });
      return;
    }
    this.topics.set(result.data.topics);
    this.analysed.set(result.data.analysed);
    this.cached.set(!!result.data.cached);
  }
}
