import { ChangeDetectionStrategy, Component, computed, inject } from "@angular/core";
import { RouterLink } from "@angular/router";

import { PostListComponent } from "../components/post-list.component";
import { SectionHeadingComponent } from "../components/section-heading.component";
import { LanguageService } from "../services/language.service";

/** How many posts the home page shows; the rest are one click away. */
const LATEST = 3;

/**
 * The newest posts on the home page, up to three, with a link to all of them. Rendered only when
 * this language has any.
 */
@Component({
  selector: "app-writing-section",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PostListComponent, RouterLink, SectionHeadingComponent],
  host: { class: "block" },
  template: `
    @if (posts().length) {
      <section
        id="writing"
        aria-labelledby="writing-heading"
        class="container-site section-y relative"
      >
        <div class="flex flex-col gap-12">
          <app-section-heading headingId="writing-heading" [heading]="lang.t().writing.heading">
            <a class="link-underline" [routerLink]="['/', lang.lang(), 'writing']">{{
              lang.t().writing.allPosts
            }}</a>
          </app-section-heading>

          <!-- The writing index's rows (titles h3 here, under the section's h2). -->
          <app-post-list [posts]="posts()" [level]="3" />
        </div>
      </section>
    }
  `,
})
export class WritingSectionComponent {
  protected readonly lang = inject(LanguageService);

  /** Already newest first. */
  protected readonly posts = computed(() => this.lang.content().posts.slice(0, LATEST));
}
