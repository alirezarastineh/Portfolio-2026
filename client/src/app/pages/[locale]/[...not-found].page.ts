import { ChangeDetectionStrategy, Component, inject } from "@angular/core";
import type { ResolveFn } from "@angular/router";
import type { RouteMeta } from "@analogjs/router";

import { NotFoundComponent } from "../../components/not-found.component";
import { notFoundResolver } from "../../seo/http-status";
import { LanguageService } from "../../services/language.service";

const titleResolver: ResolveFn<string> = () => {
  const lang = inject(LanguageService);
  const name = lang.content().identity.name;
  return lang.lang() === "de"
    ? `404 — Seite nicht gefunden · ${name}`
    : `404 — Page not found · ${name}`;
};

/** An unknown address under a real locale: a 404 in that language, inside the site. */
export const routeMeta: RouteMeta = {
  title: titleResolver,
  meta: [{ name: "robots", content: "noindex" }],
  resolve: { status: notFoundResolver },
};

@Component({
  selector: "app-locale-not-found",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NotFoundComponent],
  template: `<app-not-found [locale]="lang.lang()" />`,
})
export default class LocaleNotFoundPage {
  protected readonly lang = inject(LanguageService);
}
