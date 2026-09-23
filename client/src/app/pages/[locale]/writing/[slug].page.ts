import { DOCUMENT } from "@angular/common";
import { ChangeDetectionStrategy, Component, computed, inject } from "@angular/core";
import { toSignal } from "@angular/core/rxjs-interop";
import { ActivatedRoute, RouterLink, type ResolveFn } from "@angular/router";
import type { MetaTag, RouteMeta } from "@analogjs/router";
import { NgIcon, provideIcons } from "@ng-icons/core";
import { lucideArrowLeft } from "@ng-icons/lucide";
import { map } from "rxjs";

import { BreadcrumbComponent, type BreadcrumbItem } from "../../../components/breadcrumb.component";
import { NotFoundComponent } from "../../../components/not-found.component";
import { PictureComponent } from "../../../components/picture.component";
import { ProseBodyComponent } from "../../../components/prose-body.component";
import { ShareLinksComponent } from "../../../components/share-links.component";
import { TocComponent } from "../../../components/toc.component";
import { DocStore } from "../../../content/doc.store";
import { switchTargets } from "../../../content/locale";
import { formatDay } from "../../../content/period";
import type { PostDoc } from "../../../content/schema";
import { fmt } from "../../../i18n/interpolate";
import { applyHead } from "../../../seo/head";
import { injectMarkNotFound } from "../../../seo/http-status";
import {
  absoluteImage,
  docLanguageAlternates,
  feedsOf,
  pageMeta,
  pageUrl,
  siteOrigin,
} from "../../../seo/seo-meta";
import { postJsonLd } from "../../../seo/structured-data";
import { LanguageService } from "../../../services/language.service";

const SLUG = /^[a-z0-9-]{1,80}$/;

/** The post, or null: an unknown slug, or a post not written in this language. */
async function post(slug: string | null): Promise<PostDoc | null> {
  if (!slug || !SLUG.test(slug)) return null;
  const lang = inject(LanguageService);
  const doc = await inject(DocStore).ensure(lang.lang(), "posts", slug);
  return doc?.kind === "post" ? doc : null;
}

const postResolver: ResolveFn<PostDoc | null> = (route) => post(route.paramMap.get("slug"));

const titleResolver: ResolveFn<string> = async (route) => {
  const name = inject(LanguageService).content().identity.name;
  const doc = await post(route.paramMap.get("slug"));
  return doc ? `${doc.seo.title || doc.title} · ${name}` : `404 · ${name}`;
};

const metaResolver: ResolveFn<MetaTag[]> = async (route) => {
  const lang = inject(LanguageService);
  const doc = await post(route.paramMap.get("slug"));
  if (!doc) return [{ name: "robots", content: "noindex" }];

  const content = lang.content();
  const origin = siteOrigin(content);
  const title = doc.seo.title || doc.title;
  return pageMeta(content, lang.lang(), {
    title: `${title} · ${content.identity.name}`,
    description: doc.seo.description || doc.excerpt || content.seo.description,
    url: pageUrl(origin, lang.lang(), `/writing/${doc.slug}`),
    robots: "index, follow",
    ogType: "article",
    ogTitle: title,
    twitterTitle: title,
    image: absoluteImage(origin, doc.cover),
    imageAlt: doc.cover?.alt,
  });
};

/**
 * A post first published elsewhere names that copy as canonical, and then
 * lists no language alternates: hreflang between pages that point their
 * canonical away is ignored anyway.
 */
const headResolver: ResolveFn<true> = async (route): Promise<true> => {
  const lang = inject(LanguageService);
  const document = inject(DOCUMENT);
  const notFound = injectMarkNotFound();
  const doc = await post(route.paramMap.get("slug"));
  if (!doc) {
    notFound();
    return true;
  }

  const content = lang.content();
  const locale = lang.lang();
  const origin = siteOrigin(content);
  const path = `/${locale}/writing/${doc.slug}`;
  applyHead(document, {
    canonical: doc.canonicalUrl || `${origin}${path}`,
    alternates: doc.canonicalUrl ? {} : docLanguageAlternates(origin, doc.alternates),
    jsonLd: postJsonLd(content, locale, origin, doc),
    feeds: feedsOf(content, locale),
  });
  // Written in one language only: the switch leads to the other one's index.
  lang.pinAlternates(
    path,
    switchTargets(doc.alternates, (l) => `/${l}/writing`),
  );
  return true;
};

/** `/en/writing/some-post`. */
export const routeMeta: RouteMeta = {
  title: titleResolver,
  meta: metaResolver,
  resolve: { post: postResolver, head: headResolver },
};

