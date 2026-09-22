import { mergeApplicationConfig, ApplicationConfig } from "@angular/core";
import { provideServerRendering } from "@angular/platform-server";
import { injectRequest, injectResponse } from "@analogjs/router/tokens";

import {
  INITIAL_LOCALE,
  LOCALE_COOKIE,
  parseAcceptLanguage,
  parseLocaleCookie,
} from "./content/locale.token";
import type { Locale } from "./content/schema";
import { appConfig } from "./app.config";

const COOKIE_MAX_AGE = 31_536_000; // one year

/**
 * Negotiates the render locale from the incoming request.
 *
 * Before this, SSR always rendered English while the browser could pick German
 * from localStorage — a visible post-hydration content swap. The cookie is
 * authoritative; `Accept-Language` only seeds the very first visit, and the
 * response sets the cookie so the next render is deterministic.
 */
function negotiateLocale(): Locale {
  const request = injectRequest();
  if (!request) return "en";

  const cookieHeader = request.headers.cookie;
  const fromCookie = parseLocaleCookie(cookieHeader);
  if (fromCookie) return fromCookie;

  const accept = request.headers["accept-language"];
  const negotiated =
    parseAcceptLanguage(Array.isArray(accept) ? accept.join(",") : accept) ?? "en";

  const response = injectResponse();
  if (response && !response.headersSent) {
    try {
      response.setHeader(
        "Set-Cookie",
        `${LOCALE_COOKIE}=${negotiated}; Path=/; Max-Age=${COOKIE_MAX_AGE}; SameSite=Lax`,
      );
    } catch {
      // A failed cookie write only costs us one more negotiation next request.
    }
  }

  return negotiated;
}

const serverConfig: ApplicationConfig = {
  providers: [
    provideServerRendering(),
    { provide: INITIAL_LOCALE, useFactory: negotiateLocale },
  ],
};

export const config = mergeApplicationConfig(appConfig, serverConfig);
