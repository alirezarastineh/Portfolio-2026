import {
  ChangeDetectionStrategy,
  Component,
  inject,
  input,
  ViewEncapsulation,
} from "@angular/core";
import { RouterLink } from "@angular/router";

import { formatDay } from "../content/period";
import type { PostSummary } from "../content/schema";
import { fmt } from "../i18n/interpolate";
import { LanguageService } from "../services/language.service";

/**
 * Posts as dense rows, newest first: the date and reading time in the left
 * columns, then the title, the excerpt and the tags. The whole row is the
 * title's link (`.card-link`, whose focus ring follows the row's edge); under
 * a pointer the row lifts onto `surface-2` and an arrow slides in, which a
 * keyboard focus shows too. Shared by the writing index (titles are `h2`) and
 * the home page's section (`h3`).
 *
 * Not encapsulated: its two class names are its own, and emulation would print
 * an attribute on every element of every row into the server's HTML. The
 * styles are written compact for the same reason (they are inlined too).
 */
@Component({
  selector: "app-post-list",
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  imports: [RouterLink],
  host: { class: "block" },
  styles: `
    .post-arrow {
      opacity: 0;
    }
    .post-row:has(a:focus-visible) .post-arrow {
      opacity: 1;
    }
    @media (hover: hover) {
      .post-row:hover {
        background-color: var(--surface-2);
      }
      .post-row:hover .post-arrow {
        opacity: 1;
      }
    }
    @media (prefers-reduced-motion: no-preference) {
      .post-row {
        transition: background-color var(--dur-2) var(--ease-out);
      }
      .post-arrow {
        translate: -6px 0;
        transition:
          opacity var(--dur-3) var(--ease-out),
          translate var(--dur-3) var(--ease-out);
      }
      .post-row:has(a:focus-visible) .post-arrow {
        translate: 0 0;
      }
      @media (hover: hover) {
        .post-row:hover .post-arrow {
          translate: 0 0;
        }
      }
    }
  `,
  template: `
    <ol
      class="m-0 flex list-none flex-col divide-y divide-border border-y border-border p-0"
      role="list"
    >
      @for (post of posts(); track post.slug) {
        <li class="reveal py-2">
          <article
            class="post-row relative -mx-3 grid gap-x-(--col-gap) gap-y-2 rounded-xl px-3 py-4 md:grid-cols-12"
          >
            <p
              class="m-0 flex flex-wrap gap-x-2 font-mono text-meta tabular-nums text-muted-foreground md:col-span-3 md:flex-col lg:col-span-2"
            >
              <time class="text-foreground" [attr.datetime]="post.publishedAt">{{
                day(post.publishedAt)
              }}</time>
              <span>{{ readingTime(post.readingMinutes) }}</span>
            </p>
            <div class="flex min-w-0 flex-col gap-2 md:col-span-8 lg:col-span-9">
              @if (level() === 3) {
                <h3 class="m-0 text-balance text-h3 text-foreground">
                  <a class="card-link" [routerLink]="link(post)">{{ post.title }}</a>
                </h3>
              } @else {
                <h2 class="m-0 text-balance text-h3 text-foreground">
                  <a class="card-link" [routerLink]="link(post)">{{ post.title }}</a>
                </h2>
              }
              @if (post.excerpt) {
                <p class="m-0 max-w-[68ch] text-pretty text-muted-foreground">
                  {{ post.excerpt }}
                </p>
              }
              @if (post.tags.length) {
                <p class="m-0 font-mono text-meta text-muted-foreground">{{ tags(post) }}</p>
              }
            </div>
            <span
              class="post-arrow hidden self-center justify-self-end text-h4 text-accent-orange md:block"
              aria-hidden="true"
              >→</span
            >
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

  /** `#rag #infra` as one line of text, the tags an en space apart. */
  protected tags(post: PostSummary): string {
    return post.tags.map((t) => `#${t}`).join(" ");
  }

  protected day(iso: string): string {
    return formatDay(iso, this.lang.lang());
  }

  protected readingTime(minutes: number): string {
    return fmt(this.lang.t().writing.readingTime, { n: minutes });
  }
}
