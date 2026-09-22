import { DOCUMENT } from "@angular/common";
import { Component, effect, inject } from "@angular/core";
import { RouterOutlet } from "@angular/router";

import { LanguageService } from "./services/language.service";

/**
 * Deliberately bare: the public chrome moved into `PublicShellComponent` so
 * that `/admin` can render its own layout instead of inheriting the site
 * header and footer.
 */
@Component({
  selector: "app-root",
  imports: [RouterOutlet],
  host: {
    class: "block min-h-screen",
  },
  template: `<router-outlet />`,
})
export class App {
  private readonly document = inject(DOCUMENT);
  private readonly lang = inject(LanguageService);

  constructor() {
    // index.html hardcodes lang="en", so a German render would otherwise be
    // announced in English by screen readers and indexed as English. Doing it
    // here covers SSR and client-side toggles with one code path.
    effect(() => {
      this.document.documentElement.setAttribute("lang", this.lang.lang());
    });
  }
}
