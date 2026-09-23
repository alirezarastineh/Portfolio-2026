import { ChangeDetectionStrategy, Component } from "@angular/core";
import { RouterOutlet } from "@angular/router";
import type { RouteMeta } from "@analogjs/router";

import { localeContentResolver } from "../content/locale-route";
import { PublicShellComponent } from "../layouts/public-shell.component";

/**
 * `/en/...` and `/de/...`: every public page. The resolver loads the locale's
 * content before any page below renders. Which first segments count as a
 * locale is decided by `guardLocaleRoute` (app.config.ts), not here — see
 * there for why.
 */
export const routeMeta: RouteMeta = {
  resolve: { content: localeContentResolver },
};

@Component({
  selector: "app-locale-layout",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PublicShellComponent, RouterOutlet],
  template: `
    <app-public-shell>
      <router-outlet />
    </app-public-shell>
  `,
})
export default class LocaleLayout {}
