import { ChangeDetectionStrategy, Component, computed, inject } from "@angular/core";

import { ProjectCardComponent } from "../components/project-card.component";
import { SectionHeadingComponent } from "../components/section-heading.component";
import { LanguageService } from "../services/language.service";

/**
 * Selected work: every project, in the admin's order, as cards that lead to
 * their case studies. Featured projects span the row.
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
      class="relative px-6 py-24 sm:px-8 sm:py-28 lg:px-12 lg:py-32"
    >
      <div class="mx-auto flex max-w-7xl flex-col gap-12">
        <app-section-heading
          headingId="projects-heading"
          [heading]="lang.t().projects.heading"
          [eyebrow]="lang.t().projects.subtitle"
        />

        <ul class="m-0 grid list-none gap-6 p-0 lg:grid-cols-2" role="list">
          @for (project of projects(); track project.slug; let i = $index) {
            <li [class]="project.featured ? 'lg:col-span-2' : ''">
              <app-project-card
                class="h-full"
                [project]="project"
                [index]="i"
                [featured]="project.featured"
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
}
