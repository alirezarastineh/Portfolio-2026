import { DOCUMENT } from "@angular/common";
import { ChangeDetectionStrategy, Component, computed, inject } from "@angular/core";
import { toSignal } from "@angular/core/rxjs-interop";
import { ActivatedRoute, RouterLink, type ResolveFn } from "@angular/router";
import type { MetaTag, RouteMeta } from "@analogjs/router";
import { NgIcon, provideIcons } from "@ng-icons/core";
import { lucideRss } from "@ng-icons/lucide";
import { map } from "rxjs";

import { PostListComponent } from "../../../components/post-list.component";
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

@Component({
  selector: "app-writing-page",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgIcon, PostListComponent, RouterLink],
  viewProviders: [provideIcons({ lucideRss })],
  host: { class: "block" },
  styles: `
    /* The tag shown: filled, where the others are outlined. */
    .tag[aria-current="page"] {
      border-color: color-mix(in oklab, var(--accent-orange) 60%, transparent);
      background-color: var(--accent-orange-soft);
      color: var(--foreground);
    }
    .tag-count {
      opacity: 0.7;
    }
  `,
  template: `
    <main id="main" class="pb-24 pt-28 lg:pt-32">
      <div class="container-site flex flex-col gap-10 lg:gap-12">
        <header class="flex flex-wrap items-end justify-between gap-x-8 gap-y-5">
          <div class="flex flex-col gap-4">
            <p class="eyebrow m-0 text-muted-foreground">
              <span aria-hidden="true">// </span>{{ lang.t().writing.subtitle }}
            </p>
            <h1 class="m-0 text-h1 text-foreground hyphens-auto">
              {{ lang.t().writing.heading }}
            </h1>
          </div>
          @if (posts().length) {
            <!-- A file, not a page: a plain link, so the router leaves it alone. -->
            <a
              class="press inline-flex h-9 items-center gap-2 rounded-lg border border-border px-3 font-mono text-meta text-foreground hover:border-accent-orange/50 hover:text-accent-orange"
              [href]="feed()"
              type="application/rss+xml"
            >
              <ng-icon name="lucideRss" size="14" aria-hidden="true" />
              {{ lang.t().writing.rss }}
            </a>
          }
        </header>

        @if (tags().length > 1) {
          <nav [attr.aria-label]="lang.t().writing.tags">
            <ul class="m-0 flex list-none flex-wrap gap-2 p-0" role="list">
              <li>
                <a
                  [class]="chip"
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
                    [class]="chip"
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
          <!-- Nothing to list, as terminal output. -->
          <div class="surface-card flex flex-col gap-2 p-6 font-mono text-meta">
            <p class="m-0 text-foreground" aria-hidden="true">
              <span class="text-accent-orange">&gt;</span> ls posts/{{ tag() ? " #" + tag() : "" }}
            </p>
            <p class="m-0 text-muted-foreground">
              (empty) —
              @if (tag() && posts().length) {
                <a class="link-underline" [routerLink]="[]" [queryParams]="{ tag: null }">{{
                  lang.t().writing.allPosts
                }}</a>
              } @else {
                {{ lang.t().writing.empty }} ·
                <a class="link-underline" [href]="feed()" type="application/rss+xml">{{
                  lang.t().writing.rss
                }}</a>
              }
            </p>
          </div>
        }
      </div>
    </main>
  `,
})
export default class WritingPageComponent {
  protected readonly lang = inject(LanguageService);

  /** A tag filter: a chip with a 32px target and its count; the one shown is filled. */
  protected readonly chip =
    "tag chip press h-8 gap-1.5 px-3 text-muted-foreground hover:border-accent-orange/60 hover:text-foreground";

  protected readonly tag = toSignal(
    inject(ActivatedRoute).queryParamMap.pipe(map((params) => params.get("tag"))),
    { initialValue: null },
  );

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
