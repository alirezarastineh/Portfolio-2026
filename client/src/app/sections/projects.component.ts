import { ChangeDetectionStrategy, Component, computed, inject } from "@angular/core";

import { ProjectCardComponent } from "../components/project-card.component";
import { cardLayouts } from "../components/project-layout";
import { SectionHeadingComponent } from "../components/section-heading.component";
import { LanguageService } from "../services/language.service";

/**
 * Selected work: every project, in the admin's order, as flat plates that lead
 * to their case studies, with space between them. Featured projects span the
 * row; the rest go two across, and a plate that would be left alone on its row
 * spans it too.
 */
@Component({
  selector: "app-projects-section",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ProjectCardComponent, SectionHeadingComponent],
  host: {
    class: "block",
  },
  template: `
    <section
      id="projects"
      aria-labelledby="projects-heading"
      class="container-site section-y relative"
    >
      <div class="flex flex-col gap-12">
        <app-section-heading headingId="projects-heading" [heading]="lang.t().projects.heading" />

        <ul
          class="m-0 grid list-none gap-x-(--col-gap) gap-y-12 p-0 md:grid-cols-2 md:gap-y-16"
          role="list"
        >
          @for (project of projects(); track project.slug; let i = $index) {
            <!-- Its id is where the skills' links find a project without a case study. -->
            <li
              [id]="'work-' + project.slug"
              [class]="layouts()[i] === 'half' ? '' : 'md:col-span-2'"
            >
              <app-project-card
                class="h-full"
                [project]="project"
                [layout]="layouts()[i] ?? 'half'"
              />
            </li>
          }
        </ul>
      </div>
    </section>
  `,
})
export class ProjectsSectionComponent {
  readonly lang = inject(LanguageService);
  readonly projects = computed(() => this.lang.content().projects);
  protected readonly layouts = computed(() => cardLayouts(this.projects()));
}
