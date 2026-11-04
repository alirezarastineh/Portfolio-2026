import { DOCUMENT } from "@angular/common";
import {
  afterNextRender,
  afterRenderEffect,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  ElementRef,
  inject,
  signal,
  viewChild,
} from "@angular/core";
import { Router, Scroll } from "@angular/router";
import { NgIcon, provideIcons } from "@ng-icons/core";
import { lucideMaximize2, lucideMinimize2, lucideX } from "@ng-icons/lucide";
import { first } from "rxjs";

import {
  TerminalWindowComponent,
  type TerminalStatus,
} from "../components/terminal-window.component";
import { CHROME } from "../i18n/chrome";
import { LanguageService } from "../services/language.service";
import { AskLauncherService } from "./ask-launcher.service";
import { AskStore } from "./ask.store";
import { TerminalShellComponent } from "./terminal-shell.component";

/** Marks the history entry an open sheet adds, so a phone's Back can close it. */
const SHEET_ENTRY = "askSheet";

/**
 * The assistant on pages without the About terminal (plan 4 U8, U9): one non-modal
 * dialog, opened with `show()` at every width, so the page stays usable beside
 * it. From 1024px it floats at the bottom right, grows up to the header and
 * widens on request; below, it is a sheet over the whole screen, fitted above the
 * keyboard, with the page inert behind it and its own history entry. Opened by
 * the floating button, the palette, `/` or a reader's buttons; closed by the
 * visitor, and on a phone by a citation or the hand-off, whose page must show. It
 * holds still while pages change behind it, and a visible Turnstile check shows
 * inside it.
 */
