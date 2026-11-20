import {
  afterRenderEffect,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  signal,
  untracked,
  viewChild,
  type OnInit,
} from "@angular/core";
import { toSignal } from "@angular/core/rxjs-interop";
import { ActivatedRoute, Router, RouterLink } from "@angular/router";
import type { RouteMeta } from "@analogjs/router";
import { HlmBadge } from "@spartan-ng/helm/badge";
import { HlmButton } from "@spartan-ng/helm/button";
import { map } from "rxjs";

import { VIEWS, viewOf, viewParam, type AssistantView } from "../../admin/assistant-views";
import { AdminPageHeaderComponent } from "../../admin/components/page-header.component";
import { AdminPulseService } from "../../admin/pulse.service";
import { RecoveryService } from "../../admin/recovery.service";
import { unsavedChangesGuard } from "../../admin/unsaved-changes.service";

import { AssistantConversationsComponent } from "../../admin/assistant/assistant-conversations.component";
import { AssistantCopilotComponent } from "../../admin/assistant/assistant-copilot.component";
import { AssistantEvalCasesComponent } from "../../admin/assistant/assistant-eval-cases.component";
import { AssistantEvalsComponent } from "../../admin/assistant/assistant-evals.component";
import { AssistantFaithfulnessComponent } from "../../admin/assistant/assistant-faithfulness.component";
import { AssistantFaqComponent } from "../../admin/assistant/assistant-faq.component";
import { AssistantInsightsComponent } from "../../admin/assistant/assistant-insights.component";
import { AssistantJournalComponent } from "../../admin/assistant/assistant-journal.component";
import { AssistantOutcomesComponent } from "../../admin/assistant/assistant-outcomes.component";
import { AssistantPerceptionComponent } from "../../admin/assistant/assistant-perception.component";
import { AssistantOverviewComponent } from "../../admin/assistant/assistant-overview.component";
import { AssistantPairwiseComponent } from "../../admin/assistant/assistant-pairwise.component";
import { AssistantReviewsComponent } from "../../admin/assistant/assistant-reviews.component";
import { AssistantRoutingComponent } from "../../admin/assistant/assistant-routing.component";
import { AssistantSettingsComponent } from "../../admin/assistant/assistant-settings.component";
import { AssistantTrustComponent } from "../../admin/assistant/assistant-trust.component";
import { PlaygroundPanelComponent } from "../../admin/assistant/playground-panel.component";

export const routeMeta: RouteMeta = { canDeactivate: [unsavedChangesGuard] };

/** Where each editor on this page lives: a copy kept in the browser opens its view. */
const VIEW_OF_EDITOR: Partial<Record<string, AssistantView>> = {
  "assistant-settings": "settings",
  faq: "questions",
  "faq-proposals": "questions",
  journal: "journal",
  "journal-lessons": "journal",
};

/**
 * The portfolio assistant ("Ask my portfolio") in seven views of one route (plan 5, U18), each
 * in the address (`?view=`): Now (what waits, its health and cost), Conversations, Reviews,
 * Questions (the FAQ and Insights), Journal, Quality (the reports and evals) and Settings (with
 * trust's rules); and the Playground's panel. All in this page's chunk: lazily loaded views cut
 * the framework's shared chunk that visitors load (+3.5 KB brotli on /en, measured 2026-11-19).
 */
