import { DOCUMENT } from "@angular/common";
import { ChangeDetectionStrategy, Component, computed, inject } from "@angular/core";
import { toSignal } from "@angular/core/rxjs-interop";
import { ActivatedRoute, type ResolveFn } from "@angular/router";
import type { MetaTag, RouteMeta } from "@analogjs/router";
import { map } from "rxjs";

import { NotFoundComponent } from "../../../components/not-found.component";
import { DocStore } from "../../../content/doc.store";
import { legalDocSchema, type LegalDocPayload } from "../../../content/schema";
import { applyHead } from "../../../seo/head";
import { injectMarkNotFound } from "../../../seo/http-status";
import { languageAlternates, pageMeta, pageUrl, siteOrigin } from "../../../seo/seo-meta";
import { LanguageService } from "../../../services/language.service";

/**
 * The page's doc, or null for an unknown slug or one this locale lacks. Every
 * resolver below asks for it; the store fetches it once.
 */
async function legalDoc(docParam: string | null): Promise<LegalDocPayload | null> {
  const doc = legalDocSchema.safeParse(docParam);
  if (!doc.success) return null;
  const lang = inject(LanguageService);
  const found = await inject(DocStore).ensure(lang.lang(), "legal", doc.data);
  return found?.kind === "legal" ? found : null;
}

const docResolver: ResolveFn<LegalDocPayload | null> = (route) =>
  legalDoc(route.paramMap.get("doc"));

const titleResolver: ResolveFn<string> = async (route) => {
  const lang = inject(LanguageService);
  const name = lang.content().identity.name;
  const doc = await legalDoc(route.paramMap.get("doc"));
  return doc ? `${doc.title} · ${name}` : `404 · ${name}`;
};

const metaResolver: ResolveFn<MetaTag[]> = async (route) => {
  const lang = inject(LanguageService);
  const doc = await legalDoc(route.paramMap.get("doc"));
  if (!doc) return [{ name: "robots", content: "noindex" }];

  const content = lang.content();
  return pageMeta(content, lang.lang(), {
    title: doc.title,
    description: `${doc.title} — ${content.seo.siteName}`,
    url: pageUrl(siteOrigin(content), lang.lang(), `/legal/${doc.doc}`),
    robots: "index, follow",
  });
};

const headResolver: ResolveFn<true> = async (route): Promise<true> => {
  const lang = inject(LanguageService);
  const document = inject(DOCUMENT);
  const notFound = injectMarkNotFound();
  const doc = await legalDoc(route.paramMap.get("doc"));
  if (!doc) {
    notFound();
    return true;
  }

  // Both legal pages exist in both languages (the backfill guarantees it).
  const origin = siteOrigin(lang.content());
  const path = `/legal/${doc.doc}`;
  applyHead(document, {
    canonical: pageUrl(origin, lang.lang(), path),
    alternates: languageAlternates(origin, path, pageUrl(origin, "en", path)),
  });
  return true;
};

/** `/en/legal/imprint`, `/de/legal/privacy`: the same slugs in both languages, text from the CMS. */
export const routeMeta: RouteMeta = {
  title: titleResolver,
  meta: metaResolver,
  resolve: { doc: docResolver, head: headResolver },
};

@Component({
  selector: "app-legal-page",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NotFoundComponent],
  host: { class: "block" },
  template: `
    @if (doc(); as page) {
      <main id="main" class="mx-auto max-w-3xl px-6 pb-24 pt-32 sm:px-8">
        <article class="flex flex-col gap-10">
          <header class="flex flex-col gap-3">
            <p class="eyebrow m-0 text-muted-foreground">
              <span aria-hidden="true">// </span>{{ lang.t().legal.updated }}
              <time [attr.datetime]="page.updatedAt">{{ updated() }}</time>
            </p>
            <h1 class="m-0 text-3xl font-medium tracking-tight text-foreground sm:text-4xl">
              {{ page.title }}
            </h1>
          </header>

          <!-- Sanitized on write by the API; Angular sanitizes again here. -->
          <div class="prose-body" [innerHTML]="page.body"></div>
        </article>
      </main>
    } @else {
      <app-not-found [locale]="lang.lang()" />
    }
  `,
})
export default class LegalPageComponent {
  protected readonly lang = inject(LanguageService);

  protected readonly doc = toSignal(
    inject(ActivatedRoute).data.pipe(
      map((data) => (data["doc"] as LegalDocPayload | null) ?? null),
    ),
    { initialValue: null },
  );

  /** In UTC, so the server and the browser print the same day. */
  protected readonly updated = computed(() => {
    const page = this.doc();
    if (!page) return "";
    return new Intl.DateTimeFormat(this.lang.lang(), { dateStyle: "long", timeZone: "UTC" }).format(
      new Date(page.updatedAt),
    );
  });
}
