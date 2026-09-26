import { ChangeDetectionStrategy, Component, computed, inject } from "@angular/core";
import { NgIcon } from "@ng-icons/core";

import { SectionHeadingComponent } from "../components/section-heading.component";
import { SpotlightCardComponent } from "../components/spotlight-card.component";
import type { BentoSpan } from "../content/schema";
import { splitCommentMark } from "../i18n/comment-mark";
import { iconFor, provideRegistryIcons } from "../icons/icon-registry";
import { LanguageService } from "../services/language.service";

/**
 * Bento cells on the four-column grid: `lg` is two by two, `tall` one by two,
 * `sm` one by one — so lg, tall, sm, sm fill two rows exactly. On two columns
 * `lg` takes the full width.
 */
const SPAN_MAP: Record<BentoSpan, string> = {
  lg: "md:col-span-2 lg:row-span-2",
  tall: "lg:row-span-2",
  sm: "",
};

@Component({
  selector: "app-skills-section",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgIcon, SectionHeadingComponent, SpotlightCardComponent],
  viewProviders: [provideRegistryIcons()],
  host: {
    class: "block",
  },
  template: `
    <section id="skills" aria-labelledby="skills-heading" class="container-site section-y relative">
      <div class="flex flex-col gap-12">
        <app-section-heading
          headingId="skills-heading"
          [heading]="lang.t().skills.heading"
          [eyebrow]="lang.t().skills.subtitle"
        />
        <ul
          class="m-0 grid list-none auto-rows-[minmax(180px,auto)] grid-flow-dense grid-cols-1 gap-4 p-0 md:grid-cols-2 lg:grid-cols-4 lg:gap-5"
          role="list"
        >
          @for (card of cards(); track card.id) {
            <li [class]="card.layout">
              <app-spotlight-card class="h-full">
                <article class="flex h-full flex-col gap-5 p-6">
                  <header class="flex items-start justify-between gap-3">
                    <div class="flex flex-col gap-1.5">
                      @if (card.caption.text) {
                        <p class="eyebrow m-0 text-muted-foreground">
                          @if (card.caption.marked) {
                            <span aria-hidden="true">// </span>
                          }
                          {{ card.caption.text }}
                        </p>
                      }
                      <h3 class="m-0 text-lg font-semibold tracking-tight text-foreground">
                        {{ card.title }}
                      </h3>
                    </div>
                    <ng-icon
                      [name]="card.icon"
                      size="22"
                      class="shrink-0 text-accent-indigo"
                      aria-hidden="true"
                    />
                  </header>
                  <ul class="m-0 flex list-none flex-wrap gap-2 p-0" role="list">
                    @for (item of card.items; track item) {
                      <li class="chip">{{ item }}</li>
                    }
                  </ul>
                  @if (card.narrative) {
                    <p
                      class="m-0 mt-auto text-pretty text-sm leading-relaxed text-muted-foreground"
                    >
                      {{ card.narrative }}
                    </p>
                  }
                </article>
              </app-spotlight-card>
            </li>
          }
        </ul>
      </div>
    </section>
  `,
})
export class SkillsSectionComponent {
  readonly lang = inject(LanguageService);

  /**
   * Copy and layout arrive pre-joined by skill id, so a reorder in the admin
   * cannot pair the wrong title with the wrong card.
   */
  readonly cards = computed(() =>
    this.lang.content().skills.map((skill) => ({
      ...skill,
      caption: splitCommentMark(skill.caption),
      icon: iconFor(skill.icon, "lucideSparkles"),
      layout: SPAN_MAP[skill.span],
    })),
  );
}