@Component({
  selector: "app-admin-assistant",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    AdminPageHeaderComponent,
    AssistantConversationsComponent,
    AssistantCopilotComponent,
    AssistantEvalCasesComponent,
    AssistantEvalsComponent,
    AssistantFaithfulnessComponent,
    AssistantFaqComponent,
    AssistantInsightsComponent,
    AssistantJournalComponent,
    AssistantOutcomesComponent,
    AssistantPerceptionComponent,
    AssistantOverviewComponent,
    AssistantPairwiseComponent,
    AssistantReviewsComponent,
    AssistantRoutingComponent,
    AssistantSettingsComponent,
    AssistantTrustComponent,
    HlmBadge,
    HlmButton,
    PlaygroundPanelComponent,
    RouterLink,
  ],
  host: { class: "block" },
  template: `
    <div class="mx-auto flex max-w-4xl flex-col gap-6 pb-12">
      <app-page-header
        title="Assistant"
        description="The assistant on the home page's stage, and in its panel on every page: answers from the published portfolio, with citations."
      >
        <span headerStatus>
          @if (pulse.assistantAlert(); as alert) {
            <span hlmBadge variant="destructive">
              needs a look<span class="sr-only">: {{ alert }}</span>
            </span>
          }
        </span>
        <button
          headerActions
          hlmBtn
          type="button"
          variant="outline"
          size="sm"
          (click)="pulse.playgroundOpen.set(true)"
        >
          Playground
        </button>
      </app-page-header>

      <!-- Links, not tabs: each view has its address, so Back, a reload and a bookmark find it. On a
           phone the row scrolls sideways; Firefox would make the scroller a Tab stop of its own, which
           the links make needless (each scrolls itself into view). -->
      <nav
        #row
        aria-label="Assistant views"
        tabindex="-1"
        class="relative -mt-2 overflow-x-auto border-b border-border scrollbar-none"
      >
        <ul class="m-0 flex w-max list-none p-0" role="list">
          @for (option of views; track option.id) {
            <li>
              <a
                routerLink="/admin/assistant"
                [queryParams]="{ view: param(option.id) }"
                [attr.aria-current]="option.id === view() ? 'true' : null"
                class="flex h-9 touch-manipulation items-center border-y-2 border-transparent px-3 text-sm whitespace-nowrap text-muted-foreground transition-colors hover:text-foreground focus-visible:-outline-offset-2 aria-current:border-b-foreground aria-current:text-foreground pointer-coarse:h-11"
                >{{ option.label }}</a
              >
            </li>
          }
        </ul>
      </nav>

      <!-- The Playground: the header's button and Find open it; it keeps its conversation across views. -->
      <app-playground-panel
        [open]="pulse.playgroundOpen()"
        (openChange)="pulse.playgroundOpen.set($event)"
      />

      @switch (view()) {
        @case ("now") {
          <div class="flex flex-col gap-8">
            <app-assistant-trust part="waiting" />
            <app-assistant-overview class="flex flex-col gap-6" (toInsights)="go('questions')" />
          </div>
        }
        @case ("conversations") {
          <app-assistant-conversations (toJournal)="openJournal($event)" />
        }
        @case ("reviews") {
          <app-assistant-reviews />
        }
        @case ("questions") {
          <div class="flex flex-col gap-8">
            <app-assistant-faq
              [seed]="faqSeed()"
              [proposal]="faqProposal()"
              (seedTaken)="faqSeed.set(null)"
            />
            <app-assistant-insights
              (toFaq)="faqSeed.set($event)"
              (toFaqProposal)="openFaqProposal($event)"
              (toJournal)="go('journal')"
            />
          </div>
        }
        @case ("journal") {
          <app-assistant-journal
            [focus]="journalFocus()"
            (toFaqProposal)="openFaqProposal($event)"
          />
        }
        @case ("quality") {
          <div class="flex flex-col gap-8">
            <app-assistant-evals />
            <app-assistant-pairwise />
            <app-assistant-eval-cases />
            <app-assistant-copilot />
            <app-assistant-faithfulness />
            <app-assistant-perception />
            <app-assistant-routing />
            <app-assistant-outcomes />
          </div>
        }
        @case ("settings") {
          <div class="flex flex-col gap-8">
            <app-assistant-settings />
            <app-assistant-trust part="rules" />
          </div>
        }
      }
    </div>
  `,
})
export default class AdminAssistantPage implements OnInit {
  protected readonly pulse = inject(AdminPulseService);
  private readonly recovery = inject(RecoveryService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly row = viewChild<ElementRef<HTMLElement>>("row");
  private gone = false;

  protected readonly views = VIEWS;
  protected readonly param = viewParam;
  /** What the address asks for (`?view=`), as written: a view, an old tab's name, or nothing. */
  private readonly asked = toSignal(
    this.route.queryParamMap.pipe(map((params) => params.get("view"))),
    { initialValue: this.route.snapshot.queryParamMap.get("view") },
  );
  /** The view shown: the address's, or Now. */
  protected readonly view = computed(() => viewOf(this.asked()));
  protected readonly faqSeed = signal<string | null>(null);
  /** An FAQ proposal just drafted from Insights or the Journal (plan phase 31): shown first. */
  protected readonly faqProposal = signal<string | null>(null);
  /** The journal entry Diagnose opened (plan phase 24). */
  protected readonly journalFocus = signal<string | null>(null);

  constructor() {
    // The panel goes with the page: the next visit starts with it closed.
    inject(DestroyRef).onDestroy(() => {
      this.gone = true;
      this.pulse.playgroundOpen.set(false);
    });
    // The address is the truth: an old tab's name, "now" or a name it does not know is rewritten
    // in place to its view's (Now has none), and the Playground's old tab opens its panel.
    effect(() => {
      const asked = this.asked();
      const param = viewParam(viewOf(asked));
      untracked(() => {
        if (asked === "playground") {
          this.pulse.playgroundOpen.set(true);
        }
        if (asked !== param) {
          void this.router.navigate([], {
            relativeTo: this.route,
            queryParams: { view: param },
            replaceUrl: true,
          });
        }
      });
    });
    // A drafted proposal takes the focus once: leaving Questions lets it go.
    effect(() => {
      if (this.view() !== "questions") {
        untracked(() => this.faqProposal.set(null));
      }
    });
    // On a phone the row scrolls: the current view's link stays in sight.
    afterRenderEffect(() => {
      this.view();
      const row = this.row()?.nativeElement;
      const link = row?.querySelector<HTMLElement>("[aria-current=true]");
      if (row && link) {
        row.scrollLeft = link.offsetLeft - (row.clientWidth - link.offsetWidth) / 2;
      }
    });
  }

  ngOnInit(): void {
    void this.recovery.list().then((copies) => {
      const view = copies.map((copy) => VIEW_OF_EDITOR[copy.editor]).find(Boolean);
      // A copy kept in this browser opens its view, unless the address chose one.
      if (view && !this.gone && this.asked() === null) {
        void this.router.navigate([], {
          relativeTo: this.route,
          queryParams: { view: viewParam(view) },
          replaceUrl: true,
        });
      }
    });
  }

  /** Opens a view as its link does: the guard asks first when typed text would be lost. */
  protected go(view: AssistantView): Promise<boolean> {
    return this.router.navigate(["/admin/assistant"], { queryParams: { view: viewParam(view) } });
  }

  protected openJournal(entry: string): void {
    this.journalFocus.set(entry);
    void this.go("journal");
  }

  protected openFaqProposal(id: string): void {
    this.faqProposal.set(id);
    if (this.view() !== "questions") {
      void this.go("questions").then((went) => {
        if (!went) {
          this.faqProposal.set(null);
        }
      });
    }
  }
}
