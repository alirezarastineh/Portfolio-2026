import {
  afterRenderEffect,
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  inject,
  viewChild,
} from "@angular/core";

import {
  TerminalWindowComponent,
  type TerminalStatus,
} from "../components/terminal-window.component";
import { CHROME } from "../i18n/chrome";
import { LanguageService } from "../services/language.service";
import { AskLauncherService } from "./ask-launcher.service";
import { AskStore } from "./ask.store";
import { TerminalShellComponent } from "./terminal-shell.component";

/**
 * The assistant on pages without the About terminal: the same shell and
 * conversation in a modal dialog, opened by the floating `>_` button or the
 * palette's "Ask AI…", or `/`. A panel at the bottom right; full width on
 * phones. Esc, the close button or a click outside closes it. Its title bar
 * says whether the assistant answers, as the About window's does.
 */
@Component({
  selector: "app-ask-sheet",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TerminalShellComponent, TerminalWindowComponent],
  template: `
    <dialog
      #dialog
      class="ask-sheet m-0 max-h-none max-w-none bg-transparent p-0 backdrop:bg-scrim backdrop:backdrop-blur-sm"
      [attr.aria-label]="lang.t().ask.title"
      (close)="launcher.closeSheet()"
      (click)="onBackdrop($event)"
    >
      <app-terminal-window [title]="lang.t().ask.title" [status]="status()" [compact]="true">
        <button
          windowAction
          type="button"
          class="-my-1 -mr-1.5 inline-flex min-h-6 cursor-pointer items-center rounded-md px-1.5 text-muted-foreground hover:text-foreground"
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

    /* Opening, it rises 16px and fades in over a fading backdrop; closing, it
       goes the same way, faster (display and the top layer wait for it).
       Where the browser cannot animate a dialog's display, it simply appears.
       The fallbacks: ::backdrop inherits the tokens only in newer browsers. */
    @media (prefers-reduced-motion: no-preference) {
      @supports (transition-behavior: allow-discrete) {
        .ask-sheet,
        .ask-sheet::backdrop {
          opacity: 0;
          transition:
            opacity var(--dur-3, 240ms) var(--ease-in, ease-in),
            translate var(--dur-3, 240ms) var(--ease-in, ease-in),
            overlay var(--dur-3, 240ms) allow-discrete,
            display var(--dur-3, 240ms) allow-discrete;
        }
        .ask-sheet {
          translate: 0 16px;
        }
        .ask-sheet[open],
        .ask-sheet[open]::backdrop {
          opacity: 1;
          transition-duration: var(--dur-4, 360ms);
          transition-timing-function: var(--ease-emph, ease-out);
        }
        .ask-sheet[open] {
          translate: 0 0;
        }
        @starting-style {
          .ask-sheet[open],
          .ask-sheet[open]::backdrop {
            opacity: 0;
          }
          .ask-sheet[open] {
            translate: 0 16px;
          }
        }
      }
    }
  `,
})
export class AskSheetComponent {
  protected readonly launcher = inject(AskLauncherService);
  protected readonly store = inject(AskStore);
  protected readonly lang = inject(LanguageService);

  /** As on the About window: `● online` or `● resting`, once the prompt's code knows. */
  protected readonly status = computed<TerminalStatus | null>(() => {
    const state = this.launcher.assistant();
    if (!state) return null;
    const about = CHROME[this.lang.lang()].about;
    return state === "online"
      ? { label: about.online, live: true }
      : { label: about.resting, live: false };
  });
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
        // A modal focuses its first control (the close button); the prompt is
        // the point, and a question sent from the page goes in at once.
        this.launcher.takeFocus();
        this.shell().claim();
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
