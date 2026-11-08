import { DOCUMENT } from "@angular/common";
import { ChangeDetectionStrategy, Component, computed, inject } from "@angular/core";
import { toSignal } from "@angular/core/rxjs-interop";
import { ActivatedRoute, RouterLink, type ResolveFn } from "@angular/router";
import type { MetaTag, RouteMeta } from "@analogjs/router";
import { map } from "rxjs";

import { PostListComponent } from "../../../components/post-list.component";
import type { Locale } from "../../../content/schema";
import { applyHead } from "../../../seo/head";
import { feedsOf, languageAlternates, pageMeta, pageUrl, siteOrigin } from "../../../seo/seo-meta";
import { writingJsonLd } from "../../../seo/structured-data";
import { LanguageService } from "../../../services/language.service";

const titleResolver: ResolveFn<string> = () => {
  const content = inject(LanguageService).content();
  return `${content.ui.writing.heading} · ${content.identity.name}`;
};

/** An empty index is a real page, but not one worth a search result. */
const metaResolver: ResolveFn<MetaTag[]> = () => {
  const lang = inject(LanguageService);
  const content = lang.content();
  return pageMeta(content, lang.lang(), {
    title: `${content.ui.writing.heading} · ${content.identity.name}`,
    description: content.ui.writing.subtitle,
    url: pageUrl(siteOrigin(content), lang.lang(), "/writing"),
    robots: content.posts.length > 0 ? "index, follow" : "noindex, follow",
  });
};

/** A `?tag=` view is the same page filtered, so every one is canonical to the index. */
const headResolver: ResolveFn<true> = () => {
  const lang = inject(LanguageService);
  const content = lang.content();
  const origin = siteOrigin(content);
  applyHead(inject(DOCUMENT), {
    canonical: pageUrl(origin, lang.lang(), "/writing"),
    alternates: languageAlternates(origin, "/writing", pageUrl(origin, "en", "/writing")),
    jsonLd: writingJsonLd(content, lang.lang(), origin),
    feeds: feedsOf(content, lang.lang()),
  });
  return true;
};

/** `/en/writing`: every post in this language, newest first. */
export const routeMeta: RouteMeta = {
  title: titleResolver,
  meta: metaResolver,
  resolve: { head: headResolver },
};

/** Only a stale or hand-typed `?tag=` gets here: every tag in the row has posts. */
const NONE_TAGGED = {
  en: "No posts with this tag.",
  de: "Keine Artikel zu diesem Thema.",
} as const satisfies Record<Locale, string>;

@Component({
  selector: "app-writing-page",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PostListComponent, RouterLink],
  host: { class: "block" },
  styles: `
    .tag-row {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .tag {
      display: inline-flex;
      align-items: center;
      gap: 0.375rem;
      min-height: 2rem;
      padding-inline: 0.75rem;
      border: 1px solid var(--border);
      border-radius: var(--radius);
      color: var(--muted-foreground);
      font-size: 0.9375rem;
      white-space: nowrap;
      touch-action: manipulation;
    }
    /* The tag shown: filled in the text colour, since orange means act or live. */
    .tag[aria-current="page"] {
      border-color: var(--foreground);
      background: var(--foreground);
      color: var(--background);
    }
    .tag-count {
      font-family: var(--font-data);
      font-size: 0.8125rem;
    }
    /* One row on phones, running to the edge of the screen, where a tag is cut: that shows there
       is more. The padding keeps focus rings inside and lets the last tag scroll clear. */
    @media (width < 48rem) {
      .tag-row {
        flex-wrap: nowrap;
        margin: -0.25rem calc(var(--gutter) * -1) -0.25rem -0.25rem;
        padding: 0.25rem var(--gutter) 0.25rem 0.25rem;
        overflow-x: auto;
        scroll-snap-type: x proximity;
        scroll-padding-inline: 0.25rem;
        scrollbar-width: none;
      }
      .tag {
        scroll-snap-align: start;
      }
    }
    /* Forced colours drop the fill, and with it which one this is. */
    @media (forced-colors: active) {
      .tag[aria-current="page"] {
        forced-color-adjust: none;
        border-color: Highlight;
        background: Highlight;
        color: HighlightText;
      }
    }
    @media (hover: hover) {
      .tag:not([aria-current]):hover {
        border-color: var(--border-strong);
        color: var(--foreground);
      }
    }
    @media (pointer: coarse) {
      .tag {
        min-height: 2.75rem;
      }
    }
  `,
  template: `
    <main id="main" class="pb-24 pt-28 lg:pt-32">
      <div class="container-site flex flex-col gap-8 lg:gap-12">
        <header class="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
          <h1 class="m-0 text-h1 text-foreground hyphens-auto">
            {{ lang.t().writing.heading }}
          </h1>
          @if (posts().length) {
            <!-- A file, not a page: a plain link, so the router leaves it alone. -->
            <a
              class="link-underline inline-flex items-center pointer-coarse:min-h-11"
              [href]="feed()"
              type="application/rss+xml"
              >{{ lang.t().writing.rss }}</a
            >
          }
        </header>

        @if (tags().length > 1) {
          <nav [attr.aria-label]="lang.t().writing.tags">
            <ul class="tag-row" role="list">
              <li>
                <a
                  class="tag press"
                  [attr.aria-current]="tag() ? null : 'page'"
                  [routerLink]="[]"
                  [queryParams]="{ tag: null }"
                  >{{ lang.t().writing.allPosts }}
                  <span class="tag-count tabular-nums">{{ posts().length }}</span></a
                >
              </li>
              @for (t of tags(); track t.name) {
                <li>
                  <a
                    class="tag press"
                    [attr.aria-current]="tag() === t.name ? 'page' : null"
                    [routerLink]="[]"
                    [queryParams]="{ tag: t.name }"
                    >#{{ t.name }} <span class="tag-count tabular-nums">{{ t.count }}</span></a
                  >
                </li>
              }
            </ul>
          </nav>
        }

        @if (visible().length) {
          <app-post-list [posts]="visible()" />
        } @else {
          <p class="m-0 text-muted-foreground">
            @if (tag() && posts().length) {
              {{ noneTagged() }}
              <a class="link-underline" [routerLink]="[]" [queryParams]="{ tag: null }">{{
                lang.t().writing.allPosts
              }}</a>
            } @else {
              {{ lang.t().writing.empty }}
              <a class="link-underline" [href]="feed()" type="application/rss+xml">{{
                lang.t().writing.rss
              }}</a>
            }
          </p>
        }
      </div>
    </main>
  `,
})
export default class WritingPageComponent {
  protected readonly lang = inject(LanguageService);

  protected readonly tag = toSignal(
    inject(ActivatedRoute).queryParamMap.pipe(map((params) => params.get("tag"))),
    { initialValue: null },
  );

  protected readonly noneTagged = computed(() => NONE_TAGGED[this.lang.lang()]);
  protected readonly posts = computed(() => this.lang.content().posts);
  protected readonly feed = computed(() => `/${this.lang.lang()}/rss.xml`);

  /** Every tag in use and how many posts have it, most used first. */
  protected readonly tags = computed(() => {
    const counts = new Map<string, number>();
    for (const post of this.posts()) {
      for (const t of post.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
    }
    return [...counts.entries()]
      .sort(([a, x], [b, y]) => y - x || a.localeCompare(b))
      .map(([name, count]) => ({ name, count }));
  });

  protected readonly visible = computed(() => {
    const tag = this.tag();
    return tag ? this.posts().filter((post) => post.tags.includes(tag)) : this.posts();
  });
}
