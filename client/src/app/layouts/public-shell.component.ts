import { DOCUMENT } from "@angular/common";
import { ChangeDetectionStrategy, Component, computed, inject } from "@angular/core";

import { AskLauncherService } from "../ask/ask-launcher.service";
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
         opens it in a sheet (loaded on first use). -->
    @if (!onHome()) {
      <button
        type="button"
        class="fixed bottom-4 right-4 z-40 inline-flex size-11 cursor-pointer items-center justify-center rounded-full border border-border bg-card font-mono text-sm text-accent-orange shadow-e3 transition-colors hover:border-accent-orange"
        [attr.aria-label]="lang.t().ask.title"
        [attr.aria-expanded]="launcher.sheetOpen()"
        (click)="launcher.openSheet()"
      >
        <span aria-hidden="true">&gt;_</span>
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

  constructor() {
    // Here rather than in App, so the admin is never tracked.
    injectUmami(inject(DOCUMENT), {
      src: import.meta.env.VITE_UMAMI_SRC,
      websiteId: import.meta.env.VITE_UMAMI_WEBSITE_ID,
      hostname: canonicalHostname(this.lang.content().seo.canonical),
    });
  }

  /** ⌘K / Ctrl+K opens the palette from anywhere on the site. */
  protected onKeydown(event: KeyboardEvent): void {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      this.palette.toggle();
    }
  }
}

function canonicalHostname(canonical: string): string {
  try {
    return new URL(canonical).hostname;
  } catch {
    return "alirezarastineh.me";
  }
}
