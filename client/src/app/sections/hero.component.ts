import { ChangeDetectionStrategy, Component, inject } from "@angular/core";

import { MagneticButtonComponent } from "../components/magnetic-button.component";
import { profile } from "../data/profile.data";
import { LanguageService } from "../services/language.service";
import { GridCanvasComponent } from "../visuals/grid-canvas.component";

@Component({
  selector: "app-hero-section",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MagneticButtonComponent, GridCanvasComponent],
  host: {
    class: "block",
  },
  template: `
    <section
      id="hero"
      class="relative grid min-h-screen grid-cols-12 items-center gap-x-8 gap-y-12 px-6 pb-20 pt-28 sm:px-8 lg:px-12 lg:pt-32"
    >
      <div class="col-span-12 flex flex-col gap-6 lg:col-span-7">
        <p class="m-0 font-mono text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
          {{ profile.name }}
        </p>
        <p class="m-0 font-mono text-xs uppercase tracking-[0.22em] text-muted-foreground">
          {{ profile.handle }} · {{ lang.t().profile.role }}
        </p>
        <h1
          class="m-0 text-balance text-[clamp(2.5rem,6vw,5rem)] font-medium leading-[1.05] tracking-tight text-foreground"
        >
          {{ lang.t().profile.heroHeadline }}
        </h1>
        <p class="max-w-xl text-pretty text-base leading-relaxed text-muted-foreground sm:text-lg">
          {{ lang.t().profile.heroSubheadline }}
        </p>
        <div class="mt-2 flex flex-wrap gap-3">
          <app-magnetic-button variant="primary" [href]="profile.primaryCta.href">
            {{ lang.t().profile.primaryCta }}
          </app-magnetic-button>
          <app-magnetic-button variant="secondary" [href]="profile.secondaryCta.href">
            {{ lang.t().profile.secondaryCta }}
          </app-magnetic-button>
        </div>
      </div>
      <div
        class="relative col-span-12 min-h-90 overflow-hidden rounded-2xl border border-border bg-card/40 lg:col-span-5 lg:min-h-130"
      >
        <app-grid-canvas class="absolute inset-0" />
        <div
          class="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_80%_at_50%_0%,oklch(0.62_0.19_280/0.12),transparent_60%)]"
          aria-hidden="true"
        ></div>
      </div>
    </section>
  `,
})
export class HeroSectionComponent {
  readonly lang = inject(LanguageService);
  readonly profile = profile;
}
