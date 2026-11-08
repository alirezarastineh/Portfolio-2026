import { ChangeDetectionStrategy, Component, computed, inject, input } from "@angular/core";
import { Router, RouterLink } from "@angular/router";

import { AskLauncherService } from "../ask/ask-launcher.service";
import { ContentStore } from "../content/content.store";
import { suggestPages, type PageSuggestion } from "../content/did-you-mean";
import type { Locale } from "../content/locale";
import type { AppContent } from "../content/schema";
import { CHROME } from "../i18n/chrome";
import { LanguageService } from "../services/language.service";

interface Copy {
  title: string;
  body: string;
  home: string;
  ask: string;
}

/** The CMS's defaults, for an address outside `/en` and `/de`, where no content has loaded. */
const COPY: Record<Locale, Copy> = {
  en: {
    title: "This page isn’t here.",
    body: "It may have moved, or the link is wrong.",
    home: "Back to the homepage",
    ask: "Ask about my work",
  },
  de: {
    title: "Diese Seite gibt es nicht.",
    body: "Vielleicht ist sie umgezogen, oder der Link stimmt nicht.",
    home: "Zur Startseite",
    ask: "Fragen zu meiner Arbeit",
  },
};

/** Every page this language's content has, but home (linked anyway). */
function knownPages(locale: Locale, content: AppContent): PageSuggestion[] {
  const at = (path: string) => `/${locale}${path}`;
  return [
    ...(content.posts.length ? [{ path: at("/writing"), label: content.ui.nav.writing }] : []),
    ...content.projects
      .filter((p) => p.hasCaseStudy)
      .map((p) => ({ path: at(`/work/${p.slug}`), label: p.name })),
    ...content.posts.map((p) => ({ path: at(`/writing/${p.slug}`), label: p.title })),
    ...content.legal.map((l) => ({ path: at(`/legal/${l.doc}`), label: l.title })),
  ];
}

/**
 * The 404 body: what happened, closing on the headline's orange stop, the pages it most likely
 * meant (by edit distance over this language's case studies, posts and legal pages), and a way
 * home or to the assistant. With a locale it renders in that language (inside the site chrome), in
 * the CMS's words; without one — an address outside `/en` and `/de` — it offers both, the first
 * as the page's heading, without suggestions (no content has loaded). "Ask" opens the
 * assistant's panel, which only the site chrome has.
 */
@Component({
  selector: "app-not-found",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  host: { class: "block" },
  template: `
    <main
      id="main"
      class="container-site flex min-h-[70vh] flex-col justify-center gap-12 pb-24 pt-32"
    >
      @for (entry of entries(); track entry.locale; let first = $first) {
        <section class="flex max-w-5xl flex-col items-start gap-6" [attr.lang]="entry.locale">
          <div class="flex flex-col gap-4">
            @if (first) {
              <h1 class="m-0 text-h1 text-foreground">
                {{ entry.title
                }}<span class="text-signal" aria-hidden="true">{{ entry.stop }}</span>
              </h1>
            } @else {
              <p class="m-0 text-title text-foreground">
                {{ entry.title
                }}<span class="text-signal" aria-hidden="true">{{ entry.stop }}</span>
              </p>
            }
            <p class="m-0 max-w-xl text-pretty text-muted-foreground">{{ entry.copy.body }}</p>
            @if (entry.suggestions.length) {
              <p class="m-0 wrap-anywhere">
                {{ entry.didYouMean }}:
                @for (page of entry.suggestions; track page.path; let last = $last) {
                  <a class="link-underline" [routerLink]="page.path">{{ page.label }}</a
                  >{{ last ? "?" : ", " }}
                }
              </p>
            }
          </div>
          <div class="flex flex-wrap items-center gap-x-6 gap-y-2">
            <a class="btn btn-solid press" [routerLink]="['/', entry.locale]">{{
              entry.copy.home
            }}</a>
            @if (locale()) {
              <button
                type="button"
                class="btn btn-quiet press"
                (click)="launcher.openSheet('button')"
              >
                {{ entry.copy.ask }}
              </button>
            }
          </div>
        </section>
      }
    </main>
  `,
})
export class NotFoundComponent {
  /** Null renders both languages. */
  readonly locale = input<Locale | null>(null);

  protected readonly launcher = inject(AskLauncherService);
  private readonly store = inject(ContentStore);
  private readonly router = inject(Router);
  private readonly lang = inject(LanguageService);

  /**
   * The address asked for. The page signal re-reads it after a navigation:
   * a case study kept on screen from one missing slug to the next keeps this
   * component too.
   */
  private readonly url = computed(() => {
    this.lang.page();
    return this.router.url;
  });

  protected readonly entries = computed(() => {
    const locale = this.locale();
    const locales: Locale[] = locale ? [locale] : ["en", "de"];
    return locales.map((l) => {
      const content = this.store.content(l)();
      const copy = content ? { ...content.ui.notFound, ask: content.ui.hero.askCta } : COPY[l];
      const title = copy.title.trim();
      return {
        locale: l,
        copy,
        // As the hero's headline: the stop is the site's mark, wherever the sentence has one.
        title: title.endsWith(".") ? title.slice(0, -1) : title,
        stop: title.endsWith(".") ? "." : "",
        didYouMean: CHROME[l].notFound.didYouMean,
        suggestions: content && locale ? suggestPages(this.url(), knownPages(l, content)) : [],
      };
    });
  });
}
