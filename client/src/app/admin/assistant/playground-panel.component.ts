import { ChangeDetectionStrategy, Component, input, output } from "@angular/core";
import { HlmSheetImports } from "@spartan-ng/helm/sheet";

import { AssistantPlaygroundComponent, PlaygroundSession } from "./assistant-playground.component";

/**
 * The Playground as a panel in the Assistant's page (plan 5, U18): its header and Find open it (Find
 * goes to the Assistant first from any other page). The conversation lives in `PlaygroundSession`, so
 * closing the panel or switching views keeps it.
 */
@Component({
  selector: "app-playground-panel",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AssistantPlaygroundComponent, HlmSheetImports],
  providers: [PlaygroundSession],
  template: `
    <hlm-sheet
      side="right"
      [autoFocus]="coarse ? 'first-tabbable' : '#playground-question'"
      [state]="open() ? 'open' : 'closed'"
      (stateChanged)="onState($event)"
    >
      <hlm-sheet-content *hlmSheetPortal="let ctx" class="w-full gap-0 sm:max-w-xl">
        <div class="flex shrink-0 flex-col gap-1 border-b border-border py-4 pl-4 pr-14">
          <h2 hlmSheetTitle class="m-0 text-section-title">Playground</h2>
          <p hlmSheetDescription class="m-0 text-hint text-muted-foreground">
            Ask the draft what visitors would get after the next publish. Each question is a paid
            call.
          </p>
        </div>
        <app-assistant-playground class="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4" />
      </hlm-sheet-content>
    </hlm-sheet>
  `,
})
export class PlaygroundPanelComponent {
  /** On touch the panel opens without raising the keyboard over it. */
  protected readonly coarse =
    typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
  readonly open = input(false);
  readonly openChange = output<boolean>();

  protected onState(state: string): void {
    // The sheet reports "closed" again once its state input follows: only the first is a request.
    if (state === "closed" && this.open()) {
      this.openChange.emit(false);
    }
  }
}
