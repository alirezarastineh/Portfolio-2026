import { ChangeDetectionStrategy, Component } from "@angular/core";
import type { RouteMeta } from "@analogjs/router";

import { NotFoundComponent } from "../components/not-found.component";
import { notFoundResolver } from "../seo/http-status";

/**
 * Anything outside `/en`, `/de` and `/admin` — including `/fr/...`, which the
 * locale route's guard lets fall through to here. Answers a real 404.
 */
export const routeMeta: RouteMeta = {
  title: "404 — Not found · Seite nicht gefunden",
  meta: [{ name: "robots", content: "noindex" }],
  resolve: { status: notFoundResolver },
};

@Component({
  selector: "app-root-not-found",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NotFoundComponent],
  template: `<app-not-found />`,
})
export default class RootNotFoundPage {}
