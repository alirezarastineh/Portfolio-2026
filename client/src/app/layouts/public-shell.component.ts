import { DOCUMENT, isPlatformBrowser } from "@angular/common";
import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  PLATFORM_ID,
  viewChild,
} from "@angular/core";

import { AskLauncherService } from "../ask/ask-launcher.service";
import { takeLinkQuestion } from "../ask/ask-link";
import { AskSheetComponent } from "../ask/ask-sheet.component";
import { CommandPaletteComponent } from "../components/command-palette.component";
import { SiteFooterComponent } from "../components/site-footer.component";
import { SiteHeaderComponent } from "../components/site-header.component";
import { CHROME } from "../i18n/chrome";
import { injectUmami } from "../monitoring/analytics";
import { CommandPaletteService } from "../services/command-palette.service";
import { LanguageService } from "../services/language.service";

/**
 * The public portfolio chrome: header, footer, the ⌘K palette, and the
 * assistant's button and panel. The admin renders its own layout instead.
 */
@Component({
  selector: "app-public-shell",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AskSheetComponent, CommandPaletteComponent, SiteFooterComponent, SiteHeaderComponent],
  host: {
    class: "block min-h-screen pt-[env(safe-area-inset-top)]",
    "(document:keydown)": "onKeydown($event)",
  },
  template: `
    <!-- The page, inert behind the assistant's sheet on phones (plan 4 U8), and
         behind the open menu, which the header holds. -->
    <div class="contents" [attr.inert]="launcher.sheetOpen() && launcher.narrow() ? '' : null">
      <app-site-header />
      <div class="contents" [attr.inert]="header()?.open() ? '' : null">
        <ng-content />
        <app-site-footer />
      </div>
    </div>
    <!-- Its code loads the first time someone opens it; on a slow line its frame answers at once. -->
    @defer (when palette.requested()) {
      <app-command-palette />
    } @loading (after 100ms) {
      <div class="palette-loading" role="status">{{ paletteTitle() }}…</div>
    }
    <!-- Opens the assistant's panel (loaded on first use); on home it waits until
         the hero's stage has left the screen. A 48px pill clear of the phone's
         edges. Hiding it while the mobile menu or the panel is open is in styles.css. -->
    <button
      type="button"
      class="ask-fab press fixed bottom-[max(1rem,env(safe-area-inset-bottom))] right-[max(1rem,env(safe-area-inset-right))] z-(--z-float) inline-flex h-12 cursor-pointer touch-manipulation items-center rounded-full border border-border-strong bg-card px-5 text-small font-semibold shadow-e3 hover:border-foreground"
      [attr.aria-label]="lang.t().ask.title"
      [attr.aria-expanded]="launcher.sheetOpen()"
      [hidden]="onHome() && launcher.stageInView()"
      aria-keyshortcuts="/"
      (click)="launcher.openSheet('button')"
    >
      {{ fabWord() }}
    </button>
    @defer (when launcher.sheetRequested()) {
      <app-ask-sheet />
    } @loading (after 100ms) {
      <!-- On a slow line the first open answers at once; the panel takes over when it arrives. -->
      <div class="ask-loading" role="status">{{ lang.t().ask.title }}…</div>
    }
  `,
})
export class PublicShellComponent {
  protected readonly palette = inject(CommandPaletteService);
  protected readonly launcher = inject(AskLauncherService);
  protected readonly lang = inject(LanguageService);
  protected readonly onHome = computed(() => this.lang.page() === "/");
  protected readonly paletteTitle = computed(() => CHROME[this.lang.lang()].palette.title);
  /** The header, whose open menu makes the page behind it inert. */
  protected readonly header = viewChild(SiteHeaderComponent);
  /**
   * The pill's word, the first of the button's accessible name ("Ask",
   * "Fragen"): the name then always contains what the button says.
   */
  protected readonly fabWord = computed(() => this.lang.t().ask.title.trim().split(/\s+/)[0] ?? "");
  private readonly doc = inject(DOCUMENT);

  constructor() {
    // Here rather than in App, so the admin is never tracked.
    injectUmami(this.doc, {
      src: import.meta.env.VITE_UMAMI_SRC,
      websiteId: import.meta.env.VITE_UMAMI_WEBSITE_ID,
      hostname: canonicalHostname(this.lang.content().seo.canonical),
    });
    // A shared link's question (visitor plan V17): in the prompt, focused, never sent for the visitor.
    if (isPlatformBrowser(inject(PLATFORM_ID))) {
      afterNextRender(() => {
        const question = takeLinkQuestion();
        if (question) this.launcher.prefill(question, "link");
      });
    }
  }

  /**
   * ⌘K / Ctrl+K opens the palette from anywhere on the site. `/` goes to the
   * assistant's prompt, unless the visitor is typing somewhere.
   */
  protected onKeydown(event: KeyboardEvent): void {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      this.palette.toggle();
      return;
    }
    if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.defaultPrevented || isTyping(event.target) || this.palette.open()) return;
    event.preventDefault();
    this.launcher.openSheet("shortcut");
  }
}

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
}

function canonicalHostname(canonical: string): string {
  try {
    return new URL(canonical).hostname;
  } catch {
    return "alirezarastineh.me";
  }
}
