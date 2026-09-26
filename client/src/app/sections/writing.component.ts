import { ChangeDetectionStrategy, Component, computed, inject } from "@angular/core";
import { RouterLink } from "@angular/router";
import { NgIcon, provideIcons } from "@ng-icons/core";
import { lucideArrowRight } from "@ng-icons/lucide";

import { SectionHeadingComponent } from "../components/section-heading.component";
import { formatDay } from "../content/period";
import { fmt } from "../i18n/interpolate";
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
  imports: [NgIcon, RouterLink, SectionHeadingComponent],
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

          <ol class="m-0 grid list-none gap-4 p-0 md:grid-cols-3" role="list">
            @for (post of posts(); track post.slug) {
              <li>
                <article
                  class="surface-card relative flex h-full flex-col gap-3 p-6 transition-[border-color,box-shadow] duration-200 hover:border-accent-orange/40 hover:shadow-e2"
                >
                  <p class="m-0 font-mono text-xs text-muted-foreground">
                    <time [attr.datetime]="post.publishedAt">{{ day(post.publishedAt) }}</time>
                    · {{ readingTime(post.readingMinutes) }}
                  </p>
                  <h3 class="m-0 text-xl font-semibold leading-snug tracking-tight text-foreground">
                    <!-- The whole card is the link's hit area (after:inset-0). -->
                    <a
                      class="after:absolute after:inset-0 after:rounded-xl"
                      [routerLink]="['/', lang.lang(), 'writing', post.slug]"
                      >{{ post.title }}</a
                    >
                  </h3>
                  @if (post.excerpt) {
                    <p class="m-0 line-clamp-3 text-pretty leading-relaxed text-muted-foreground">
                      {{ post.excerpt }}
                    </p>
                  }
                </article>
              </li>
            }
          </ol>
        </div>
      </section>
    }
  `,
})
export class WritingSectionComponent {
  protected readonly lang = inject(LanguageService);

  /** Already newest first. */
  protected readonly posts = computed(() => this.lang.content().posts.slice(0, LATEST));

  protected day(iso: string): string {
    return formatDay(iso, this.lang.lang());
  }

  protected readingTime(minutes: number): string {
    return fmt(this.lang.t().writing.readingTime, { n: minutes });
  }
}
