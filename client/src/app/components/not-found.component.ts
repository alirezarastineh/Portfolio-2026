import { ChangeDetectionStrategy, Component, computed, inject, input } from "@angular/core";
import { RouterLink } from "@angular/router";

import { ContentStore } from "../content/content.store";
import type { Locale } from "../content/locale";

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

/**
 * The 404 body, as terminal output. With a locale it renders in that language
 * (inside the site chrome), in the CMS's words; without one — an address
 * outside `/en` and `/de` — it offers both. "Ask" leads to the About
 * terminal, which becomes the portfolio assistant.
 */
@Component({
  selector: "app-not-found",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  host: { class: "block" },
  template: `
    <main
      class="mx-auto flex min-h-[70vh] max-w-3xl flex-col justify-center gap-12 px-6 pb-24 pt-32 sm:px-8"
    >
      @for (entry of entries(); track entry.locale) {
        <section class="flex flex-col gap-4 font-mono" [attr.lang]="entry.locale">
          <h1 class="m-0 text-2xl font-medium tracking-tight text-foreground sm:text-3xl">
            <span class="text-accent-orange" aria-hidden="true">&gt; </span>{{ entry.copy.title }}
          </h1>
          <p class="m-0 max-w-xl text-pretty font-sans leading-relaxed text-muted-foreground">
            {{ entry.copy.body }}
          </p>
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

  protected readonly link =
    "text-foreground underline decoration-accent-orange/60 underline-offset-4 transition-colors hover:decoration-accent-orange";

  protected readonly entries = computed(() => {
    const locale = this.locale();
    const locales: Locale[] = locale ? [locale] : ["en", "de"];
    return locales.map((l) => ({ locale: l, copy: this.copy(l) }));
  });

  private copy(locale: Locale): Copy {
    const ui = this.store.content(locale)()?.ui;
    return ui ? { ...ui.notFound, ask: ui.hero.askCta } : COPY[locale];
  }
}
