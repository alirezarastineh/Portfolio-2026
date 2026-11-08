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
import { toSignal } from "@angular/core/rxjs-interop";
import { ActivatedRoute, Router, type ParamMap, type ResolveFn } from "@angular/router";
import type { MetaTag, RouteMeta } from "@analogjs/router";
import { map } from "rxjs";

import { isMatchKind, MATCH_KINDS, type MatchKind } from "../../ask/match";
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

/** The kind the address asks for; anything else is the default. */
function kindIn(params: ParamMap): MatchKind {
  const kind = params.get("kind");
  return kind && isMatchKind(kind) ? kind : "role";
}

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
  styles: `
    /* One control of three native radios: the arrow keys move the choice, with no roving focus. */
    .kinds {
      display: grid;
      grid-auto-flow: column;
      grid-auto-columns: minmax(0, 1fr);
      border: 1px solid var(--border);
      border-radius: var(--radius);
    }
    .kind {
      position: relative;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 2.5rem;
      border-radius: calc(var(--radius) - 1px);
      color: var(--muted-foreground);
      font-size: 0.9375rem;
      text-align: center;
      touch-action: manipulation;
      transition:
        color var(--dur-2) var(--ease-out),
        background-color var(--dur-2) var(--ease-out);
    }
    .kind + .kind {
      border-inline-start: 1px solid var(--border);
    }
    /* Over the whole segment, so a tap or a screen reader's touch lands on the radio itself. */
    .kind input {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      margin: 0;
      opacity: 0;
      cursor: pointer;
    }
    .kind:has(:checked) {
      background: var(--surface-2);
      color: var(--foreground);
    }
    .kind:has(:focus-visible) {
      outline: 2px solid var(--accent-orange);
      outline-offset: 2px;
    }
    @media (width >= 40rem) {
      .kinds {
        width: fit-content;
      }
      .kind {
        padding-inline: 1.25rem;
      }
    }
    @media (hover: hover) {
      .kind:hover {
        color: var(--foreground);
      }
    }
    @media (pointer: coarse) {
      .kind {
        min-height: 2.75rem;
      }
    }
    /* Forced colours drop the fill, and with it which kind is chosen. */
    @media (forced-colors: active) {
      .kind:has(:checked) {
        forced-color-adjust: none;
        background: Highlight;
        color: HighlightText;
      }
    }
  `,
  template: `
    <main id="main" class="pb-24 pt-28 lg:pt-32">
      <div class="container-site flex flex-col gap-8 lg:gap-12">
        <header class="flex max-w-[68ch] flex-col gap-3">
          <h1 class="m-0 text-h1 text-foreground">{{ copy().heading }}</h1>
          <p class="m-0 text-lead text-muted-foreground">{{ copy().intro }}</p>
        </header>

        <fieldset class="match-controls m-0 border-0 p-0">
          <legend class="mb-2 p-0 text-small text-muted-foreground">{{ copy().legend }}</legend>
          <div class="kinds">
            @for (k of kinds; track k) {
              <label class="kind">
                <input
                  type="radio"
                  name="match-kind"
                  [checked]="k === kind()"
                  (change)="choose(k)"
                />
                {{ copy().kinds[k] }}
              </label>
            }
          </div>
        </fieldset>

        @defer (when ready()) {
          <app-match-panel [kind]="kind()" />
        } @placeholder {
          <p class="match-frame m-0">{{ copy().loading }}</p>
        }
      </div>
    </main>
  `,
})
export default class MatchPageComponent {
  private readonly lang = inject(LanguageService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  protected readonly copy = computed(() => MATCH_PAGE_COPY[this.lang.lang()]);
  protected readonly kinds = MATCH_KINDS;
  /** In the address, so the page can be shared and reloaded. */
  protected readonly kind = toSignal(this.route.queryParamMap.pipe(map(kindIn)), {
    requireSync: true,
  });
  /** Set once hydrated, in the browser only (`afterNextRender` runs in the server render too). */
  protected readonly ready = signal(false);

  constructor() {
    const browser = isPlatformBrowser(inject(PLATFORM_ID));
    afterNextRender(() => this.ready.set(browser));
  }

  /** Replaces the address: the arrow keys step through the kinds, and Back should leave the page. */
  protected choose(kind: MatchKind): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { kind },
      replaceUrl: true,
    });
  }
}
