import { DOCUMENT } from "@angular/common";
import { ChangeDetectionStrategy, Component, inject } from "@angular/core";

import { CommandPaletteComponent } from "../components/command-palette.component";
import { SiteFooterComponent } from "../components/site-footer.component";
import { SiteHeaderComponent } from "../components/site-header.component";
import { injectUmami } from "../monitoring/analytics";
import { CommandPaletteService } from "../services/command-palette.service";
import { LanguageService } from "../services/language.service";

/**
 * The public portfolio chrome: header, footer and the ⌘K palette. The admin
 * renders its own layout instead.
 */
@Component({
  selector: "app-public-shell",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommandPaletteComponent, SiteFooterComponent, SiteHeaderComponent],
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
  `,
})
export class PublicShellComponent {
  protected readonly palette = inject(CommandPaletteService);

  constructor() {
    // Here rather than in App, so the admin is never tracked.
    injectUmami(inject(DOCUMENT), {
      src: import.meta.env.VITE_UMAMI_SRC,
      websiteId: import.meta.env.VITE_UMAMI_WEBSITE_ID,
      hostname: canonicalHostname(inject(LanguageService).content().seo.canonical),
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
