import { Component } from "@angular/core";

import { AboutSectionComponent } from "../sections/about.component";
import { ContactSectionComponent } from "../sections/contact.component";
import { HeroSectionComponent } from "../sections/hero.component";
import { ProjectsSectionComponent } from "../sections/projects.component";
import { SkillsSectionComponent } from "../sections/skills.component";

@Component({
  selector: "app-home",
  imports: [
    AboutSectionComponent,
    ContactSectionComponent,
    HeroSectionComponent,
    ProjectsSectionComponent,
    SkillsSectionComponent,
  ],
  template: `
    <main class="block">
      <app-hero-section />
      <app-skills-section />
      <app-projects-section />
      <app-about-section />
      <app-contact-section />
    </main>
  `,
})
export default class Home {}
