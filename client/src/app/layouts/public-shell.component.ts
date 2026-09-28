import { DOCUMENT } from "@angular/common";
import { ChangeDetectionStrategy, Component, computed, inject } from "@angular/core";

import { ASK_BAR_ID, AskLauncherService } from "../ask/ask-launcher.service";
import { AskSheetComponent } from "../ask/ask-sheet.component";
import { CommandPaletteComponent } from "../components/command-palette.component";
import { SiteFooterComponent } from "../components/site-footer.component";
import { SiteHeaderComponent } from "../components/site-header.component";
import { injectUmami } from "../monitoring/analytics";
import { CommandPaletteService } from "../services/command-palette.service";
import { LanguageService } from "../services/language.service";

/**
 * The public portfolio chrome: header, footer, the ⌘K palette, and the
 * assistant's button on pages without the About terminal. The admin renders
 * its own layout instead.
 */
@Component({
  selector: "app-public-shell",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AskSheetComponent, CommandPaletteComponent, SiteFooterComponent, SiteHeaderComponent],
  host: {
    class: "block min-h-screen",
    "(document:keydown)": "onKeydown($event)",
  },
  template: `
    <app-site-header />
    <ng-content />
    <app-site-footer />
    <!-- Its code loads the first time someone opens it. -->
    @defer (when palette.requested()) {
      <app-command-palette />
    }
    <!-- The assistant lives in the About terminal on home; elsewhere this
         opens it in a sheet (loaded on first use). A 44px circle on phones,
         a \`>_ ask\` pill from lg. Its press, and hiding it while the mobile
         menu is open, are in styles.css. -->
    @if (!onHome()) {
      <button
        type="button"
        class="ask-fab press fixed bottom-4 right-4 z-40 inline-flex h-11 min-w-11 cursor-pointer items-center justify-center gap-2 rounded-full border border-border bg-card font-mono text-sm shadow-e3 hover:border-accent-orange lg:px-4"
        [attr.aria-label]="lang.t().ask.title"
        [attr.aria-expanded]="launcher.sheetOpen()"
        aria-keyshortcuts="/"
        (click)="launcher.openSheet('button')"
      >
        <span class="text-accent-orange" aria-hidden="true">&gt;_</span
        ><span class="max-lg:hidden">{{ fabWord() }}</span>
      </button>
    }
    @defer (when launcher.sheetRequested()) {
      <app-ask-sheet />
    }
  `,
})
export class PublicShellComponent {
  protected readonly palette = inject(CommandPaletteService);
  protected readonly launcher = inject(AskLauncherService);
  protected readonly lang = inject(LanguageService);
  protected readonly onHome = computed(() => this.lang.page() === "/");
  /**
   * The pill's word, the first of the button's accessible name ("ask",
   * "frag"): the name then always contains what the button says.
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
  }

  /**
   * ⌘K / Ctrl+K opens the palette from anywhere on the site. `/` goes to the
   * assistant, unless the visitor is typing somewhere: the hero's ask bar on
   * home, the sheet elsewhere.
   */
  protected onKeydown(event: KeyboardEvent): void {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      this.palette.toggle();
      return;
    }
    if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.defaultPrevented || isTyping(event.target)) return;
    const bar = this.doc.getElementById(ASK_BAR_ID);
    if (bar) {
      event.preventDefault();
      bar.focus();
    } else if (!this.onHome() && !this.launcher.sheetOpen() && !this.palette.open()) {
      event.preventDefault();
      this.launcher.openSheet("shortcut");
    }
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
