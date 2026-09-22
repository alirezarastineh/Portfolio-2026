import { DOCUMENT } from "@angular/common";
import { Component, effect, inject } from "@angular/core";
import type { RouteMeta } from "@analogjs/router";

import { PublicShellComponent } from "../layouts/public-shell.component";
import { applyCanonical, seoMetaResolver, seoTitleResolver } from "../seo/seo-meta";
import { LanguageService } from "../services/language.service";
import { AboutSectionComponent } from "../sections/about.component";
import { ContactSectionComponent } from "../sections/contact.component";
import { HeroSectionComponent } from "../sections/hero.component";
import { ProjectsSectionComponent } from "../sections/projects.component";
import { SkillsSectionComponent } from "../sections/skills.component";

export const routeMeta: RouteMeta = {
  title: seoTitleResolver,
  meta: seoMetaResolver,
};

@Component({
  selector: "app-home",
  imports: [
    AboutSectionComponent,
    ContactSectionComponent,
    HeroSectionComponent,
    ProjectsSectionComponent,
    PublicShellComponent,
    SkillsSectionComponent,
  ],
  template: `
    <app-public-shell>
      <main class="block">
        <app-hero-section />
        <app-skills-section />
        <app-projects-section />
        <app-about-section />
        <app-contact-section />
      </main>
    </app-public-shell>
  `,
})
export default class Home {
  private readonly lang = inject(LanguageService);
  private readonly document = inject(DOCUMENT);

  constructor() {
    // Re-applied on locale switch so the canonical never lags the content.
    effect(() => applyCanonical(this.document, this.lang.content().seo.canonical));
  }
}
