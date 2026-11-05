import { DOCUMENT, isPlatformBrowser } from "@angular/common";
import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  PLATFORM_ID,
  signal,
} from "@angular/core";
import type { ResolveFn } from "@angular/router";
import type { MetaTag, RouteMeta } from "@analogjs/router";

import { MATCH_KINDS, type MatchKind } from "../../ask/match";
import { MatchPanelComponent } from "../../ask/match-panel.component";
import { MATCH_PAGE_COPY } from "../../ask/match-page-copy";
import { applyHead } from "../../seo/head";
import { languageAlternates, pageMeta, pageUrl, siteOrigin } from "../../seo/seo-meta";
import { LanguageService } from "../../services/language.service";

const titleResolver: ResolveFn<string> = () => {
  const lang = inject(LanguageService);
  return `${MATCH_PAGE_COPY[lang.lang()].heading} · ${lang.content().identity.name}`;
};

const metaResolver: ResolveFn<MetaTag[]> = () => {
  const lang = inject(LanguageService);
  const content = lang.content();
  const copy = MATCH_PAGE_COPY[lang.lang()];
  return pageMeta(content, lang.lang(), {
    title: `${copy.heading} · ${content.identity.name}`,
    description: copy.intro,
    url: pageUrl(siteOrigin(content), lang.lang(), "/match"),
    robots: "index, follow",
  });
};

const headResolver: ResolveFn<true> = () => {
  const lang = inject(LanguageService);
  const origin = siteOrigin(lang.content());
  applyHead(inject(DOCUMENT), {
    canonical: pageUrl(origin, lang.lang(), "/match"),
    alternates: languageAlternates(origin, "/match", pageUrl(origin, "en", "/match")),
  });
  return true;
};

/** `/en/match`: a role, a project or a problem checked against the published work (plan 3 W3). */
export const routeMeta: RouteMeta = {
  title: titleResolver,
  meta: metaResolver,
  resolve: { head: headResolver },
};

/**
 * The server renders what the page does and the kind to check. The paste
 * box, the table and the hand-off need the assistant's store, and with it
 * the AI SDK: they load after hydration, in a chunk of their own, so this
 * page never builds the store on the server.
 */
@Component({
  selector: "app-match-page",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatchPanelComponent],
  host: { class: "block" },
  template: `
    <main id="main" class="mx-auto flex max-w-3xl flex-col gap-10 px-6 pb-24 pt-32 sm:px-8">
      <header class="flex flex-col gap-3">
        <p class="eyebrow m-0 text-muted-foreground">
          <span aria-hidden="true">// </span>{{ copy().eyebrow }}
        </p>
        <h1 class="m-0 text-3xl font-medium tracking-tight text-foreground sm:text-4xl">
          {{ copy().heading }}
        </h1>
        <p class="m-0 max-w-prose leading-relaxed text-muted-foreground">{{ copy().intro }}</p>
      </header>

      <!-- Native radios: the arrow keys move the choice, with no roving focus to build. -->
      <fieldset class="match-controls m-0 flex flex-wrap gap-x-6 gap-y-2 border-0 p-0">
        <legend class="eyebrow mb-3 p-0 text-muted-foreground">{{ copy().legend }}</legend>
        @for (k of kinds; track k) {
          <label class="flex min-h-6 cursor-pointer items-center gap-2">
            <input
              type="radio"
              name="match-kind"
              [checked]="k === kind()"
              (change)="kind.set(k)"
            />
            {{ copy().kinds[k] }}
          </label>
        }
      </fieldset>

      @defer (when ready()) {
        <app-match-panel [kind]="kind()" />
      }
    </main>
  `,
})
export default class MatchPageComponent {
  private readonly lang = inject(LanguageService);
  protected readonly copy = computed(() => MATCH_PAGE_COPY[this.lang.lang()]);
  protected readonly kinds = MATCH_KINDS;
  protected readonly kind = signal<MatchKind>("role");
  /** Set once hydrated, in the browser only (`afterNextRender` runs in the server render too). */
  protected readonly ready = signal(false);

  constructor() {
    const browser = isPlatformBrowser(inject(PLATFORM_ID));
    afterNextRender(() => this.ready.set(browser));
  }
}
