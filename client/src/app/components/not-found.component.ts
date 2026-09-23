import { ChangeDetectionStrategy, Component, computed, input } from "@angular/core";
import { RouterLink } from "@angular/router";

import type { Locale } from "../content/locale";

const COPY: Record<Locale, { title: string; body: string; home: string }> = {
  en: {
    title: "Page not found",
    body: "There is nothing at this address. It may have moved, or the link may be mistyped.",
    home: "Back to the home page",
  },
  de: {
    title: "Seite nicht gefunden",
    body: "Unter dieser Adresse gibt es nichts. Vielleicht wurde die Seite verschoben, oder der Link ist falsch geschrieben.",
    home: "Zur Startseite",
  },
};

/**
 * The 404 body. With a locale it renders in that language (inside the site
 * chrome); without one — an address outside `/en` and `/de` — it offers both.
 */
@Component({
  selector: "app-not-found",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  host: { class: "block" },
  template: `
    <main
      class="mx-auto flex min-h-[70vh] max-w-3xl flex-col justify-center gap-6 px-6 pb-24 pt-32 sm:px-8"
    >
      <p class="m-0 font-mono text-sm text-accent-orange" aria-hidden="true">
        &gt; 404: route not found
      </p>
      @for (entry of entries(); track entry.locale) {
        <section class="flex flex-col gap-3" [attr.lang]="entry.locale">
          <h1 class="m-0 text-3xl font-medium tracking-tight text-foreground sm:text-4xl">
            {{ entry.copy.title }}
          </h1>
          <p class="m-0 max-w-xl text-pretty leading-relaxed text-muted-foreground">
            {{ entry.copy.body }}
          </p>
          <a
            class="w-fit font-mono text-sm text-foreground underline decoration-accent-orange/60 underline-offset-4 transition-colors hover:decoration-accent-orange"
            [routerLink]="['/', entry.locale]"
          >
            ← {{ entry.copy.home }}
          </a>
        </section>
      }
    </main>
  `,
})
export class NotFoundComponent {
  /** Null renders both languages. */
  readonly locale = input<Locale | null>(null);

  protected readonly entries = computed(() => {
    const locale = this.locale();
    const locales: Locale[] = locale ? [locale] : ["en", "de"];
    return locales.map((l) => ({ locale: l, copy: COPY[l] }));
  });
}
