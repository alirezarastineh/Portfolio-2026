import {
  afterRenderEffect,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  inject,
  viewChild,
} from "@angular/core";

import { TerminalWindowComponent } from "../components/terminal-window.component";
import { LanguageService } from "../services/language.service";
import { AskLauncherService } from "./ask-launcher.service";
import { AskStore } from "./ask.store";
import { TerminalShellComponent } from "./terminal-shell.component";

/**
 * The assistant on pages without the About terminal: the same shell and
 * conversation in a modal dialog, opened by the floating `>_` button or the
 * palette's "Ask AI…". A panel at the bottom right; full width on phones. Esc, the close button or a click outside closes it.
 */
@Component({
  selector: "app-ask-sheet",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TerminalShellComponent, TerminalWindowComponent],
  template: `
    <dialog
      #dialog
      class="ask-sheet m-0 max-h-none max-w-none bg-transparent p-0 backdrop:bg-background/60 backdrop:backdrop-blur-sm"
      [attr.aria-label]="lang.t().ask.title"
      (close)="launcher.closeSheet()"
      (click)="onBackdrop($event)"
    >
      <app-terminal-window [title]="lang.t().ask.title">
        <button
          type="button"
          class="absolute right-3 top-1.5 cursor-pointer rounded-md px-2 py-1 font-mono text-xs text-muted-foreground hover:text-foreground"
          [attr.aria-label]="store.copy().close"
          (click)="launcher.closeSheet()"
        >
          esc
        </button>
        <app-terminal-shell [inSheet]="true" />
      </app-terminal-window>
    </dialog>
  `,
  styles: `
    .ask-sheet {
      position: fixed;
      inset: auto 1rem 1rem auto;
      width: min(40rem, calc(100vw - 2rem));
      max-height: calc(100dvh - 2rem);
      overflow: auto;
    }
    @media (max-width: 639px) {
      .ask-sheet {
        inset: auto 0 0 0;
        width: 100vw;
        max-height: 100dvh;
      }
    }
  `,
})
export class AskSheetComponent {
  protected readonly launcher = inject(AskLauncherService);
  protected readonly store = inject(AskStore);
  protected readonly lang = inject(LanguageService);
  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>("dialog");
  private readonly shell = viewChild.required(TerminalShellComponent);
  private returnFocus: HTMLElement | null = null;

  constructor() {
    afterRenderEffect(() => {
      const open = this.launcher.sheetOpen();
      const dialog = this.dialog().nativeElement;
      if (open && !dialog.open) {
        this.returnFocus = document.activeElement as HTMLElement | null;
        dialog.showModal();
        // A modal focuses its first control (the close button); the prompt is the point.
        this.launcher.takeFocus();
        this.shell().focusInput();
      } else if (!open && dialog.open) {
        dialog.close();
        this.returnFocus?.focus();
        this.returnFocus = null;
      }
    });
  }

  /** A click on the backdrop (the dialog itself, outside its content) closes it. */
  protected onBackdrop(event: MouseEvent): void {
    if (event.target === this.dialog().nativeElement) this.launcher.closeSheet();
  }
}
