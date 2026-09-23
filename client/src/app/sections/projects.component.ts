import { isPlatformBrowser } from "@angular/common";
import {
  afterRenderEffect,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  ElementRef,
  PLATFORM_ID,
  inject,
  viewChildren,
} from "@angular/core";
import { LanguageService } from "../services/language.service";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

import { ProjectCardComponent } from "../components/project-card.component";
import { ScrambleTextComponent } from "../components/scramble-text.component";

@Component({
  selector: "app-projects-section",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ProjectCardComponent, ScrambleTextComponent],
  host: {
    class: "block",
  },
  template: `
    <section id="projects" class="relative px-6 py-24 sm:px-8 sm:py-28 lg:px-12 lg:py-32">
      <div class="mx-auto flex max-w-7xl flex-col gap-10">
        <header class="flex flex-wrap items-baseline justify-between gap-4">
          <h2 class="m-0 font-mono text-2xl tracking-tight text-foreground sm:text-3xl">
            <app-scramble-text [text]="lang.t().projects.heading" />
          </h2>
          <p class="font-mono text-[0.7rem] uppercase tracking-[0.22em] text-muted-foreground">
            {{ lang.t().projects.subtitle }}
          </p>
        </header>

        <div
          data-project-stack
          [style.--project-stack-count]="projects().length"
          class="relative flex flex-col gap-6 lg:gap-0"
        >
          @for (project of projects(); track project.slug; let i = $index) {
            <div
              #stackCard
              data-sticky-card
              class="lg:sticky"
              [style.top.rem]="topFor(i)"
              [style.zIndex]="i + 1"
            >
              <div data-stack-inner class="origin-top will-change-[opacity,filter]">
                <app-project-card
                  [project]="project"
                  [index]="i"
                  [priority]="i === 0"
                  class="block lg:h-[calc(100vh-7rem)] lg:pb-6"
                />
              </div>
            </div>
          }
        </div>
      </div>
    </section>
  `,
})
export class ProjectsSectionComponent {
  readonly lang = inject(LanguageService);
  readonly projects = computed(() => this.lang.content().projects);

  private readonly stackCards = viewChildren<ElementRef<HTMLElement>>("stackCard");
  private readonly platformId = inject(PLATFORM_ID);
  private readonly destroyRef = inject(DestroyRef);
  /** Only our own triggers, so switching locale cannot kill another section's. */
  private triggers: ScrollTrigger[] = [];

  constructor() {
    this.destroyRef.onDestroy(() => this.killTriggers());

    // Keyed on the rendered elements rather than run once: the project list is
    // async now and re-renders on every locale switch, which would otherwise
    // leave ScrollTriggers pointing at detached nodes.
    afterRenderEffect(() => {
      const wrappers = this.stackCards().map((r) => r.nativeElement);
      if (!isPlatformBrowser(this.platformId)) return;
      if (globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
      this.initScrollStackFx(wrappers);
    });
  }

  topFor(i: number): number {
    return 5 + i * 0.75;
  }

  private killTriggers(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    for (const trigger of this.triggers) trigger.kill();
    this.triggers = [];
  }

  private initScrollStackFx(wrappers: HTMLElement[]): void {
    this.killTriggers();
    gsap.registerPlugin(ScrollTrigger);

    if (wrappers.length < 2) {
      requestAnimationFrame(() => ScrollTrigger.refresh());
      return;
    }

    for (let i = 0; i < wrappers.length - 1; i++) {
      const inner = wrappers[i].querySelector<HTMLElement>("[data-stack-inner]");
      const next = wrappers[i + 1];
      if (!inner || !next) continue;

      this.triggers.push(
        ScrollTrigger.create({
          trigger: next,
          start: "top 92%",
          end: "top 14%",
          scrub: 0.45,
          onUpdate: (self) => {
            const p = self.progress;
            gsap.set(inner, {
              opacity: 1 - p * 0.16,
              filter: `brightness(${1 - p * 0.12})`,
            });
          },
        }),
      );
    }

    requestAnimationFrame(() => ScrollTrigger.refresh());
  }
}
