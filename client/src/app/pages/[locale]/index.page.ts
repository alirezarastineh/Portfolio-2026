import { DOCUMENT } from "@angular/common";
import { ChangeDetectionStrategy, Component, inject } from "@angular/core";
import type { ActivatedRouteSnapshot, RouterStateSnapshot } from "@angular/router";
import type { RouteMeta } from "@analogjs/router";

import type { Locale } from "../../content/locale";
import { homeHeadResolver, homeMetaResolver, homeTitleResolver } from "../../seo/seo-meta";
import { AboutSectionComponent } from "../../sections/about.component";
import { ContactSectionComponent } from "../../sections/contact.component";
import { ExperienceSectionComponent } from "../../sections/experience.component";
import { HeroSectionComponent } from "../../sections/hero.component";
import { ProjectsSectionComponent } from "../../sections/projects.component";
import { SkillsSectionComponent } from "../../sections/skills.component";
import { WritingSectionComponent } from "../../sections/writing.component";
import { LanguageService } from "../../services/language.service";

/** The browser's own confirm, before a link takes the reader away from an unsent message. */
const LEAVE: Record<Locale, string> = {
  en: "Your message hasn’t been sent. Leave this page anyway?",
  de: "Ihre Nachricht ist noch nicht gesendet. Seite trotzdem verlassen?",
};

/**
 * Text in the contact form's message that has not been sent: the field goes once it is. Read from
 * the page, so text typed before the form's code arrived counts too.
 */
function unsent(doc: Document): boolean {
  const message = doc.getElementById("contact-message");
  return message instanceof HTMLTextAreaElement && message.value.trim() !== "";
}

/** Home again (a section, the other language) keeps the form; another page would lose it. */
function leaveHome(
  _home: unknown,
  here: ActivatedRouteSnapshot,
  _from: RouterStateSnapshot,
  to: RouterStateSnapshot,
): boolean {
  let next = to.root;
  while (next.firstChild) next = next.firstChild;
  const doc = inject(DOCUMENT);
  if (next.routeConfig === here.routeConfig || !unsent(doc)) return true;
  return doc.defaultView?.confirm(LEAVE[inject(LanguageService).lang()]) ?? true;
}

export const routeMeta: RouteMeta = {
  title: homeTitleResolver,
  meta: homeMetaResolver,
  resolve: { head: homeHeadResolver },
  canDeactivate: [leaveHome],
};

/**
 * Proof first: the work, then the person, then the record (where it was done, the skills behind
 * it, writing), and a way to get in touch.
 *
 * Below the hero, every section is server-rendered in full but hydrated
 * later, so its code stays out of the first load: about, experience and skills
 * when they scroll into view (`hydrate on viewport`); the work, the posts and
 * the contact form — links and a form — once the browser is idle. When the
 * page is rendered in the browser instead (arriving from another page), the
 * sections load at once (`on immediate`).
 *
 * Leaving or reloading with an unsent message asks first, in the browser's own words.
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
  host: { "(window:beforeunload)": "warn($event)" },
  template: `
    <main id="main" class="block">
      <app-hero-section />
      <!-- The line beside the sections, filling as the reader goes, to Send (motion.css). -->
      <div class="relative">
        <span class="page-line" aria-hidden="true"></span>
        <!-- The work and the posts lead elsewhere from early on: they hydrate once
             the browser is idle, not in view, since a link followed before its
             section had hydrated would load the next page in full, without the
             page transition. -->
        @defer (on immediate; hydrate on idle) {
          <app-projects-section />
        }
        @defer (on immediate; hydrate on viewport) {
          <app-about-section />
        }
        @defer (on immediate; hydrate on viewport) {
          <app-experience-section />
        }
        @defer (on immediate; hydrate on viewport) {
          <app-skills-section />
        }
        @defer (on immediate; hydrate on idle) {
          <app-writing-section />
        }
        <!-- The form too: typing into it before its code had arrived could be
             lost as the form took over. -->
        @defer (on immediate; hydrate on idle) {
          <app-contact-section />
        }
      </div>
    </main>
  `,
})
export default class Home {
  private readonly doc = inject(DOCUMENT);

  protected warn(event: Event): void {
    if (unsent(this.doc)) event.preventDefault();
  }
}
