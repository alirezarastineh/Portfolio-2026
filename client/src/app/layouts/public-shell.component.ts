import { DOCUMENT } from "@angular/common";
import { ChangeDetectionStrategy, Component, inject } from "@angular/core";

import { GrainOverlayComponent } from "../components/grain-overlay.component";
import { SiteFooterComponent } from "../components/site-footer.component";
import { SiteHeaderComponent } from "../components/site-header.component";
import { injectUmami } from "../monitoring/analytics";
import { LanguageService } from "../services/language.service";

/**
 * The public portfolio chrome.
 *
 * This used to live in `App`, which meant every route inherited the site header,
 * footer and grain overlay — including `/admin`. Pulling it into a shell lets
 * the admin render its own layout instead.
 */
@Component({
  selector: "app-public-shell",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [GrainOverlayComponent, SiteFooterComponent, SiteHeaderComponent],
  host: { class: "block min-h-screen" },
  template: `
    <app-site-header />
    <ng-content />
    <app-site-footer />
    <app-grain-overlay />
  `,
})
export class PublicShellComponent {
  constructor() {
    // Here rather than in App, so the admin is never tracked.
    injectUmami(inject(DOCUMENT), {
      src: import.meta.env.VITE_UMAMI_SRC,
      websiteId: import.meta.env.VITE_UMAMI_WEBSITE_ID,
      hostname: canonicalHostname(inject(LanguageService).content().seo.canonical),
    });
  }
}

function canonicalHostname(canonical: string): string {
  try {
    return new URL(canonical).hostname;
  } catch {
    return "alirezarastineh.me";
  }
}
