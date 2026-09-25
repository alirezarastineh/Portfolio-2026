import { ChangeDetectionStrategy, Component, inject, signal } from "@angular/core";
import type { RouteMeta } from "@analogjs/router";
import { HlmTabsImports } from "@spartan-ng/helm/tabs";

import { ConfirmService } from "../../admin/components/confirm-dialog.component";
import { UnsavedChangesService, unsavedChangesGuard } from "../../admin/unsaved-changes.service";

import { AssistantConversationsComponent } from "../../admin/assistant/assistant-conversations.component";
import { AssistantEvalsComponent } from "../../admin/assistant/assistant-evals.component";
import { AssistantFaqComponent } from "../../admin/assistant/assistant-faq.component";
import { AssistantInsightsComponent } from "../../admin/assistant/assistant-insights.component";
import { AssistantOverviewComponent } from "../../admin/assistant/assistant-overview.component";
import { AssistantPlaygroundComponent } from "../../admin/assistant/assistant-playground.component";
import { AssistantSettingsComponent } from "../../admin/assistant/assistant-settings.component";

type Tab = "overview" | "settings" | "faq" | "conversations" | "insights" | "playground" | "evals";

export const routeMeta: RouteMeta = { canDeactivate: [unsavedChangesGuard] };

const TABS: { id: Tab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "settings", label: "Settings" },
  { id: "faq", label: "FAQ" },
  { id: "conversations", label: "Conversations" },
  { id: "insights", label: "Insights" },
  { id: "playground", label: "Playground" },
  { id: "evals", label: "Evals" },
];

/**
 * The portfolio assistant ("Ask my portfolio"): health and cost, its
 * settings, the FAQ it cites, what visitors asked, a playground against the
 * draft, and the eval suite.
 */
@Component({
  selector: "app-admin-assistant",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    AssistantConversationsComponent,
    AssistantEvalsComponent,
    AssistantFaqComponent,
    AssistantInsightsComponent,
    AssistantOverviewComponent,
    AssistantPlaygroundComponent,
    AssistantSettingsComponent,
    HlmTabsImports,
  ],
  host: { class: "block" },
  template: `
    <div class="mx-auto flex max-w-4xl flex-col gap-6 pb-12">
      <header>
        <h1 class="m-0 font-mono text-2xl tracking-tight">Assistant</h1>
        <p class="mt-1 text-sm text-muted-foreground">
          The About terminal's AI: answers from the published portfolio, with citations.
        </p>
      </header>

      <div hlmTabs [tab]="strip()" (tabActivated)="select($any($event))">
        <div hlmTabsList aria-label="Assistant sections" class="flex-wrap">
          @for (option of tabs; track option.id) {
            <button [hlmTabsTrigger]="option.id">{{ option.label }}</button>
          }
        </div>
      </div>

      @switch (tab()) {
        @case ("overview") {
          <app-assistant-overview class="flex flex-col gap-6" />
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
        @case ("insights") {
          <app-assistant-insights (toFaq)="toFaq($event)" />
        }
        @case ("playground") {
          <app-assistant-playground />
        }
        @case ("evals") {
          <app-assistant-evals />
        }
      }
    </div>
  `,
})
export default class AdminAssistantPage {
  private readonly unsaved = inject(UnsavedChangesService);
  private readonly confirm = inject(ConfirmService);

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
