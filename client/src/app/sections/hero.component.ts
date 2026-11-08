import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
} from "@angular/core";

import { AskStageComponent } from "../ask/ask-stage.component";
import { MetricsComponent } from "../components/metrics.component";
import { PictureComponent } from "../components/picture.component";
import { AVAILABILITY_DOT, availabilityLabel } from "../content/availability";
import { placeName, timeZoneLabel } from "../content/place";
import { CHROME } from "../i18n/chrome";
import { ClockService } from "../services/clock.service";
import { LanguageService } from "../services/language.service";

/** Orgs named in the proof strip, at most. */
const MAX_ORGS = 5;

/**
 * The first screen: whether he is available and where, the headline, the way to the work and the
 * CV, and beside them the assistant's stage, where a visitor can ask and watch the answer made, as
 * tall as the text. Below, what backs it up: where he has worked and one project's numbers.
 *
 * The headline is the page's largest paint and shows at once; nothing here moves on load. Its full
 * stop, the wordmark's, starts the line (motion.css): from lg, where anchors exist, the line drops
 * from it, runs back under the headline and goes down the gutter to the page's line.
 */
@Component({
  selector: "app-hero-section",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AskStageComponent, MetricsComponent, PictureComponent],
  host: {
    class: "block",
  },
  template: `
    <section id="hero" aria-labelledby="hero-heading" class="relative">
      <div class="container-site pb-12 pt-24 sm:pt-28 lg:min-h-svh lg:pb-16 lg:pt-24">
        <div class="grid grid-cols-12 gap-x-(--col-gap) gap-y-12">
          <div class="col-span-12 flex flex-col gap-6 lg:col-span-7 lg:gap-5">
            <p class="m-0 flex flex-col gap-0.5">
              <span class="flex items-center gap-2 text-small font-medium text-foreground">
                <span class="status-dot" [class]="dot()" aria-hidden="true"></span
                >{{ availability() }}
              </span>
              <!-- The zone from the server; the time added in the browser, into space already
                   kept for it at the end of the line. -->
              <span class="pl-4 text-data text-faint-foreground"
                >{{ where() }}
                @if (zone()) {
                  <span class="sr-only">{{ chrome().localTime }}</span>
                  <time class="inline-block min-w-[5ch] tabular-nums">{{ time() }}</time>
                }
              </span>
            </p>

            <!-- The name stays in the heading for screen readers and search. -->
            <h1
              id="hero-heading"
              class="hero-headline m-0 text-balance text-h1 text-foreground"
              [class.hyphens-manual]="lang.lang() !== 'de'"
            >
              <span class="sr-only">{{ identity().name }} — </span>{{ headline().text
              }}<span class="hero-dot text-signal" aria-hidden="true">{{ headline().stop }}</span>
            </h1>

            <p class="m-0 max-w-[46ch] text-pretty text-lead text-muted-foreground">
              {{ lang.t().profile.heroSubheadline }}
            </p>

            <div class="flex flex-wrap items-center gap-x-6 gap-y-3">
              <a
                class="btn btn-solid press"
                [href]="primaryHref()"
                [attr.target]="primaryExternal() ? '_blank' : null"
                [attr.rel]="primaryExternal() ? 'noreferrer noopener' : null"
              >
                {{ lang.t().profile.primaryCta }}
              </a>
              @if (identity().resume) {
                <!-- /en/resume.pdf redirects to this language's CV, saved as
                     Alireza-Rastineh-CV-en.pdf. Hidden until one is set. -->
                <a class="btn btn-quiet press" [href]="'/' + lang.lang() + '/resume.pdf'" download>
                  {{ lang.t().hero.downloadCv }}
                </a>
              }
            </div>
          </div>

          <app-ask-stage class="col-span-12 lg:col-span-5" />
        </div>
      </div>

      <!-- Proof, under the first screen: nothing at all when there is none yet. -->
      @if (orgs().length || metrics().length) {
        <div class="container-site pb-12 lg:pb-16">
          <div
            class="flex flex-col gap-8 border-t border-border pt-8 xl:flex-row xl:items-end xl:justify-between"
          >
            @if (orgs().length) {
              <div class="flex flex-col gap-3">
                <p class="m-0 text-data text-faint-foreground">{{ chrome().shippedAt }}</p>
                <ul
                  class="m-0 flex list-none flex-wrap items-center gap-x-6 gap-y-2 p-0"
                  role="list"
                >
                  @for (org of orgs(); track org.name) {
                    <li class="flex min-h-8 items-center">
                      @if (org.logo; as logo) {
                        <app-picture
                          [image]="logo"
                          [alt]="org.name"
                          sizes="120px"
                          [imgClass]="'block h-6 w-auto opacity-60 grayscale'"
                        />
                      } @else {
                        <span class="text-small text-foreground" translate="no">{{
                          org.name
                        }}</span>
                      }
                    </li>
                  }
                </ul>
              </div>
            }
            @if (proofProject(); as project) {
              <div class="flex min-w-0 grow flex-col gap-3">
                <p class="m-0 text-data text-faint-foreground">{{ project.name }}</p>
                <app-metrics [metrics]="metrics()" />
              </div>
            }
          </div>
        </div>
      }
      @if (headline().stop) {
        <span class="hero-line" aria-hidden="true"></span>
      }
    </section>
  `,
})
export class HeroSectionComponent {
  readonly lang = inject(LanguageService);
  readonly identity = computed(() => this.lang.content().identity);
  protected readonly chrome = computed(() => CHROME[this.lang.lang()].hero);

  protected readonly dot = computed(() => AVAILABILITY_DOT[this.identity().availability]);

  /** The headline, its closing full stop apart: drawn as the wordmark's dot, it starts the line. */
  protected readonly headline = computed(() => {
    const text = this.lang.t().profile.heroHeadline.trim();
    return text.endsWith(".") ? { text: text.slice(0, -1), stop: "." } : { text, stop: "" };
  });

  protected readonly primaryHref = computed(() =>
    this.lang.homeHref(this.identity().primaryCtaHref),
  );
  protected readonly primaryExternal = computed(() => /^https?:/i.test(this.primaryHref()));

  protected readonly availability = computed(() =>
    availabilityLabel(this.lang.t().hero, this.identity().availability),
  );

  /** `CEST`; empty without a (known) time zone. */
  protected readonly zone = computed(() =>
    timeZoneLabel(this.identity().timezone, this.lang.lang()),
  );

  /** `Berlin, Germany, CEST`, else the CMS's own word for where (`Remote`), as About says it. */
  protected readonly where = computed(() =>
    [
      placeName(this.identity().location, this.lang.lang()) || this.lang.t().profile.location,
      this.zone(),
    ]
      .filter(Boolean)
      .join(", "),
  );

  /** Empty on the server: it leaves the time to the reader's clock. */
  private readonly clock = inject(ClockService);
  protected readonly time = computed(() => this.clock.time(this.identity().timezone));

  /** Where he has worked, most recent first, each once. */
  protected readonly orgs = computed(() => {
    const seen = new Set<string>();
    return this.lang
      .content()
      .experiences.filter((e) => e.kind === "work")
      .map((e) => e.org)
      .filter((org) => !seen.has(org.name) && seen.add(org.name))
      .slice(0, MAX_ORGS);
  });

  /** The first featured project with numbers to show. */
  protected readonly proofProject = computed(
    () => this.lang.content().projects.find((p) => p.featured && p.metrics.length) ?? null,
  );
  protected readonly metrics = computed(() => this.proofProject()?.metrics.slice(0, 3) ?? []);

  constructor() {
    afterNextRender(() => this.clock.start());
  }
}
