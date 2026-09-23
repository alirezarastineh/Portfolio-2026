import { ChangeDetectionStrategy, Component } from "@angular/core";
import type { RouteMeta } from "@analogjs/router";

import { homeHeadResolver, homeMetaResolver, homeTitleResolver } from "../../seo/seo-meta";
import { AboutSectionComponent } from "../../sections/about.component";
import { ContactSectionComponent } from "../../sections/contact.component";
import { ExperienceSectionComponent } from "../../sections/experience.component";
import { HeroSectionComponent } from "../../sections/hero.component";
import { ProjectsSectionComponent } from "../../sections/projects.component";
import { SkillsSectionComponent } from "../../sections/skills.component";

export const routeMeta: RouteMeta = {
  title: homeTitleResolver,
  meta: homeMetaResolver,
  resolve: { head: homeHeadResolver },
};

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
  ],
  template: `
    <main class="block">
      <app-hero-section />
      <app-skills-section />
      <app-projects-section />
      <app-experience-section />
      <app-about-section />
      <app-contact-section />
    </main>
  `,
})
export default class Home {}
