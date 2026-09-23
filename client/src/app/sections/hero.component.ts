import { ChangeDetectionStrategy, Component, computed, inject } from "@angular/core";
import { RouterLink } from "@angular/router";
import { NgIcon, provideIcons } from "@ng-icons/core";
import { lucideDownload } from "@ng-icons/lucide";

import { MagneticButtonComponent } from "../components/magnetic-button.component";
import { PictureComponent } from "../components/picture.component";
import { regionName, timeZoneLabel } from "../content/place";
import type { Availability } from "../content/schema";
import { LanguageService } from "../services/language.service";
import { GridCanvasComponent } from "../visuals/grid-canvas.component";

const DOT: Record<Availability, string> = {
  open: "bg-available",
  limited: "bg-accent-orange",
  closed: "bg-muted-foreground",
};

@Component({
  selector: "app-hero-section",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [GridCanvasComponent, MagneticButtonComponent, NgIcon, PictureComponent, RouterLink],
  viewProviders: [provideIcons({ lucideDownload })],
  host: {
    class: "block",
  },
  template: `
    <section
      id="hero"
      aria-labelledby="hero-heading"
      class="relative grid min-h-svh grid-cols-12 items-center gap-x-8 gap-y-12 px-6 pb-20 pt-28 sm:px-8 lg:px-12 lg:pt-32"
    >
      <div class="col-span-12 flex flex-col gap-7 lg:col-span-7">
        <p
          class="m-0 inline-flex w-fit flex-wrap items-center gap-x-2 gap-y-1 rounded-full border border-border bg-card/60 px-3.5 py-1.5 font-mono text-xs text-muted-foreground"
        >
          <span
            class="size-2 shrink-0 rounded-full shadow-[0_0_0_3px_color-mix(in_oklab,currentColor_18%,transparent)]"
            [class]="dot()"
            aria-hidden="true"
          ></span>
          <span class="text-foreground">{{ availability() }}</span>
          @for (part of whereabouts(); track part) {
            <span aria-hidden="true">·</span>
            <span>{{ part }}</span>
          }
        </p>

        <div class="flex items-center gap-4">
          @if (identity().avatar; as avatar) {
            <div
              class="size-14 shrink-0 overflow-hidden rounded-full border border-border bg-muted"
            >
              <app-picture
                [image]="avatar"
                alt=""
                sizes="56px"
                imgClass="block size-full object-cover"
              />
            </div>
          }
          <p class="m-0 font-mono text-xs uppercase tracking-[0.22em] text-muted-foreground">
            {{ identity().handle }} · {{ lang.t().profile.role }}
          </p>
        </div>

        <h1 id="hero-heading" class="m-0 flex flex-col gap-4">
          <span class="font-mono text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
            {{ identity().name }}<span class="sr-only"> — </span>
          </span>
          <span
            class="text-balance text-[clamp(2.75rem,7vw,5.25rem)] font-semibold leading-[1.02] tracking-tight text-foreground"
          >
            {{ lang.t().profile.heroHeadline }}
          </span>
        </h1>
        <p
          class="m-0 max-w-xl text-pretty text-base leading-relaxed text-muted-foreground sm:text-lg"
        >
          {{ lang.t().profile.heroSubheadline }}
        </p>

        <div class="mt-1 flex flex-wrap gap-3">
          <app-magnetic-button variant="primary" [href]="lang.homeHref(identity().primaryCtaHref)">
            {{ lang.t().profile.primaryCta }}
          </app-magnetic-button>
          <app-magnetic-button
            variant="secondary"
            [href]="lang.homeHref(identity().secondaryCtaHref)"
          >
            {{ lang.t().profile.secondaryCta }}
          </app-magnetic-button>
          @if (identity().resume) {
            <!-- /en/resume.pdf redirects to this language's CV, saved as
                 Alireza-Rastineh-CV-en.pdf. Hidden until one is set. -->
            <app-magnetic-button
              variant="secondary"
              [href]="'/' + lang.lang() + '/resume.pdf'"
              [download]="true"
            >
              <ng-icon name="lucideDownload" size="16" aria-hidden="true" />
              {{ lang.t().hero.downloadCv }}
            </app-magnetic-button>
          }
        </div>

        <!-- The About terminal becomes the portfolio assistant (Phase 7). -->
        <a
          class="group inline-flex w-fit items-center gap-2 font-mono text-sm text-muted-foreground transition-colors duration-200 hover:text-foreground"
          [routerLink]="['/', lang.lang()]"
          fragment="about"
        >
          <span class="text-accent-orange" aria-hidden="true">&gt;</span>
          <span
            class="underline decoration-border underline-offset-4 group-hover:decoration-accent-orange"
            >{{ lang.t().hero.askCta }}</span
          >
          <span class="terminal-caret" aria-hidden="true"></span>
        </a>
      </div>

      <div
        class="relative col-span-12 min-h-90 overflow-hidden rounded-2xl border border-border bg-card/40 lg:col-span-5 lg:min-h-130"
      >
        <app-grid-canvas class="absolute inset-0" />
        <div
          class="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_80%_at_50%_0%,color-mix(in_oklab,var(--accent-indigo)_14%,transparent),transparent_60%)]"
          aria-hidden="true"
        ></div>
      </div>
    </section>
  `,
})
export class HeroSectionComponent {
  readonly lang = inject(LanguageService);
  readonly identity = computed(() => this.lang.content().identity);

  protected readonly dot = computed(() => DOT[this.identity().availability]);

  protected readonly availability = computed(() => {
    const t = this.lang.t().hero;
    const labels: Record<Availability, string> = {
      open: t.availabilityOpen,
      limited: t.availabilityLimited,
      closed: t.availabilityClosed,
    };
    return labels[this.identity().availability];
  });

  /** City, country, time zone — whichever are set. */
  protected readonly whereabouts = computed(() => {
    const { location, timezone } = this.identity();
    const locale = this.lang.lang();
    return [
      location.city,
      location.country ? regionName(location.country, locale) : "",
      timeZoneLabel(timezone, locale),
    ].filter(Boolean);
  });
}
