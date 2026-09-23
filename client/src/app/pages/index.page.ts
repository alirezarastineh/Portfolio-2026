import type { RouteMeta } from "@analogjs/router";
import type { RedirectFunction } from "@angular/router";
import { injectRequest } from "@analogjs/router/tokens";

import { negotiateLocale } from "../content/locale";

const header = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value.join(",") : value;

/**
 * `/` has no content of its own. In production the Nitro middleware answers it
 * before Angular runs (a per-visitor 302); this covers in-app navigation to
 * `/` and any server that runs without the middleware.
 */
const toPreferredLocale: RedirectFunction = () => {
  const request = injectRequest();
  if (request) {
    return `/${negotiateLocale(header(request.headers.cookie), header(request.headers["accept-language"]))}`;
  }
  if (typeof document !== "undefined") {
    return `/${negotiateLocale(document.cookie, navigator.languages?.join(",") ?? navigator.language)}`;
  }
  return "/en";
};

// Analog types `redirectTo` as a string; Angular also accepts a function, and
// Analog passes redirect meta through unchanged.
export const routeMeta: RouteMeta = {
  redirectTo: toPreferredLocale as unknown as string,
  pathMatch: "full",
};
