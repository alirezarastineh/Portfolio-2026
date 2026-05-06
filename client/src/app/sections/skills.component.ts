import { ChangeDetectionStrategy, Component, computed, inject } from "@angular/core";
import { NgIcon, provideIcons } from "@ng-icons/core";
import {
  lucideBrainCircuit,
  lucideContainer,
  lucideCpu,
  lucideDatabase,
} from "@ng-icons/lucide";

import { ScrambleTextComponent } from "../components/scramble-text.component";
import { SpotlightCardComponent } from "../components/spotlight-card.component";
import {
  skillBento,
  type BentoSpan,
  type SkillBentoCard,
  type SkillIcon,
} from "../data/skills.data";
import { LanguageService } from "../services/language.service";

const ICON_MAP: Record<SkillIcon, string> = {
  cpu: "lucideCpu",
  "brain-circuit": "lucideBrainCircuit",
  container: "lucideContainer",
  database: "lucideDatabase",
};

const SPAN_MAP: Record<BentoSpan, string> = {
  lg: "lg:col-span-2 lg:row-span-2",
  tall: "lg:col-span-2 lg:row-span-2",
  sm: "lg:col-span-2",
};

@Component({
  selector: "app-skills-section",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgIcon, ScrambleTextComponent, SpotlightCardComponent],
  viewProviders: [
    provideIcons({ lucideCpu, lucideBrainCircuit, lucideContainer, lucideDatabase }),
  ],
  host: {
    class: "block",
  },
  template: `
    <section
      id="skills"
      class="relative px-6 py-24 sm:px-8 sm:py-28 lg:px-12 lg:py-32"
    >
      <div class="mx-auto flex max-w-7xl flex-col gap-10">
        <header class="flex flex-wrap items-baseline justify-between gap-4">
          <h2 class="m-0 font-mono text-2xl tracking-tight text-foreground sm:text-3xl">
            <app-scramble-text [text]="lang.t().skills.heading" />
          </h2>
          <p
            class="font-mono text-[0.7rem] uppercase tracking-[0.22em] text-muted-foreground"
          >
            {{ lang.t().skills.subtitle }}
          </p>
        </header>
        <div
          class="grid auto-rows-[minmax(180px,auto)] grid-cols-1 gap-4 lg:grid-cols-4 lg:gap-5"
        >
          @for (card of cards(); track card.id) {
            <app-spotlight-card [class]="layoutClass(card.span)">
              <article class="flex h-full flex-col gap-5 p-6">
                <header class="flex items-start justify-between gap-3">
                  <div class="flex flex-col gap-1.5">
                    <p
                      class="font-mono text-[0.68rem] uppercase tracking-[0.22em] text-muted-foreground"
                    >
                      {{ card.caption }}
                    </p>
                    <h3 class="m-0 font-mono text-lg font-medium text-foreground">
                      {{ card.title }}
                    </h3>
                  </div>
                  <ng-icon
                    [name]="iconFor(card.icon)"
                    size="22"
                    class="shrink-0 text-accent-indigo"
                    aria-hidden="true"
                  />
                </header>
                <ul class="m-0 flex list-none flex-wrap gap-2 p-0" role="list">
                  @for (item of card.items; track item) {
                    <li
                      class="rounded-md border border-border bg-card/60 px-2.5 py-1 font-mono text-[0.72rem] tracking-[0.01em] text-foreground/85"
                    >
                      {{ item }}
                    </li>
                  }
                </ul>
                @if (card.narrative) {
                  <p
                    class="mt-auto text-pretty text-sm leading-relaxed text-muted-foreground"
                  >
                    {{ card.narrative }}
                  </p>
                }
              </article>
            </app-spotlight-card>
          }
        </div>
      </div>
    </section>
  `,
})
export class SkillsSectionComponent {
  readonly lang = inject(LanguageService);

  readonly cards = computed<SkillBentoCard[]>(() => {
    const t = this.lang.t();
    return skillBento.map((card, i) => ({
      ...card,
      title: t.skills.cards[i].title,
      caption: t.skills.cards[i].caption,
      narrative: t.skills.cards[i].narrative,
    }));
  });

  iconFor(icon: SkillIcon): string {
    return ICON_MAP[icon];
  }

  layoutClass(span: BentoSpan): string {
    return SPAN_MAP[span];
  }
}