@Component({
  selector: "app-post-page",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    BreadcrumbComponent,
    NgIcon,
    NotFoundComponent,
    PictureComponent,
    ProseBodyComponent,
    RouterLink,
    ShareLinksComponent,
    TocComponent,
  ],
  viewProviders: [provideIcons({ lucideArrowLeft })],
  host: { class: "block" },
  template: `
    @if (post(); as p) {
      <main class="px-6 pb-24 pt-28 sm:px-8 lg:px-12 lg:pt-32">
        <article class="mx-auto flex max-w-6xl flex-col gap-10">
          <header class="flex max-w-3xl flex-col gap-5">
            <app-breadcrumb [items]="crumbs()" [locale]="lang.lang()" />
            <h1
              class="m-0 text-balance text-4xl font-medium leading-tight tracking-tight text-foreground sm:text-5xl"
            >
              {{ p.title }}
            </h1>
            @if (p.excerpt) {
              <p class="m-0 text-pretty text-lg leading-relaxed text-muted-foreground">
                {{ p.excerpt }}
              </p>
            }
            <p class="m-0 flex flex-wrap gap-x-2 font-mono text-xs text-muted-foreground">
              <span>
                {{ lang.t().writing.published }}
                <time [attr.datetime]="p.publishedAt">{{ day(p.publishedAt) }}</time>
              </span>
              @if (wasUpdated()) {
                <span aria-hidden="true">·</span>
                <span>
                  {{ lang.t().writing.updated }}
                  <time [attr.datetime]="p.updatedAt">{{ day(p.updatedAt) }}</time>
                </span>
              }
              <span aria-hidden="true">·</span>
              <span>{{ readingTime() }}</span>
            </p>
            @if (p.tags.length) {
              <ul
                class="m-0 flex list-none flex-wrap gap-2 p-0"
                role="list"
                [attr.aria-label]="lang.t().writing.tags"
              >
                @for (t of p.tags; track t) {
                  <li>
                    <a
                      class="font-mono text-xs text-muted-foreground underline decoration-accent-orange/60 underline-offset-4 transition-colors hover:text-foreground"
                      [routerLink]="['/', lang.lang(), 'writing']"
                      [queryParams]="{ tag: t }"
                      >#{{ t }}</a
                    >
                  </li>
                }
              </ul>
            }
          </header>

          @if (p.cover) {
            <div class="aspect-video overflow-hidden rounded-2xl border border-border bg-card">
              <app-picture
                [image]="p.cover"
                [priority]="true"
                sizes="(min-width: 1200px) 1152px, 100vw"
                imgClass="block size-full object-cover"
              />
            </div>
          }

          <div class="grid gap-12 lg:grid-cols-[minmax(0,1fr)_15rem]">
            @if (p.toc.length > 1) {
              <aside class="lg:col-start-2 lg:row-start-1">
                <app-toc
                  class="lg:sticky lg:top-28"
                  [items]="p.toc"
                  [label]="lang.t().caseStudy.toc"
                />
              </aside>
            }
            <div class="min-w-0 lg:col-start-1 lg:row-start-1">
              <app-prose-body [html]="p.body" [toc]="p.toc" />
            </div>
          </div>

          <footer
            class="flex flex-wrap items-center justify-between gap-6 border-t border-border pt-8"
          >
            <app-share-links [url]="url()" [title]="p.title" [locale]="lang.lang()" />
            <a
              class="inline-flex items-center gap-2 font-mono text-sm text-foreground underline decoration-accent-orange/60 underline-offset-4 transition-colors hover:decoration-accent-orange"
              [routerLink]="['/', lang.lang(), 'writing']"
            >
              <ng-icon name="lucideArrowLeft" size="14" aria-hidden="true" />
              {{ lang.t().writing.allPosts }}
            </a>
          </footer>
        </article>
      </main>
    } @else {
      <app-not-found [locale]="lang.lang()" />
    }
  `,
})
export default class PostPageComponent {
  protected readonly lang = inject(LanguageService);

  protected readonly post = toSignal(
    inject(ActivatedRoute).data.pipe(map((data) => (data["post"] as PostDoc | null) ?? null)),
    { initialValue: null },
  );

  protected readonly crumbs = computed<BreadcrumbItem[]>(() => {
    const l = this.lang.lang();
    return [
      { label: this.lang.content().identity.name, link: ["/", l] },
      { label: this.lang.t().writing.heading, link: ["/", l, "writing"] },
      { label: this.post()?.title ?? "" },
    ];
  });

  /** The absolute address to share: the canonical one when it lives elsewhere. */
  protected readonly url = computed(() => {
    const p = this.post();
    if (!p) return "";
    const origin = siteOrigin(this.lang.content());
    return p.canonicalUrl || pageUrl(origin, this.lang.lang(), `/writing/${p.slug}`);
  });

  /** Shown when the post changed on a later day than it was published. */
  protected readonly wasUpdated = computed(() => {
    const p = this.post();
    return !!p && p.updatedAt.slice(0, 10) > p.publishedAt.slice(0, 10);
  });

  protected readonly readingTime = computed(() =>
    fmt(this.lang.t().writing.readingTime, { n: this.post()?.readingMinutes ?? 1 }),
  );

  protected day(iso: string): string {
    return formatDay(iso, this.lang.lang());
  }
}
