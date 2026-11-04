import { ChangeDetectionStrategy, Component, inject, input, output } from "@angular/core";
import { Router } from "@angular/router";

import { AskLauncherService } from "./ask-launcher.service";
import { labelCommands, type LabelCommand, type OutLine } from "./commands";

/**
 * What a shell command printed: plain lines, two-column rows, links, and lines that ask. A help
 * row's commands are buttons: they run, or wait in the prompt for the word they need.
 */
@Component({
  selector: "app-ask-lines",
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: "block" },
  // Whitespace-sensitive (pre-wrap): the markup must not gain spaces between its parts.
  template: `
    @for (line of lines(); track $index) {
      <!-- prettier-ignore -->
      <p class="line" [class]="line.tone" [class.row]="!!line.label">@if (line.label) {<span class="label">@if (line.run) {@for (part of commands(line.label); track part.text) {<button type="button" class="action command" translate="no" (click)="use(part)">{{ part.text }}</button>}} @else {<ng-container>{{ line.label }}</ng-container>}</span>}@if (line.ask) {<button type="button" class="action" (click)="ask.emit(line.ask)">{{ line.text }}</button>} @else if (line.href) {<a class="link" [href]="line.href" (click)="follow($event, line)">{{ line.text }}</a>} @else {<ng-container>{{ line.text }}</ng-container>}</p>
    }
  `,
  styles: `
    .line {
      margin: 0;
      color: var(--foreground);
      font-size: 0.9375rem;
      line-height: 1.6;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }
    /* A label beside its text, which wraps in a column of its own. */
    .row {
      display: grid;
      grid-template-columns: minmax(0, max-content) minmax(0, 1fr);
      align-items: baseline;
      column-gap: 0.75rem;
    }
    .dim {
      color: var(--muted-foreground);
    }
    .accent {
      color: var(--accent-orange);
    }
    .error {
      color: var(--destructive);
    }
    .label {
      min-width: 16ch;
      color: var(--muted-foreground);
      font-family: var(--font-mono);
      font-size: 0.8125rem;
    }
    .action {
      min-height: 1.5rem;
      color: var(--accent-orange);
      text-align: left;
      text-decoration: underline;
      text-decoration-color: var(--border-strong);
      text-underline-offset: 0.25em;
      cursor: pointer;
    }
    .action:hover,
    .link:hover {
      text-decoration-color: var(--accent-orange);
    }
    .command {
      font-family: var(--font-mono);
      font-size: 0.8125rem;
    }
    .command + .command {
      margin-left: 1ch;
    }
    .link {
      text-decoration: underline;
      text-decoration-color: var(--border-strong);
      text-underline-offset: 0.25em;
    }
    @media (width < 40rem) {
      .label {
        min-width: 8ch;
      }
    }
    @media (pointer: coarse) {
      .action {
        min-height: 2.75rem;
      }
    }
  `,
})
export class AskLinesComponent {
  readonly lines = input.required<OutLine[]>();
  /** A line's question or command, asked or run. */
  readonly ask = output<string>();
  /** A command that needs a word of the visitor's, for the prompt. */
  readonly fill = output<string>();
  private readonly router = inject(Router);
  private readonly launcher = inject(AskLauncherService);

  protected readonly commands = labelCommands;

  protected use(part: LabelCommand): void {
    (part.run ? this.ask : this.fill).emit(part.command);
  }

  /** Site pages open in the app (keeping the view transition); files and modified clicks as usual. */
  protected follow(event: MouseEvent, line: OutLine): void {
    if (!line.internal || event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0)
      return;
    event.preventDefault();
    this.launcher.closeIfSheet();
    void this.router.navigateByUrl(line.href!);
  }
}
