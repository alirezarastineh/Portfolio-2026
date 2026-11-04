import { DOCUMENT } from "@angular/common";
import {
  afterNextRender,
  afterRenderEffect,
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  inject,
  signal,
  viewChild,
} from "@angular/core";
import { NgIcon, provideIcons } from "@ng-icons/core";
import { lucideMaximize2, lucideMinimize2 } from "@ng-icons/lucide";

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
 * The assistant on pages without the About terminal (plan 4 U8): one non-modal
 * dialog, opened with `show()` at every width, so the page stays usable beside
 * it. From 1024px it floats at the bottom right, grows up to the header and
 * widens on request; below, it covers the screen as a sheet and the shell makes
 * the page inert. Opened by the floating button, the palette, `/` or a reader's
 * buttons; closed by the visitor, and on a phone by a citation or the hand-off,
 * whose page must show. It holds still while pages change behind it, and a
 * visible Turnstile check shows inside it.
 */
@Component({
  selector: "app-ask-sheet",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgIcon, TerminalShellComponent, TerminalWindowComponent],
  viewProviders: [provideIcons({ lucideMaximize2, lucideMinimize2 })],
  host: { "(document:keydown.escape)": "onEscape($event)" },
  template: `
    <dialog
      #dialog
      class="ask-sheet m-0 bg-transparent p-0"
      [class.ask-sheet-wide]="wide()"
      [attr.aria-label]="lang.t().ask.title"
      (close)="launcher.closeSheet()"
      (click)="onScrim($event)"
    >
      <!-- A section, so the window's title bar (a <header>) is no second banner beside the page's. -->
      <section class="mt-auto">
        <app-terminal-window [title]="lang.t().ask.title" [status]="status()" [compact]="true">
          <button
            windowAction
            type="button"
            class="press -my-1 inline-flex min-h-6 cursor-pointer items-center rounded-md px-1.5 text-muted-foreground hover:text-foreground max-lg:hidden"
            [attr.aria-pressed]="wide()"
            (click)="wide.set(!wide())"
          >
            <ng-icon
              [name]="wide() ? 'lucideMinimize2' : 'lucideMaximize2'"
              size="14"
              aria-hidden="true"
            /><span class="sr-only">{{ store.copy().wider }}</span>
          </button>
          <button
            windowAction
            type="button"
            class="press -my-1 -mr-1.5 inline-flex min-h-6 cursor-pointer items-center rounded-md px-1.5 text-muted-foreground hover:text-foreground"
            [attr.aria-label]="'esc: ' + store.copy().close"
            (click)="launcher.closeSheet()"
          >
            esc
          </button>
          <app-terminal-shell [inSheet]="true" />
          <!-- Where Cloudflare's check shows when it asks the visitor (store: readyToAsk). -->
          <div #check></div>
        </app-terminal-window>
      </section>
    </dialog>
  `,
  styles: `
    /* From 1024px a panel beside the page: bottom right, growing up to 8px under
       the 64px header. Below (the launcher's SHEET_QUERY), a sheet over the whole
       screen, the window at its foot over the scrim. */
    .ask-sheet {
      position: fixed;
      inset: auto 1rem 1rem auto;
      z-index: 50;
      width: min(28rem, 34vw);
      max-height: calc(100dvh - 5.5rem);
      overflow: auto;
      view-transition-name: ask-panel;
    }
    .ask-sheet-wide {
      width: min(44rem, 60vw);
    }
    @media (width < 64rem) {
      .ask-sheet {
        inset: 0;
        width: auto;
        height: auto;
        max-height: none;
        background: var(--scrim);
        backdrop-filter: blur(4px);
      }
      .ask-sheet[open] {
        display: flex;
        flex-direction: column;
      }
    }

    /* Opening, it rises 16px and fades in; closing, it goes the same way, faster
       (display waits for it). Where the browser cannot animate a dialog's
       display, it simply appears. */
    @media (prefers-reduced-motion: no-preference) {
      @supports (transition-behavior: allow-discrete) {
        .ask-sheet {
          opacity: 0;
          translate: 0 16px;
          transition:
            opacity var(--dur-3, 240ms) var(--ease-in, ease-in),
            translate var(--dur-3, 240ms) var(--ease-in, ease-in),
            display var(--dur-3, 240ms) allow-discrete;
        }
        .ask-sheet[open] {
          opacity: 1;
          translate: 0 0;
          transition-duration: var(--dur-4, 360ms);
          transition-timing-function: var(--ease-emph, ease-out);
        }
        @starting-style {
          .ask-sheet[open] {
            opacity: 0;
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
  private readonly doc = inject(DOCUMENT);

  /** As on the About window: `● online` or `● resting`, once the prompt's code knows. */
  protected readonly status = computed<TerminalStatus | null>(() => {
    const state = this.launcher.assistant();
    if (!state) return null;
    const about = CHROME[this.lang.lang()].about;
    return state === "online"
      ? { label: about.online, live: true }
      : { label: about.resting, live: false };
  });
  /** The wide width, for code and tables; not stored, so nothing is kept on the device. */
  protected readonly wide = signal(false);
  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>("dialog");
  private readonly shell = viewChild.required(TerminalShellComponent);
  private readonly check = viewChild.required<ElementRef<HTMLElement>>("check");
  private returnFocus: HTMLElement | null = null;

  constructor() {
    afterNextRender(() => (this.launcher.turnstileHost = this.check().nativeElement));
    afterRenderEffect(() => {
      const open = this.launcher.sheetOpen();
      const dialog = this.dialog().nativeElement;
      // On a phone the page behind it stands still; the shell makes it inert.
      this.doc.documentElement.classList.toggle("overflow-hidden", open && this.launcher.narrow());
      if (open && !dialog.open) {
        this.returnFocus = this.doc.activeElement as HTMLElement | null;
        dialog.show();
        // The prompt is the point, and a question sent from the page goes in at once.
        this.launcher.takeFocus();
        this.shell().claim();
      } else if (!open && dialog.open) {
        // Focus goes back to the opener, unless the page has it: the hand-off's form, or
        // what the visitor tabbed to before Escape, which closing reveals (WCAG 2.4.11).
        const active = this.doc.activeElement;
        const ours = !active || active === this.doc.body || dialog.contains(active);
        dialog.close();
        if (ours) {
          this.returnFocus?.focus();
          // An opener the page took away, or none (Safari doesn't focus a clicked button).
          if (this.doc.activeElement === this.doc.body) {
            this.doc.querySelector<HTMLElement>(".ask-fab")?.focus();
          }
        }
        this.returnFocus = null;
      }
    });
  }

  /** On a phone, a tap on the scrim above the window (the dialog itself) closes the sheet. */
  protected onScrim(event: MouseEvent): void {
    if (event.target === this.dialog().nativeElement) this.launcher.closeSheet();
  }

  /**
   * Escape closes it, from inside it or from the page, since a non-modal dialog has
   * no Escape of its own. A modal above it (the palette) takes its own, as does the
   * match box (it stops the event).
   */
  protected onEscape(event: Event): void {
    const { isComposing, defaultPrevented } = event as KeyboardEvent;
    if (!this.launcher.sheetOpen() || isComposing || defaultPrevented) return;
    if (this.doc.querySelector("dialog:modal")) return;
    this.launcher.closeSheet();
  }
}
