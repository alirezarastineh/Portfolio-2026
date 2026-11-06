import { ChangeDetectionStrategy, Component, inject, input } from "@angular/core";
import { RouterLink } from "@angular/router";

import { formatDay } from "../content/period";
import type { PostSummary } from "../content/schema";
import { fmt } from "../i18n/interpolate";
import { LanguageService } from "../services/language.service";

/**
 * Posts as flat rows, newest first, space between them: the date at the left, then the title and
 * the excerpt. The whole row is the title's link (`.card-link`, its focus ring just outside the
 * row), and the title's underline draws while it is hovered, focused or pressed (motion.css).
 * Shared by the writing index (titles `h2`, with each post's reading time and tags) and the home
 * page's section (`h3`, date, title and excerpt only).
 */
@Component({
  selector: "app-post-list",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  host: { class: "block" },
  template: `
    <ol class="m-0 flex list-none flex-col gap-10 p-0" role="list">
      @for (post of posts(); track post.slug) {
        <li>
          <article class="relative grid gap-x-(--col-gap) gap-y-2 md:grid-cols-12">
            <p
              class="m-0 flex flex-wrap gap-x-3 text-data text-muted-foreground md:col-span-3 md:flex-col lg:col-span-2"
            >
              <time class="text-foreground" [attr.datetime]="post.publishedAt">{{
                day(post.publishedAt)
              }}</time>
              @if (level() === 2) {
                <span>{{ readingTime(post.readingMinutes) }}</span>
              }
            </p>
            <div class="flex min-w-0 flex-col gap-2 md:col-span-9 lg:col-span-10">
              @if (level() === 3) {
                <h3 class="m-0 text-balance text-title text-foreground">
                  <a class="card-link" [routerLink]="link(post)"
                    ><span class="title-draw">{{ post.title }}</span></a
                  >
                </h3>
              } @else {
                <h2 class="m-0 text-balance text-title text-foreground">
                  <a class="card-link" [routerLink]="link(post)"
                    ><span class="title-draw">{{ post.title }}</span></a
                  >
                </h2>
              }
              @if (post.excerpt) {
                <p class="m-0 max-w-[60ch] text-pretty text-muted-foreground">
                  {{ post.excerpt }}
                </p>
              }
              @if (level() === 2 && post.tags.length) {
                <p class="m-0 text-data text-muted-foreground">{{ tags(post) }}</p>
              }
            </div>
          </article>
        </li>
      }
    </ol>
  `,
})
export class PostListComponent {
  readonly posts = input.required<PostSummary[]>();
  /** The titles' heading level: 2 on the writing index, 3 under a home section's `h2`. */
  readonly level = input<2 | 3>(2);

  protected readonly lang = inject(LanguageService);

  protected link(post: PostSummary): string[] {
    return ["/", this.lang.lang(), "writing", post.slug];
  }

  /** `#rag #infra` as one line of text. */
  protected tags(post: PostSummary): string {
    return post.tags.map((t) => `#${t}`).join(" ");
  }

  protected day(iso: string): string {
    return formatDay(iso, this.lang.lang());
  }

  protected readingTime(minutes: number): string {
    return fmt(this.lang.t().writing.readingTime, { n: minutes });
  }
}
