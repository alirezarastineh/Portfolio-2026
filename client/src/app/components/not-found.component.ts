import { ChangeDetectionStrategy, Component, computed, inject, input } from "@angular/core";
import { Router, RouterLink } from "@angular/router";

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
    title: "404: route not found",
    body: "This page does not exist, or it moved.",
    home: "Back to the homepage",
    ask: "ask my portfolio",
  },
  de: {
    title: "404: Seite nicht gefunden",
    body: "Diese Seite gibt es nicht, oder sie ist umgezogen.",
    home: "Zur Startseite",
    ask: "frag mein Portfolio",
  },
};

/** How much of the address the shell line repeats. */
const MAX_PATH = 64;

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
 * The 404 body, as terminal output: the shell's own complaint about the
 * address, then what happened, the pages it most likely meant (by edit
 * distance over this language's case studies, posts and legal pages), and a
 * way home or to the assistant. With a locale it renders in that language
 * (inside the site chrome), in the CMS's words; without one — an address
 * outside `/en` and `/de` — it offers both, without suggestions (no content
 * has loaded). "Ask" leads to the About terminal.
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
      @for (entry of entries(); track entry.locale) {
        <section class="flex max-w-3xl flex-col gap-4 font-mono" [attr.lang]="entry.locale">
          <p class="m-0 break-all text-meta text-muted-foreground">
            zsh: {{ entry.command }}: {{ path() }}
          </p>
          <h1 class="m-0 text-2xl font-medium tracking-tight text-foreground sm:text-3xl">
            <span class="text-accent-orange" aria-hidden="true">&gt; </span>{{ entry.copy.title }}
          </h1>
          <p class="m-0 max-w-xl text-pretty font-sans leading-relaxed text-muted-foreground">
            {{ entry.copy.body }}
          </p>
          @if (entry.suggestions.length) {
            <div class="flex flex-col gap-2 text-sm">
              <p class="m-0 text-muted-foreground">{{ entry.didYouMean }}</p>
              <ul class="m-0 flex list-none flex-col gap-1.5 p-0" role="list">
                @for (page of entry.suggestions; track page.path) {
                  <li class="flex flex-wrap items-baseline gap-x-3">
                    <a [class]="link" [routerLink]="page.path">{{ page.path }}</a>
                    <span class="font-sans text-muted-foreground">{{ page.label }}</span>
                  </li>
                }
              </ul>
            </div>
          }
          <ul class="m-0 flex list-none flex-wrap gap-x-6 gap-y-2 p-0 text-sm" role="list">
            <li>
              <a [class]="link" [routerLink]="['/', entry.locale]">← {{ entry.copy.home }}</a>
            </li>
            <li>
              <a [class]="link" [routerLink]="['/', entry.locale]" fragment="about"
                >&gt;_ {{ entry.copy.ask }}</a
              >
            </li>
          </ul>
        </section>
      }
    </main>
  `,
})
export class NotFoundComponent {
  /** Null renders both languages. */
  readonly locale = input<Locale | null>(null);

  private readonly store = inject(ContentStore);
  private readonly router = inject(Router);
  private readonly lang = inject(LanguageService);

  protected readonly link =
    "text-foreground underline decoration-accent-orange/60 underline-offset-4 transition-colors hover:decoration-accent-orange";

  /**
   * The address asked for. The page signal re-reads it after a navigation:
   * a case study kept on screen from one missing slug to the next keeps this
   * component too.
   */
  private readonly url = computed(() => {
    this.lang.page();
    return this.router.url;
  });

  /** As the shell repeats it: no query or fragment, cut if long. */
  protected readonly path = computed(() => {
    const path = this.url().split(/[?#]/, 1)[0] ?? "/";
    return path.length > MAX_PATH ? `${path.slice(0, MAX_PATH - 1)}…` : path;
  });

  protected readonly entries = computed(() => {
    const locale = this.locale();
    const locales: Locale[] = locale ? [locale] : ["en", "de"];
    return locales.map((l) => {
      const content = this.store.content(l)();
      const chrome = CHROME[l].notFound;
      return {
        locale: l,
        copy: content ? { ...content.ui.notFound, ask: content.ui.hero.askCta } : COPY[l],
        command: chrome.command,
        didYouMean: chrome.didYouMean,
        suggestions: content && locale ? suggestPages(this.url(), knownPages(l, content)) : [],
      };
    });
  });
}
