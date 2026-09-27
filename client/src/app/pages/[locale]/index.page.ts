import { ChangeDetectionStrategy, Component, computed, inject } from "@angular/core";
import type { RouteMeta } from "@analogjs/router";

import { homeSections, sectionIndexes } from "../../content/home-sections";
import { homeHeadResolver, homeMetaResolver, homeTitleResolver } from "../../seo/seo-meta";
import { AboutSectionComponent } from "../../sections/about.component";
import { ContactSectionComponent } from "../../sections/contact.component";
import { ExperienceSectionComponent } from "../../sections/experience.component";
import { HeroSectionComponent } from "../../sections/hero.component";
import { ProjectsSectionComponent } from "../../sections/projects.component";
import { SkillsSectionComponent } from "../../sections/skills.component";
import { WritingSectionComponent } from "../../sections/writing.component";
import { LanguageService } from "../../services/language.service";

export const routeMeta: RouteMeta = {
  title: homeTitleResolver,
  meta: homeMetaResolver,
  resolve: { head: homeHeadResolver },
};

/**
 * Proof first: the work, then where it was done, then the skills behind it,
 * then writing, the person, and a way to get in touch.
 *
 * Below the hero, every section is server-rendered in full but hydrated
 * later, so its code stays out of the first load: experience, skills and
 * about when they scroll into view (`hydrate on viewport`); the work, the
 * posts and the contact form — links and a form — once the browser is idle.
 * When the page is rendered in the browser instead (arriving from another
 * page), the sections load at once (`on immediate`).
 */
@Component({
  selector: "app-home",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    AboutSectionComponent,
    ContactSectionComponent,
    ExperienceSectionComponent,
    HeroSectionComponent,
    ProjectsSectionComponent,
    SkillsSectionComponent,
    WritingSectionComponent,
  ],
  template: `
    <main id="main" class="block">
      <app-hero-section />
      <!-- Sections that lead elsewhere hydrate once the browser is idle, not
           in view: a link followed before its section had hydrated would load
           the next page in full, without the page transition. -->
      @defer (on immediate; hydrate on idle) {
        <app-projects-section [index]="index().projects" />
      }
      @defer (on immediate; hydrate on viewport) {
        <app-experience-section [index]="index().experience" />
      }
      @defer (on immediate; hydrate on viewport) {
        <app-skills-section [index]="index().skills" />
      }
      @defer (on immediate; hydrate on idle) {
        <app-writing-section [index]="index().writing" />
      }
      @defer (on immediate; hydrate on viewport) {
        <app-about-section [index]="index().about" />
      }
      <!-- The form too: typing into it before its code had arrived could be
           lost as the form took over. -->
      @defer (on immediate; hydrate on idle) {
        <app-contact-section [index]="index().contact" />
      }
    </main>
  `,
})
export default class Home {
  private readonly lang = inject(LanguageService);

  /** Each section's number, counting only the sections this content renders. */
  protected readonly index = computed(() => sectionIndexes(homeSections(this.lang.content())));
}
