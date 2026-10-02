import { ChangeDetectionStrategy, Component, inject, signal } from "@angular/core";
import type { RouteMeta } from "@analogjs/router";
import { BrnTabsContent } from "@spartan-ng/brain/tabs";
import { HlmTabsImports } from "@spartan-ng/helm/tabs";

import { HlmBadge } from "@spartan-ng/helm/badge";

import { ConfirmService } from "../../admin/components/confirm-dialog.component";
import { AdminPageHeaderComponent } from "../../admin/components/page-header.component";
import { AdminPulseService } from "../../admin/pulse.service";
import { UnsavedChangesService, unsavedChangesGuard } from "../../admin/unsaved-changes.service";

import { AssistantConversationsComponent } from "../../admin/assistant/assistant-conversations.component";
import { AssistantEvalCasesComponent } from "../../admin/assistant/assistant-eval-cases.component";
import { AssistantEvalsComponent } from "../../admin/assistant/assistant-evals.component";
import { AssistantFaqComponent } from "../../admin/assistant/assistant-faq.component";
import { AssistantInsightsComponent } from "../../admin/assistant/assistant-insights.component";
import { AssistantOutcomesComponent } from "../../admin/assistant/assistant-outcomes.component";
import { AssistantOverviewComponent } from "../../admin/assistant/assistant-overview.component";
import { AssistantPairwiseComponent } from "../../admin/assistant/assistant-pairwise.component";
import { AssistantPlaygroundComponent } from "../../admin/assistant/assistant-playground.component";
import { AssistantReviewsComponent } from "../../admin/assistant/assistant-reviews.component";
import { AssistantSettingsComponent } from "../../admin/assistant/assistant-settings.component";
import { AssistantTrustComponent } from "../../admin/assistant/assistant-trust.component";

type Tab =
  | "overview"
  | "settings"
  | "faq"
  | "conversations"
  | "reviews"
  | "insights"
  | "playground"
  | "evals"
  | "trust";

export const routeMeta: RouteMeta = { canDeactivate: [unsavedChangesGuard] };

const TABS: { id: Tab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "settings", label: "Settings" },
  { id: "faq", label: "FAQ" },
  { id: "conversations", label: "Conversations" },
  { id: "reviews", label: "Reviews" },
  { id: "insights", label: "Insights" },
  { id: "playground", label: "Playground" },
  { id: "evals", label: "Evals" },
  { id: "trust", label: "Trust" },
];

/**
 * The portfolio assistant ("Ask my portfolio"): health and cost, its
 * settings, the FAQ it cites, what visitors asked and their weekly review, a
 * playground against the draft, the eval suite and pairwise comparisons, and
 * trust: what may act, what was demoted, the alerts and the audit log.
 */
@Component({
  selector: "app-admin-assistant",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    AdminPageHeaderComponent,
    AssistantConversationsComponent,
    AssistantEvalCasesComponent,
    AssistantEvalsComponent,
    AssistantFaqComponent,
    AssistantInsightsComponent,
    AssistantOutcomesComponent,
    AssistantOverviewComponent,
    AssistantPairwiseComponent,
    AssistantPlaygroundComponent,
    AssistantReviewsComponent,
    AssistantSettingsComponent,
    AssistantTrustComponent,
    BrnTabsContent,
    HlmBadge,
    HlmTabsImports,
  ],
  host: { class: "block" },
  template: `
    <div class="mx-auto flex max-w-4xl flex-col gap-6 pb-12">
      <app-page-header
        title="Assistant"
        description="The About terminal's AI: answers from the published portfolio, with citations."
      >
        <span headerStatus>
          @if (pulse.assistantAlert(); as alert) {
            <span hlmBadge variant="destructive" class="font-mono">
              needs a look<span class="sr-only">: {{ alert }}</span>
            </span>
          }
        </span>
      </app-page-header>

      <div hlmTabs class="min-w-0 gap-6" [tab]="strip()" (tabActivated)="select($any($event))">
        <!-- One row that scrolls, with arrows where it overflows: nine tabs wrapped onto two rows below md. -->
        <hlm-paginated-tabs-list tabListLabel="Assistant sections">
          @for (option of tabs; track option.id) {
            <button [hlmTabsTrigger]="option.id">{{ option.label }}</button>
          }
        </hlm-paginated-tabs-list>

        <!-- A panel per tab, for the tabs to point at; only the shown one holds its section. -->
        @for (option of tabs; track option.id) {
          <div [brnTabsContent]="option.id">
            @if (option.id === tab()) {
              @switch (tab()) {
                @case ("overview") {
                  <div class="flex flex-col gap-8">
                    <app-assistant-overview
                      class="flex flex-col gap-6"
                      (toTrust)="select('trust')"
                    />
                    <app-assistant-outcomes />
                  </div>
                }
                @case ("settings") {
                  <app-assistant-settings />
                }
                @case ("faq") {
                  <app-assistant-faq [seed]="faqSeed()" (seedTaken)="faqSeed.set(null)" />
                }
                @case ("conversations") {
                  <app-assistant-conversations />
                }
                @case ("reviews") {
                  <app-assistant-reviews />
                }
                @case ("insights") {
                  <app-assistant-insights (toFaq)="toFaq($event)" />
                }
                @case ("playground") {
                  <app-assistant-playground />
                }
                @case ("evals") {
                  <div class="flex flex-col gap-8">
                    <app-assistant-evals />
                    <app-assistant-pairwise />
                    <app-assistant-eval-cases />
                  </div>
                }
                @case ("trust") {
                  <app-assistant-trust />
                }
              }
            }
          </div>
        }
      </div>
    </div>
  `,
})
export default class AdminAssistantPage {
  private readonly unsaved = inject(UnsavedChangesService);
  private readonly confirm = inject(ConfirmService);
  protected readonly pulse = inject(AdminPulseService);

  protected readonly tabs = TABS;
  /** The section shown; the settings tab's edits die with it on a switch. */
  protected readonly tab = signal<Tab>("overview");
  /** The tab strip's own state, put back when a switch is refused. */
  protected readonly strip = signal<Tab>("overview");
  protected readonly faqSeed = signal<string | null>(null);

  protected async select(next: Tab): Promise<void> {
    const current = this.tab();
    if (next === current) return;
    this.strip.set(next);
    if (this.unsaved.hasAny()) {
      const leave = await this.confirm.ask({
        title: "Discard unsaved changes?",
        description: "The settings have edits that have not been saved. Switching loses them.",
        confirmLabel: "Discard and switch",
        cancelLabel: "Stay",
        destructive: true,
      });
      if (!leave) {
        this.strip.set(current);
        return;
      }
      this.unsaved.clearAll();
    }
    this.tab.set(next);
  }

  protected toFaq(question: string): void {
    this.faqSeed.set(question);
    void this.select("faq");
  }
}
