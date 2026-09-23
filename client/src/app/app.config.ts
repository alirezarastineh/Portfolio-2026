import { provideHttpClient, withInterceptors } from "@angular/common/http";
import { ApplicationConfig, ErrorHandler, provideBrowserGlobalErrorListeners } from "@angular/core";
import { provideClientHydration, withEventReplay } from "@angular/platform-browser";
import { withInMemoryScrolling, withRouterConfig } from "@angular/router";
import { provideFileRouter, requestContextInterceptor, routes } from "@analogjs/router";

import { guardLocaleRoute } from "./content/locale-route";
import { ReportingErrorHandler } from "./monitoring/reporting-error-handler";
import { providePageScroll } from "./navigation/page-scroll";

// Before the router reads the routes: `/fr` must not match `:locale`.
guardLocaleRoute(routes);

/**
 * No app-wide content preload: public pages load their locale's content in the
 * `[locale]` route's resolver, so `/admin` never waits for (or fetches) public
 * content. The admin's HTTP interceptor lives on the admin route for the same
 * reason — it and the admin API client stay out of the public bundle.
 */
export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    { provide: ErrorHandler, useClass: ReportingErrorHandler },
    provideFileRouter(
      // The `[locale]` param reaches every page below it, including the
      // empty-path children Analog creates for each file route.
      withRouterConfig({ paramsInheritanceStrategy: "always" }),
      withInMemoryScrolling({ anchorScrolling: "enabled" }),
    ),
    providePageScroll(),
    provideHttpClient(withInterceptors([requestContextInterceptor])),
    provideClientHydration(withEventReplay()),
  ],
};
