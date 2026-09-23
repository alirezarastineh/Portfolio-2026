import { DOCUMENT } from "@angular/common";
import { ChangeDetectionStrategy, Component, computed, inject } from "@angular/core";
import { toSignal } from "@angular/core/rxjs-interop";
import { ActivatedRoute, RouterLink, type ResolveFn } from "@angular/router";
import type { MetaTag, RouteMeta } from "@analogjs/router";
import { NgIcon, provideIcons } from "@ng-icons/core";
import { lucideRss } from "@ng-icons/lucide";
import { map } from "rxjs";

import { PictureComponent } from "../../../components/picture.component";
import { formatDay } from "../../../content/period";
import { fmt } from "../../../i18n/interpolate";
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
  imports: [NgIcon, PictureComponent, RouterLink],
  viewProviders: [provideIcons({ lucideRss })],
  host: { class: "block" },
  template: `
    <main class="mx-auto flex max-w-4xl flex-col gap-12 px-6 pb-24 pt-32 sm:px-8">
      <header class="flex flex-col gap-4">
        <p class="m-0 font-mono text-xs uppercase tracking-[0.22em] text-muted-foreground">
          <span aria-hidden="true">// </span>{{ lang.t().writing.subtitle }}
        </p>
        <div class="flex flex-wrap items-end justify-between gap-4">
          <h1 class="m-0 text-4xl font-medium tracking-tight text-foreground sm:text-5xl">
            {{ lang.t().writing.heading }}
          </h1>
          @if (posts().length) {
            <!-- A file, not a page: a plain link, so the router leaves it alone. -->
            <a
              class="inline-flex h-9 items-center gap-2 rounded-lg border border-border px-3 font-mono text-[0.78rem] text-foreground transition-colors duration-200 hover:border-accent-orange/50 hover:text-accent-orange"
              [href]="'/' + lang.lang() + '/rss.xml'"
              type="application/rss+xml"
            >
              <ng-icon name="lucideRss" size="14" aria-hidden="true" />
              {{ lang.t().writing.rss }}
            </a>
          }
        </div>
      </header>

      @if (tags().length > 1) {
        <nav [attr.aria-label]="lang.t().writing.tags">
          <ul class="m-0 flex list-none flex-wrap gap-2 p-0" role="list">
            <li>
              <a
                [class]="chip"
                [class.border-accent-orange]="!tag()"
                [class.text-foreground]="!tag()"
                [attr.aria-current]="tag() ? null : 'page'"
                [routerLink]="[]"
                [queryParams]="{ tag: null }"
                >{{ lang.t().writing.allPosts }}</a
              >
            </li>
            @for (t of tags(); track t) {
              <li>
                <a
                  [class]="chip"
                  [class.border-accent-orange]="tag() === t"
                  [class.text-foreground]="tag() === t"
                  [attr.aria-current]="tag() === t ? 'page' : null"
                  [routerLink]="[]"
                  [queryParams]="{ tag: t }"
                  >#{{ t }}</a
                >
              </li>
            }
          </ul>
        </nav>
      }

      @if (visible().length) {
        <ol class="m-0 flex list-none flex-col gap-4 p-0" role="list">
          @for (post of visible(); track post.slug) {
            <li>
              <article
                class="group relative grid gap-5 rounded-2xl border border-border bg-card/40 p-6 transition-colors duration-200 hover:border-accent-indigo/50 sm:grid-cols-[minmax(0,1fr)_10rem] sm:p-8"
              >
                <div class="flex flex-col gap-3">
                  <p class="m-0 font-mono text-xs text-muted-foreground">
                    <time [attr.datetime]="post.publishedAt">{{ day(post.publishedAt) }}</time>
                    · {{ readingTime(post.readingMinutes) }}
                  </p>
                  <h2
                    class="m-0 text-xl font-medium leading-snug tracking-tight text-foreground sm:text-2xl"
                  >
                    <!-- The whole card is the link's hit area (after:inset-0). -->
                    <a
                      class="after:absolute after:inset-0 after:rounded-2xl"
                      [routerLink]="['/', lang.lang(), 'writing', post.slug]"
                      >{{ post.title }}</a
                    >
                  </h2>
                  @if (post.excerpt) {
                    <p class="m-0 text-pretty leading-relaxed text-muted-foreground">
                      {{ post.excerpt }}
                    </p>
                  }
                  @if (post.tags.length) {
                    <ul
                      class="m-0 flex list-none flex-wrap gap-2 p-0"
                      role="list"
                      [attr.aria-label]="lang.t().writing.tags"
                    >
                      @for (t of post.tags; track t) {
                        <li class="font-mono text-xs text-muted-foreground">#{{ t }}</li>
                      }
                    </ul>
                  }
                </div>
                @if (post.cover) {
                  <div
                    class="hidden aspect-square overflow-hidden rounded-xl border border-border sm:block"
                  >
                    <app-picture
                      [image]="post.cover"
                      alt=""
                      sizes="10rem"
                      imgClass="block size-full object-cover"
                    />
                  </div>
                }
              </article>
            </li>
          }
        </ol>
      } @else {
        <p class="m-0 font-mono text-sm text-muted-foreground">
          <span class="text-accent-orange" aria-hidden="true">&gt; </span
          >{{ lang.t().writing.empty }}
        </p>
      }
    </main>
  `,
})
export default class WritingPageComponent {
  protected readonly lang = inject(LanguageService);

  protected readonly chip =
    "inline-flex h-8 items-center rounded-full border border-border px-3 font-mono text-xs text-muted-foreground transition-colors duration-200 hover:border-accent-orange/60 hover:text-foreground";

  protected readonly tag = toSignal(
    inject(ActivatedRoute).queryParamMap.pipe(map((params) => params.get("tag"))),
    { initialValue: null },
  );

  protected readonly posts = computed(() => this.lang.content().posts);

  /** Every tag in use, most used first. */
  protected readonly tags = computed(() => {
    const counts = new Map<string, number>();
    for (const post of this.posts()) {
      for (const t of post.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
    }
    return [...counts.entries()]
      .sort(([a, x], [b, y]) => y - x || a.localeCompare(b))
      .map(([t]) => t);
  });

  protected readonly visible = computed(() => {
    const tag = this.tag();
    return tag ? this.posts().filter((post) => post.tags.includes(tag)) : this.posts();
  });

  protected day(iso: string): string {
    return formatDay(iso, this.lang.lang());
  }

  protected readingTime(minutes: number): string {
    return fmt(this.lang.t().writing.readingTime, { n: minutes });
  }
}
