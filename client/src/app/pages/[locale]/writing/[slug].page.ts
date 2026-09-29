import { DOCUMENT } from "@angular/common";
import { ChangeDetectionStrategy, Component, computed, inject } from "@angular/core";
import { toSignal } from "@angular/core/rxjs-interop";
import { ActivatedRoute, RouterLink, type ResolveFn } from "@angular/router";
import type { MetaTag, RouteMeta } from "@analogjs/router";
import { NgIcon, provideIcons } from "@ng-icons/core";
import { lucideArrowLeft } from "@ng-icons/lucide";
import { map } from "rxjs";

import { AskLauncherService } from "../../../ask/ask-launcher.service";
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
import { CHROME } from "../../../i18n/chrome";
import { fmt } from "../../../i18n/interpolate";
import { applyHead } from "../../../seo/head";
import { injectMarkNotFound } from "../../../seo/http-status";
import {
  socialCard,
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
    image: socialCard(origin, lang.lang(), "writing", doc.slug),
    imageAlt: title,
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
      <main id="main" class="pb-24 pt-28 lg:pt-32">
        <!-- Fills as the page scrolls (styles/motion.css). -->
        <div class="reading-progress" aria-hidden="true"></div>
        <article class="container-site flex flex-col gap-10 lg:gap-12">
          <header class="grid lg:grid-cols-12 lg:gap-x-(--col-gap)">
            <div class="flex flex-col gap-5 lg:col-span-7">
              <app-breadcrumb [items]="crumbs()" [locale]="lang.lang()" />
              <h1 class="m-0 text-balance text-h1 text-foreground hyphens-auto">
                {{ p.title }}
              </h1>
              @if (p.excerpt) {
                <p class="m-0 max-w-[46ch] text-pretty text-lead text-muted-foreground">
                  {{ p.excerpt }}
                </p>
              }
              <p class="m-0 flex flex-wrap gap-x-2 font-mono text-meta text-muted-foreground">
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
                        class="chip press h-8 px-3 text-muted-foreground hover:border-accent-orange/60 hover:text-foreground"
                        [routerLink]="['/', lang.lang(), 'writing']"
                        [queryParams]="{ tag: t }"
                        >#{{ t }}</a
                      >
                    </li>
                  }
                </ul>
              }
            </div>
          </header>

          @if (p.cover) {
            <div class="aspect-video overflow-hidden rounded-2xl border border-border bg-card">
              <!-- Bound, not static: the server would print static inputs
                   on <app-picture> as attributes too. -->
              <app-picture
                [image]="p.cover"
                [priority]="true"
                [sizes]="'(min-width: 1280px) 1184px, 100vw'"
                [imgClass]="'block size-full object-cover'"
              />
            </div>
          }

          <div class="grid gap-12 lg:grid-cols-12 lg:gap-x-(--col-gap)">
            @if (p.toc.length > 1) {
              <aside class="lg:col-span-3 lg:col-start-10 lg:row-start-1">
                <app-toc
                  class="lg:sticky lg:top-28"
                  [items]="p.toc"
                  [label]="lang.t().caseStudy.toc"
                />
              </aside>
            }
            <div class="min-w-0 lg:col-span-8 lg:row-start-1">
              <app-prose-body [html]="p.body" [toc]="p.toc" />
            </div>
          </div>

          <footer class="flex flex-col gap-6 border-t border-border pt-8">
            <button
              type="button"
              class="press inline-flex min-h-11 cursor-pointer items-center gap-2 self-start rounded-lg border border-border px-5 py-2 text-left font-mono text-meta text-foreground hover:border-border-strong"
              (click)="ask(p.title)"
            >
              <span class="text-accent-orange" aria-hidden="true">&gt;_</span>
              {{ chrome().ask }}
            </button>
            <div class="flex flex-wrap items-center justify-between gap-6">
              <app-share-links [url]="url()" [title]="p.title" [locale]="lang.lang()" />
              <a
                class="link-underline inline-flex items-center gap-2 font-mono text-sm"
                [routerLink]="['/', lang.lang(), 'writing']"
              >
                <ng-icon name="lucideArrowLeft" size="14" aria-hidden="true" />
                {{ lang.t().writing.allPosts }}
              </a>
            </div>
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

  private readonly launcher = inject(AskLauncherService);
  protected readonly chrome = computed(() => CHROME[this.lang.lang()].post);

  /** The assistant, in the sheet, asked what this post is about. */
  protected ask(title: string): void {
    this.launcher.ask(fmt(this.chrome().question, { title }), "post");
  }

  protected day(iso: string): string {
    return formatDay(iso, this.lang.lang());
  }
}
