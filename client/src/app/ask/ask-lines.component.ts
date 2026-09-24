import { ChangeDetectionStrategy, Component, inject, input } from "@angular/core";
import { Router } from "@angular/router";

import type { OutLine } from "./commands";

/** What a shell command printed: plain lines, two-column rows, links. */
@Component({
  selector: "app-ask-lines",
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: "block" },
  // Whitespace-sensitive (pre-wrap): the markup must not gain spaces between its parts.
  template: `
    @for (line of lines(); track $index) {
      <!-- prettier-ignore -->
      <p class="m-0 whitespace-pre-wrap wrap-break-word" [class]="toneClass(line)">@if (line.label) {<span class="inline-block min-w-[16ch] pr-3 text-accent-orange">{{ line.label }}</span>}@if (line.href) {<a class="underline decoration-border underline-offset-4 hover:decoration-accent-orange" [href]="line.href" (click)="follow($event, line)">{{ line.text }}</a>} @else {<ng-container>{{ line.text }}</ng-container>}</p>
    }
  `,
})
export class AskLinesComponent {
  readonly lines = input.required<OutLine[]>();
  private readonly router = inject(Router);

  protected toneClass(line: OutLine): string {
    switch (line.tone) {
      case "dim":
        return "text-muted-foreground";
      case "accent":
        return "text-accent-orange";
      case "error":
        return "text-destructive";
      default:
        return "text-foreground/85";
    }
  }

  /** Site pages open in the app (keeping the view transition); files and modified clicks as usual. */
  protected follow(event: MouseEvent, line: OutLine): void {
    if (!line.internal || event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0)
      return;
    event.preventDefault();
    void this.router.navigateByUrl(line.href!);
  }
}
