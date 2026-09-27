import { ChangeDetectionStrategy, Component, computed, inject, input } from "@angular/core";

import { ProjectCardComponent } from "../components/project-card.component";
import { cardLayouts } from "../components/project-layout";
import { SectionHeadingComponent } from "../components/section-heading.component";
import { LanguageService } from "../services/language.service";

/**
 * Selected work: every project, in the admin's order, as cards that lead to
 * their case studies. Featured projects span the row; the rest go two across,
 * and a card that would be left alone on its row spans it too.
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
        <app-section-heading
          headingId="projects-heading"
          [index]="index()"
          [heading]="lang.t().projects.heading"
          [eyebrow]="lang.t().projects.subtitle"
        />

        <ul class="m-0 grid list-none gap-6 p-0 lg:grid-cols-2" role="list">
          @for (project of projects(); track project.slug; let i = $index) {
            <li [class]="layouts()[i] === 'half' ? '' : 'lg:col-span-2'">
              <app-project-card
                class="h-full"
                [project]="project"
                [index]="i"
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
  /** The section's number on the home page, `01`; set by the page. */
  readonly index = input("");

  readonly lang = inject(LanguageService);
  readonly projects = computed(() => this.lang.content().projects);
  protected readonly layouts = computed(() => cardLayouts(this.projects()));
}
