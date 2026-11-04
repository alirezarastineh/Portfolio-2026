import { ChangeDetectionStrategy, Component, input } from "@angular/core";

/** A status at the right of the title bar: a dot, green while `live`, and a word. */
export interface TerminalStatus {
  label: string;
  live: boolean;
}

@Component({
  selector: "app-terminal-window",
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: "block w-full",
  },
  template: `
    <div class="overflow-hidden rounded-2xl border border-border bg-card shadow-e3">
      <!-- Three cells, the outer two equal, so the title stays centred with or without a status. -->
      <header
        class="grid grid-cols-[1fr_auto_1fr] items-center gap-2 border-b border-border bg-terminal-bar px-3.5 py-2.5"
      >
        <span class="flex gap-2" aria-hidden="true">
          <span class="size-3 rounded-full bg-term-red"></span>
          <span class="size-3 rounded-full bg-term-amber"></span>
          <span class="size-3 rounded-full bg-term-green"></span>
        </span>
        <span class="text-center font-mono text-xs text-muted-foreground">{{ title() }}</span>
        <span class="inline-flex items-center gap-2 justify-self-end font-mono text-xs">
          @if (status(); as status) {
            <span class="inline-flex items-center gap-1.5 text-muted-foreground">
              <span
                class="size-1.5 rounded-full"
                [class]="status.live ? 'bg-available' : 'bg-muted-foreground'"
                aria-hidden="true"
              ></span>
              <span [class]="compact() ? 'max-sm:sr-only' : ''">{{ status.label }}</span>
            </span>
          }
          <!-- A control of the window's own, such as the sheet's close button. -->
          <ng-content select="[windowAction]" />
        </span>
      </header>
      <div class="px-6 py-5 font-mono text-sm leading-[1.7] text-foreground">
        <ng-content />
      </div>
    </div>
  `,
})
export class TerminalWindowComponent {
  readonly title = input<string>("user@portfolio — zsh");
  readonly status = input<TerminalStatus | null>(null);
  /**
   * Below sm, the status is its dot alone (the word stays for screen
   * readers): for a title bar that also holds an action.
   */
  readonly compact = input(false);
}
