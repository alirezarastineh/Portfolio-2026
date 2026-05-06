import { ChangeDetectionStrategy, Component, input } from "@angular/core";

@Component({
  selector: "app-terminal-window",
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: "block w-full",
  },
  template: `
    <div
      class="overflow-hidden rounded-xl border border-border bg-card shadow-[0_1px_0_0_oklch(1_0_0/4%)_inset,0_20px_60px_-20px_oklch(0_0_0/60%)]"
    >
      <header
        class="grid grid-cols-[auto_auto_auto_1fr_auto] items-center gap-2 border-b border-border bg-[linear-gradient(180deg,oklch(0.18_0_0)_0%,oklch(0.13_0_0)_100%)] px-3.5 py-2.5"
      >
        <span class="inline-block size-3 rounded-full bg-[#ff5f56]" aria-hidden="true"></span>
        <span class="inline-block size-3 rounded-full bg-[#ffbd2e]" aria-hidden="true"></span>
        <span class="inline-block size-3 rounded-full bg-[#27c93f]" aria-hidden="true"></span>
        <span class="justify-self-center text-center font-mono text-xs text-muted-foreground">{{
          title()
        }}</span>
        <span class="w-[calc(12px*3+0.5rem*2)]" aria-hidden="true"></span>
      </header>
      <div class="px-6 py-5 font-mono text-sm leading-[1.7] text-foreground">
        <ng-content />
      </div>
    </div>
  `,
})
export class TerminalWindowComponent {
  readonly title = input<string>("user@portfolio — zsh");
}