@Component({
  selector: "app-ask-sheet",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgIcon, TerminalShellComponent, TerminalWindowComponent],
  viewProviders: [provideIcons({ lucideMaximize2, lucideMinimize2, lucideX })],
  host: {
    "(document:keydown.escape)": "onEscape($event)",
    "(window:popstate)": "onHistory($event)",
  },
  template: `
    <dialog
      #dialog
      tabindex="-1"
      class="ask-sheet m-0 bg-transparent p-0"
      [class.ask-sheet-wide]="wide()"
      [attr.aria-label]="lang.t().ask.title"
      (close)="launcher.closeSheet()"
    >
      <!-- A section, so the window's title bar (a <header>) is no second banner beside the page's. -->
      <section>
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
            class="ask-close press -my-1 -mr-1.5 inline-flex min-h-6 cursor-pointer items-center rounded-md px-1.5 text-muted-foreground hover:text-foreground"
            [attr.aria-label]="(launcher.narrow() ? '' : 'esc: ') + store.copy().close"
            (click)="dismiss()"
          >
            @if (launcher.narrow()) {
              <ng-icon name="lucideX" size="20" aria-hidden="true" />
            } @else {
              esc
            }
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
       screen, as tall as the visual viewport (fit): one column from the dialog
       down to the log, the only thing that scrolls unless the screen is too short
       for the prompt. */
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
        padding: env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom)
          env(safe-area-inset-left);
        background: var(--card);
        overscroll-behavior: contain;
        touch-action: manipulation;
      }
      .ask-sheet[open],
      .ask-sheet section,
      .ask-sheet ::ng-deep app-terminal-window,
      .ask-sheet ::ng-deep app-terminal-window > div,
      .ask-sheet ::ng-deep app-terminal-window > div > div,
      .ask-sheet ::ng-deep app-terminal-shell,
      .ask-sheet ::ng-deep app-terminal-shell > div {
        display: flex;
        flex-direction: column;
        flex: 1;
        min-height: 0;
      }
      .ask-sheet ::ng-deep app-terminal-window > div {
        overflow: visible;
        border: 0;
        border-radius: 0;
        box-shadow: none;
      }
      .ask-sheet ::ng-deep app-terminal-window > div > div {
        padding: 0.75rem 1rem;
      }
      .ask-sheet ::ng-deep [role="log"] {
        flex: 1;
        min-height: 5rem;
        max-height: none;
        overscroll-behavior: contain;
      }
      /* The bar keeps its height: the 44px target reaches into its padding. */
      .ask-close {
        justify-content: center;
        min-width: 2.75rem;
        min-height: 2.75rem;
        margin-block: -0.625rem;
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
  private readonly router = inject(Router);

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
  /** Where the page stood when the sheet opened; it cannot scroll behind a phone's sheet. */
  private pageTop = 0;

  constructor() {
    afterNextRender(() => (this.launcher.turnstileHost = this.check().nativeElement));
    afterRenderEffect(() => {
      const open = this.launcher.sheetOpen();
      const sheet = open && this.launcher.narrow();
      const dialog = this.dialog().nativeElement;
      // On a phone the page behind it stands still; the shell makes it inert.
      this.doc.documentElement.classList.toggle("overflow-hidden", sheet);
      if (open && !dialog.open) {
        this.returnFocus = this.doc.activeElement as HTMLElement | null;
        this.pageTop = this.doc.defaultView!.scrollY;
        dialog.show();
        // The dialog first: on a phone the prompt's keyboard would cover what it opened to (claim).
        dialog.focus();
        if (sheet && !this.history.state?.[SHEET_ENTRY]) {
          this.history.pushState({ ...this.history.state, [SHEET_ENTRY]: true }, "");
        }
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
      // At opening, and while it is open: a reader's button beside the panel.
      if (open && this.launcher.takeFocus()) this.shell().claim();
      this.fit();
    });

    const viewport = this.doc.defaultView?.visualViewport;
    const fit = () => this.fit();
    viewport?.addEventListener("resize", fit);
    viewport?.addEventListener("scroll", fit);
    inject(DestroyRef).onDestroy(() => {
      viewport?.removeEventListener("resize", fit);
      viewport?.removeEventListener("scroll", fit);
    });
  }

  private get history(): History {
    return this.doc.defaultView!.history;
  }

  /** The visitor's own close, which also takes back the history entry a phone's sheet added. */
  protected dismiss(): void {
    this.launcher.closeSheet();
    if (this.history.state?.[SHEET_ENTRY]) this.history.back();
  }

  /**
   * The sheet above the keyboard, where it is the visual viewport that shrinks and pans. iOS 26
   * can leave `offsetTop` set after the keyboard closes, so it counts only while a field has focus.
   */
  private fit(): void {
    const { style } = this.dialog().nativeElement;
    const vv = this.doc.defaultView?.visualViewport;
    const sheet = vv && this.launcher.sheetOpen() && this.launcher.narrow();
    const typing = this.doc.activeElement?.matches("textarea");
    style.height = sheet ? `${vv.height}px` : "";
    style.transform = sheet && typing && vv.offsetTop ? `translateY(${vv.offsetTop}px)` : "";
  }

  /**
   * On a phone Back leaves the sheet's entry and closes it; coming back to the entry, say from a
   * citation's page, opens it again. Under the entry lies the same page, so the router skips the
   * step, and then it (to the URL's #fragment) and WebKit (to a position of its own) scroll all
   * the same: the page goes back where it stood, in a microtask, since the public event comes
   * before the router's own scroll.
   */
  protected onHistory(event: PopStateEvent): void {
    const view = this.doc.defaultView!;
    const { pathname, search, hash } = view.location;
    if (this.router.url === pathname + search + hash) {
      const top = this.pageTop;
      this.router.events
        .pipe(first((routerEvent) => routerEvent instanceof Scroll))
        .subscribe(() => queueMicrotask(() => view.scrollTo({ top, behavior: "instant" })));
    }
    if (!this.launcher.narrow()) return;
    const ours = event.state?.[SHEET_ENTRY] === true;
    if (ours && !this.launcher.sheetOpen()) this.launcher.openSheet();
    else if (!ours) this.launcher.closeSheet();
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
    this.dismiss();
  }
}
