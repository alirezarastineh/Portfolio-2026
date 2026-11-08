import { DOCUMENT } from "@angular/common";
import {
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
import { lucideEllipsis, lucideMaximize2, lucideMinimize2, lucideX } from "@ng-icons/lucide";
import { first } from "rxjs";

import { CHROME } from "../i18n/chrome";
import { LanguageService } from "../services/language.service";
import { AskConsoleComponent } from "./ask-console.component";
import { AskLauncherService } from "./ask-launcher.service";
import { LEVELS } from "./ask-level";
import { AskStore } from "./ask.store";

/** Marks the history entry an open sheet adds, so a phone's Back can close it. */
const SHEET_ENTRY = "askSheet";

/**
 * The assistant on every page (plan 4 U8–U11): one non-modal dialog, opened with
 * `show()` at every width, so the page stays usable beside it. From 1024px it
 * floats at the right under the site's header and widens on request; below, it is
 * a sheet over the whole screen, fitted above the keyboard, with the page inert
 * behind it and its own history entry. Opened by the floating button, the palette,
 * `/` or a reader's buttons (home's stage takes those while it is on screen, and
 * on a phone is the door here); closed by the visitor, and on a phone by a citation
 * or the hand-off, whose page must show. It holds still while pages change behind
 * it, and a visible Turnstile check shows inside it.
 */
@Component({
  selector: "app-ask-sheet",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AskConsoleComponent, NgIcon],
  viewProviders: [provideIcons({ lucideEllipsis, lucideMaximize2, lucideMinimize2, lucideX })],
  host: {
    "(document:keydown.escape)": "onEscape($event)",
    "(window:popstate)": "onHistory($event)",
  },
  template: `
    <dialog
      #dialog
      tabindex="-1"
      class="ask-sheet"
      [class.ask-sheet-wide]="wide()"
      [attr.aria-label]="lang.t().ask.title"
      (close)="launcher.closeSheet()"
      (focusout)="fit()"
    >
      <!-- A section, so its <header> is no second banner beside the page's. -->
      <section>
        <header>
          <h2>{{ lang.t().ask.title }}</h2>
          @if (status(); as status) {
            <span class="status"
              ><span class="dot" [class.live]="status.live" aria-hidden="true"></span
              ><span class="word">{{ status.label }}</span></span
            >
          }
          <button
            type="button"
            class="tool wider press"
            [attr.aria-pressed]="wide()"
            [attr.aria-label]="store.copy().wider"
            (click)="wide.set(!wide())"
          >
            <ng-icon
              [name]="wide() ? 'lucideMinimize2' : 'lucideMaximize2'"
              size="16"
              aria-hidden="true"
            />
          </button>
          <button
            type="button"
            class="tool press"
            popovertarget="ask-menu"
            [attr.aria-label]="menu().label"
          >
            <ng-icon name="lucideEllipsis" size="16" aria-hidden="true" />
          </button>
          <!-- What help lists, without typing: the browser closes it on Escape or a click outside. -->
          <div #more id="ask-menu" class="menu" popover>
            <button type="button" (click)="run('clear')">{{ menu().clear }}</button>
            <button type="button" (click)="run('forget')">{{ menu().forget }}</button>
            <div class="levels" role="group" [attr.aria-label]="menu().level">
              <span aria-hidden="true">{{ menu().level }}</span>
              @for (level of levels; track level) {
                <button
                  type="button"
                  [attr.aria-pressed]="store.level() === level"
                  (click)="run('level ' + level)"
                >
                  {{ menu().levels[level] }}
                </button>
              }
            </div>
            <button type="button" (click)="run('news')">{{ menu().news }}</button>
            <button type="button" (click)="run('tour')">{{ menu().tour }}</button>
          </div>
          <button
            type="button"
            class="tool press"
            aria-keyshortcuts="Escape"
            [attr.aria-label]="store.copy().close"
            (click)="dismiss()"
          >
            <ng-icon name="lucideX" size="20" aria-hidden="true" />
          </button>
        </header>
        <!-- One console at a time: while home's stage holds it, none here. -->
        @if (!launcher.stageLive()) {
          <app-ask-console />
        }
      </section>
    </dialog>
  `,
  styles: `
    /* From 1024px a panel beside the page, under the 64px header. Below (the
       launcher's SHEET_QUERY), a sheet over the whole screen, as tall as the
       visual viewport (fit). One column at every width, from the dialog down to
       the log, the only thing that scrolls unless the screen is too short for
       the prompt. */
    .ask-sheet {
      position: fixed;
      inset: 4.5rem 1rem 1rem auto;
      z-index: var(--z-panel);
      width: min(28rem, 34vw);
      height: auto;
      max-height: none;
      margin: 0;
      padding: 0;
      overflow: auto;
      background: transparent;
      view-transition-name: ask-panel;
    }
    .ask-sheet-wide {
      width: min(44rem, 60vw);
    }
    .ask-sheet[open],
    section {
      display: flex;
      flex-direction: column;
    }
    section {
      flex: 1;
      min-height: 0;
      overflow: hidden;
      border: 1px solid var(--border-strong);
      border-radius: 0.5rem;
      background: var(--card);
      box-shadow: 0 24px 60px rgb(0 0 0 / 0.35);
    }
    app-ask-console {
      flex: 1;
    }
    header {
      display: flex;
      flex: none;
      align-items: center;
      gap: 0.25rem;
      padding: 0.25rem 0.25rem 0.25rem 1rem;
      border-bottom: 1px solid var(--border);
    }
    h2 {
      min-width: 0;
      margin: 0 auto 0 0;
      color: var(--foreground);
      font-size: 0.9375rem;
      font-weight: 600;
      line-height: 1.3;
      text-wrap: balance;
    }
    .status {
      display: inline-flex;
      flex: none;
      align-items: center;
      gap: 0.375rem;
      margin-inline: 0.5rem 0.25rem;
      color: var(--muted-foreground);
      font-size: 0.75rem;
    }
    .dot {
      width: 0.375rem;
      height: 0.375rem;
      border-radius: 50%;
      background: var(--muted-foreground);
    }
    .dot.live {
      background: var(--available);
    }
    .tool {
      display: inline-flex;
      flex: none;
      align-items: center;
      justify-content: center;
      width: 2.5rem;
      height: 2.5rem;
      border-radius: 0.25rem;
      color: var(--muted-foreground);
      cursor: pointer;
    }
    .tool:hover {
      color: var(--foreground);
    }

    /* In the top layer, under the header's ⋯: the panel's place is fixed, so no anchor is needed. */
    .menu {
      position: fixed;
      inset: 7.75rem 1.5rem auto auto;
      width: 15rem;
      margin: 0;
      padding: 0.25rem;
      border: 1px solid var(--border-strong);
      border-radius: 0.5rem;
      background: var(--card);
      box-shadow: 0 24px 60px rgb(0 0 0 / 0.35);
      color: var(--foreground);
      font-size: 0.875rem;
    }
    .menu:popover-open {
      display: flex;
      flex-direction: column;
    }
    .menu button {
      min-height: 2.25rem;
      padding-inline: 0.625rem;
      border-radius: 0.25rem;
      text-align: left;
      cursor: pointer;
    }
    .menu button:hover {
      background: var(--muted);
    }
    .levels {
      display: flex;
      flex-wrap: wrap;
      margin-block: 0.25rem;
      padding-block: 0.375rem 0.25rem;
      border-block: 1px solid var(--border);
    }
    .levels span {
      flex-basis: 100%;
      padding-inline: 0.625rem;
      color: var(--muted-foreground);
      font-size: 0.75rem;
    }
    .levels button {
      flex: 1;
      padding-inline: 0.25rem;
      text-align: center;
    }
    .levels [aria-pressed="true"] {
      color: var(--accent-orange);
      text-decoration: underline;
      text-underline-offset: 0.25em;
    }

    @media (width < 64rem) {
      .ask-sheet {
        inset: 0;
        width: auto;
        padding: env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom)
          env(safe-area-inset-left);
        background: var(--card);
        overscroll-behavior: contain;
        touch-action: manipulation;
      }
      section {
        overflow: visible;
        border: 0;
        border-radius: 0;
        box-shadow: none;
      }
      .wider {
        display: none;
      }
      .menu {
        inset: calc(env(safe-area-inset-top) + 3.25rem) 0.5rem auto auto;
      }
    }
    /* The status keeps its dot; screen readers keep the word. */
    @media (width < 40rem) {
      .word {
        position: absolute;
        width: 1px;
        height: 1px;
        overflow: hidden;
        clip-path: inset(50%);
        white-space: nowrap;
      }
    }
    @media (pointer: coarse) {
      .tool {
        width: 2.75rem;
        height: 2.75rem;
      }
      .menu button {
        min-height: 2.75rem;
      }
    }

    /* Opening, the panel slides 24px in from its side and the sheet rises 16px, both fading in;
       closing, they go the same way, faster (display waits for it). Where the browser cannot
       animate a dialog's display, it simply appears. */
    @media (prefers-reduced-motion: no-preference) {
      @supports (transition-behavior: allow-discrete) {
        .ask-sheet {
          --enter: 24px 0;
          opacity: 0;
          translate: var(--enter);
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
            translate: var(--enter);
          }
        }
        @media (width < 64rem) {
          .ask-sheet {
            --enter: 0 16px;
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

  /** `● online` or `● resting`, once the prompt's code knows. */
  protected readonly status = computed(() => {
    const state = this.launcher.assistant();
    if (!state) return null;
    const about = CHROME[this.lang.lang()].about;
    return state === "online"
      ? { label: about.online, live: true }
      : { label: about.resting, live: false };
  });
  protected readonly menu = computed(() => this.store.copy().menu);
  protected readonly levels = LEVELS;
  /** The wide width, for code and tables; not stored, so nothing is kept on the device. */
  protected readonly wide = signal(false);
  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>("dialog");
  private readonly askConsole = viewChild(AskConsoleComponent);
  private readonly more = viewChild.required<ElementRef<HTMLElement>>("more");
  private returnFocus: HTMLElement | null = null;
  /** Where the page stood when the sheet opened; it cannot scroll behind a phone's sheet. */
  private pageTop = 0;

  constructor() {
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
          // An opener the page took away, or none (Safari doesn't focus a clicked button); and
          // WebKit keeps the closed dialog's control as the focus until its next render.
          const now = this.doc.activeElement;
          if (!now || now === this.doc.body || dialog.contains(now)) {
            this.doc.querySelector<HTMLElement>(".ask-fab")?.focus();
          }
        }
        this.returnFocus = null;
      }
      // At opening, and while it is open: a reader's button beside the panel.
      if (open && this.launcher.takeFocus()) this.askConsole()?.claim();
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

  /** A command from the ⋯ menu, run as if typed. */
  protected run(command: string): void {
    this.more().nativeElement.hidePopover();
    this.askConsole()?.send(command);
  }

  /** The visitor's own close, which also takes back the history entry a phone's sheet added. */
  protected dismiss(): void {
    this.launcher.closeSheet();
    if (this.history.state?.[SHEET_ENTRY]) this.history.back();
  }

  /**
   * The sheet above the keyboard, where it is the visual viewport that shrinks and pans. iOS 26
   * can leave `offsetTop` set after the keyboard closes, so it counts only while a field has focus
   * (and is dropped when the focus leaves, whichever event comes first).
   */
  protected fit(): void {
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
   * no Escape of its own. A modal above it (the palette) and the ⋯ menu take their own, as
   * does the match box (it stops the event).
   */
  protected onEscape(event: Event): void {
    const { isComposing, defaultPrevented } = event as KeyboardEvent;
    if (!this.launcher.sheetOpen() || isComposing || defaultPrevented) return;
    if (this.doc.querySelector("dialog:modal, #ask-menu:popover-open")) return;
    this.dismiss();
  }
}
