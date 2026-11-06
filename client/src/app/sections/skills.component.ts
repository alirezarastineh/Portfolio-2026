import { ChangeDetectionStrategy, Component, computed, inject } from "@angular/core";
import { RouterLink } from "@angular/router";

import { SectionHeadingComponent } from "../components/section-heading.component";
import type { Locale } from "../content/locale";
import { skillProof } from "../content/skill-proof";
import { LanguageService } from "../services/language.service";

/** Before the projects that use a group's skills. Here: only this section's chunk needs it. */
const USED_IN: Record<Locale, string> = { en: "Used in:", de: "Eingesetzt in:" };

/**
 * Skills as plain text in two columns from `md`, one on phones: each group's name, its skills as
 * a comma list, what it says about them, and the projects whose stack names one of them, each a
 * link to its case study, or to its plate on this page when it has none. The CMS's `span`, `icon`
 * and `caption` are no longer shown.
 */
@Component({
  selector: "app-skills-section",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, SectionHeadingComponent],
  host: {
    class: "block",
  },
  template: `
    <section id="skills" aria-labelledby="skills-heading" class="container-site section-y relative">
      <div class="flex flex-col gap-12">
        <app-section-heading headingId="skills-heading" [heading]="lang.t().skills.heading" />
        <ul
          class="m-0 grid list-none gap-x-(--col-gap) gap-y-10 p-0 md:grid-cols-2 md:gap-y-12"
          role="list"
        >
          @for (group of groups(); track group.id) {
            <li class="flex flex-col gap-2">
              <h3 class="m-0 text-subtitle text-foreground">{{ group.title }}</h3>
              @if (group.items.length) {
                <p class="m-0 max-w-[60ch] text-pretty text-foreground/85" translate="no">
                  {{ group.items.join(", ") }}
                </p>
              }
              @if (group.narrative) {
                <p class="m-0 max-w-[60ch] text-pretty text-small text-muted-foreground">
                  {{ group.narrative }}
                </p>
              }
              @if (group.proof.length) {
                <p class="m-0 text-small text-muted-foreground">
                  {{ usedIn() }}
                  @for (project of group.proof; track project.slug) {
                    <a
                      class="link-underline"
                      [routerLink]="project.hasCaseStudy ? caseStudy(project.slug) : home()"
                      [fragment]="project.hasCaseStudy ? undefined : 'work-' + project.slug"
                      >{{ project.name }}</a
                    >{{ $last ? "" : ", " }}
                  }
                </p>
              }
            </li>
          }
        </ul>
      </div>
    </section>
  `,
})
export class SkillsSectionComponent {
  readonly lang = inject(LanguageService);

  protected readonly usedIn = computed(() => USED_IN[this.lang.lang()]);
  protected readonly home = computed(() => ["/", this.lang.lang()]);

  /** Each group with its proof, read from the projects' stacks: no field of its own. */
  protected readonly groups = computed(() => {
    const { skills, projects } = this.lang.content();
    return skills.map((skill) => ({ ...skill, proof: skillProof(skill.items, projects) }));
  });

  protected caseStudy(slug: string): string[] {
    return ["/", this.lang.lang(), "work", slug];
  }
}
