import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  viewChild,
} from "@angular/core";
import { NgIcon, provideIcons } from "@ng-icons/core";
import { lucideArrowDown, lucideDownload } from "@ng-icons/lucide";

import { AskBarComponent } from "../ask/ask-bar.component";
import { MagneticButtonComponent } from "../components/magnetic-button.component";
import { PictureComponent } from "../components/picture.component";
import { AVAILABILITY_DOT, availabilityLabel } from "../content/availability";
import { regionName, timeZoneLabel } from "../content/place";
import { CHROME } from "../i18n/chrome";
import { ClockService } from "../services/clock.service";
import { LanguageService } from "../services/language.service";
import { GridCanvasComponent } from "../visuals/grid-canvas.component";
import { TracePanelComponent } from "../visuals/trace-panel.component";

/** Orgs named in the proof strip, at most. */
const MAX_ORGS = 5;

/**
 * The first screen: who this is and whether they are available, the headline,
 * a way to ask the portfolio anything, and a picture of how that answer is
 * made. Below, what backs it up: where he has worked and one project's numbers.
 *
 * The headline is the page's largest paint and shows at once; the lines around
 * it rise in one after another (styles/motion.css, `hero-rise`), never it. The
 * dot grid behind the whole hero bends away from the pointer.
 */
@Component({
  selector: "app-hero-section",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    AskBarComponent,
    GridCanvasComponent,
    MagneticButtonComponent,
    NgIcon,
    PictureComponent,
    TracePanelComponent,
  ],
  viewProviders: [provideIcons({ lucideArrowDown, lucideDownload })],
  host: {
    class: "block",
  },
  template: `
    <section
      id="hero"
      aria-labelledby="hero-heading"
      class="relative isolate"
      (pointermove)="grid().onPointer($event)"
      (pointerdown)="grid().onPointer($event)"
      (pointerleave)="grid().onLeave()"
    >
      <!-- Full width behind the hero, faded out towards the text. -->
      <div
        class="pointer-events-none absolute inset-0 -z-10 mask-[radial-gradient(ellipse_70%_60%_at_70%_40%,#000_30%,transparent_75%)]"
        aria-hidden="true"
      >
        <app-grid-canvas class="absolute inset-0" />
      </div>

      <div class="container-site flex flex-col pb-12 pt-24 sm:pt-28 lg:min-h-svh lg:pb-16 lg:pt-24">
        <div class="grid grow grid-cols-12 items-center gap-x-(--col-gap) gap-y-12">
          <div class="col-span-12 flex flex-col gap-6 lg:col-span-7 lg:gap-5">
            <p
              class="hero-rise m-0 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-meta text-muted-foreground"
            >
              <span
                class="relative size-2 shrink-0 rounded-full"
                [class]="dot()"
                [class.pulse-ring]="identity().availability === 'open'"
                aria-hidden="true"
              ></span>
              <span class="text-foreground">{{ availability() }}</span>
              @for (part of whereabouts(); track part) {
                <span aria-hidden="true">·</span>
                <span>{{ part }}</span>
              }
              <!-- The zone from the server; the time added in the browser, into
                   space already kept for it at the end of the line. -->
              @if (zone(); as zone) {
                <span aria-hidden="true">·</span>
                <span
                  >{{ zone }}
                  <span class="sr-only">{{ chrome().localTime }}</span>
                  <time class="inline-block min-w-[5ch] tabular-nums">{{ time() }}</time></span
                >
              }
            </p>

            <div class="hero-rise flex items-center gap-3 [--i:1]">
              @if (identity().avatar; as avatar) {
                <div
                  class="size-10 shrink-0 overflow-hidden rounded-full border border-border bg-muted"
                >
                  <app-picture
                    [image]="avatar"
                    alt=""
                    sizes="40px"
                    imgClass="block size-full object-cover"
                  />
                </div>
              }
              <p class="m-0 flex flex-col leading-snug">
                <span class="font-medium text-foreground">{{ identity().name }}</span>
                <span class="text-sm text-muted-foreground">{{ lang.t().profile.role }}</span>
              </p>
            </div>

            <!-- The name stays in the heading for screen readers and search. -->
            <h1
              id="hero-heading"
              class="m-0 max-w-[14ch] text-balance text-display text-foreground hyphens-auto"
            >
              <span class="sr-only">{{ identity().name }} — </span
              >{{ lang.t().profile.heroHeadline }}
            </h1>

            <p
              class="hero-rise m-0 max-w-[46ch] text-pretty text-lead text-muted-foreground [--i:2]"
            >
              {{ lang.t().profile.heroSubheadline }}
            </p>

            <app-ask-bar class="hero-rise mt-2 [--i:3]" />

            <div class="hero-rise flex flex-wrap items-center gap-x-6 gap-y-3 [--i:4]">
              <app-magnetic-button
                variant="primary"
                [href]="lang.homeHref(identity().primaryCtaHref)"
              >
                {{ lang.t().profile.primaryCta }}
                <ng-icon name="lucideArrowDown" size="16" aria-hidden="true" />
              </app-magnetic-button>
              @if (identity().resume) {
                <!-- /en/resume.pdf redirects to this language's CV, saved as
                     Alireza-Rastineh-CV-en.pdf. Hidden until one is set. -->
                <a
                  class="link-underline inline-flex min-h-11 items-center gap-1.5 font-mono text-meta"
                  [href]="'/' + lang.lang() + '/resume.pdf'"
                  download
                >
                  {{ lang.t().hero.downloadCv }}
                  <ng-icon name="lucideDownload" size="14" aria-hidden="true" />
                </a>
              }
            </div>
          </div>

          <app-trace-panel class="hero-rise col-span-12 [--i:5] lg:col-span-5" />
        </div>

        <!-- Proof: nothing at all when there is none yet. -->
        @if (orgs().length || metrics().length) {
          <div
            class="hero-rise mt-16 flex flex-col gap-8 border-t border-border pt-8 [--i:6] lg:flex-row lg:items-end lg:justify-between"
          >
            @if (orgs().length) {
              <div class="flex flex-col gap-3">
                <p class="eyebrow m-0 text-muted-foreground">{{ chrome().shippedAt }}</p>
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
                          imgClass="block h-6 w-auto opacity-60 grayscale transition duration-(--dur-3) hover:opacity-100 hover:grayscale-0"
                        />
                      } @else {
                        <span class="font-mono text-meta text-foreground/85">{{ org.name }}</span>
                      }
                    </li>
                  }
                </ul>
              </div>
            }
            @if (proofProject(); as project) {
              <div class="flex flex-col gap-3">
                <p class="eyebrow m-0 text-muted-foreground">{{ project.name }}</p>
                <dl class="m-0 grid grid-cols-2 gap-x-8 gap-y-4 sm:grid-cols-3">
                  @for (metric of metrics(); track metric.label) {
                    <div class="flex flex-col gap-1">
                      <dt class="order-2 font-mono text-meta text-muted-foreground">
                        {{ metric.label }}
                      </dt>
                      <dd class="order-1 m-0 text-metric tabular-nums text-foreground">
                        {{ metric.value }}
                      </dd>
                    </div>
                  }
                </dl>
              </div>
            }
          </div>
        }
      </div>
    </section>
  `,
})
export class HeroSectionComponent {
  readonly lang = inject(LanguageService);
  readonly identity = computed(() => this.lang.content().identity);
  protected readonly chrome = computed(() => CHROME[this.lang.lang()].hero);
  protected readonly grid = viewChild.required(GridCanvasComponent);

  protected readonly dot = computed(() => AVAILABILITY_DOT[this.identity().availability]);

  protected readonly availability = computed(() =>
    availabilityLabel(this.lang.t().hero, this.identity().availability),
  );

  /** City and country, whichever are set. */
  protected readonly whereabouts = computed(() => {
    const { location } = this.identity();
    return [
      location.city,
      location.country ? regionName(location.country, this.lang.lang()) : "",
    ].filter(Boolean);
  });

  /** `CEST`; empty without a (known) time zone. */
  protected readonly zone = computed(() =>
    timeZoneLabel(this.identity().timezone, this.lang.lang()),
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
