import { ChangeDetectionStrategy, Component, computed, inject, input } from "@angular/core";
import { RouterLink } from "@angular/router";
import { NgIcon, provideIcons } from "@ng-icons/core";
import { lucideArrowRight } from "@ng-icons/lucide";

import { PostListComponent } from "../components/post-list.component";
import { SectionHeadingComponent } from "../components/section-heading.component";
import { LanguageService } from "../services/language.service";

/** How many posts the home page shows; the rest are one click away. */
const LATEST = 3;

/**
 * The newest posts on the home page, with a link to all of them. Rendered
 * only when this language has any.
 */
@Component({
  selector: "app-writing-section",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgIcon, PostListComponent, RouterLink, SectionHeadingComponent],
  viewProviders: [provideIcons({ lucideArrowRight })],
  host: { class: "block" },
  template: `
    @if (posts().length) {
      <section
        id="writing"
        aria-labelledby="writing-heading"
        class="container-site section-y relative"
      >
        <div class="flex flex-col gap-12">
          <app-section-heading
            headingId="writing-heading"
            [index]="index()"
            [heading]="lang.t().writing.heading"
            [eyebrow]="lang.t().writing.subtitle"
          >
            <a
              class="link-underline inline-flex items-center gap-2 font-mono text-sm"
              [routerLink]="['/', lang.lang(), 'writing']"
            >
              {{ lang.t().writing.allPosts }}
              <ng-icon name="lucideArrowRight" size="14" aria-hidden="true" />
            </a>
          </app-section-heading>

          <!-- The writing index's rows (titles h3 here, under the section's h2). -->
          <app-post-list [posts]="posts()" [level]="3" />
        </div>
      </section>
    }
  `,
})
export class WritingSectionComponent {
  /** The section's number on the home page, `01`; set by the page. */
  readonly index = input("");

  protected readonly lang = inject(LanguageService);

  /** Already newest first. */
  protected readonly posts = computed(() => this.lang.content().posts.slice(0, LATEST));
}
