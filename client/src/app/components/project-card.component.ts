import { isPlatformBrowser } from "@angular/common";
import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  ElementRef,
  inject,
  input,
  PLATFORM_ID,
} from "@angular/core";
import { RouterLink } from "@angular/router";
import { NgIcon, provideIcons } from "@ng-icons/core";
import { lucideArrowRight, lucideExternalLink, lucideFileText } from "@ng-icons/lucide";

import { brandGithub } from "../icons/brand-icons";
import { PictureComponent } from "./picture.component";
import type { CardLayout } from "./project-layout";
import type { Project } from "../content/schema";
import { CHROME } from "../i18n/chrome";
import { fmt } from "../i18n/interpolate";
import { trackPointer } from "../motion/pointer";
import { projectTitleTransitionName, projectTransitionName } from "../navigation/view-transitions";
import { LanguageService } from "../services/language.service";

interface DetailBlock {
  label: string;
  body: string;
  list?: string[];
  /** Rendered with [innerHTML] rather than interpolation. */
  rich?: boolean;
}

interface ExternalLink {
  label: string;
  href: string;
  icon: string;
}

/** Metrics a card shows; the case study shows them all. */
const CARD_METRICS = 3;
/** Technologies a card shows as chips; the rest are counted (`+2`). */
const CARD_STACK = 5;

/**
 * Per layout: the card's grid, the image's and the text's columns, and the
 * image's rendered width for `sizes`. Below `lg` every card is one column.
 */
const LAYOUTS: Record<CardLayout, { card: string; media: string; body: string; sizes: string }> = {
  featured: {
    card: "lg:grid lg:grid-cols-12",
    media: "lg:col-span-7 lg:aspect-auto lg:border-b-0 lg:border-r",
    body: "lg:col-span-5",
    sizes: "(min-width: 1280px) 690px, (min-width: 1024px) 55vw, 100vw",
  },
  wide: {
    card: "lg:grid lg:grid-cols-12",
    media: "lg:col-span-5 lg:aspect-auto lg:border-b-0 lg:border-r",
    body: "lg:col-span-7",
    sizes: "(min-width: 1280px) 495px, (min-width: 1024px) 40vw, 100vw",
  },
  half: {
    card: "",
    media: "",
    body: "",
    sizes: "(min-width: 1280px) 580px, (min-width: 1024px) 46vw, 100vw",
  },
};

/**
 * A project on the home page. With a case study the whole card is its "Read
 * case study" link (stretched over the card; the live and repo links sit above
 * it), and its image and title morph into the case study's. Without one, its
 * problem / architecture / infra / outcomes open in place (a native
 * `<details>`, so no script is needed). Hover and focus styles: motion.css.
 */
@Component({
  selector: "app-project-card",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgIcon, PictureComponent, RouterLink],
  viewProviders: [
    provideIcons({ lucideArrowRight, lucideExternalLink, lucideFileText, brandGithub }),
  ],
  host: {
    class: "block",
  },
  template: `
    <article
      class="project-card surface-card relative isolate flex h-full flex-col overflow-hidden transition-[border-color,box-shadow] duration-(--dur-3) data-link:hover:border-border-strong data-link:hover:shadow-e2 data-link:has-focus-visible:border-border-strong data-link:has-focus-visible:shadow-e2"
      [class]="classes().card"
      [attr.data-link]="project().hasCaseStudy ? '' : null"
    >
      <div
        class="card-media relative aspect-16/10 shrink-0 overflow-hidden border-b border-border bg-muted"
        [class]="classes().media"
        [style.view-transition-name]="transitionName()"
      >
        <app-picture
          [image]="project().cover"
          [sizes]="classes().sizes"
          [imgClass]="'block size-full object-cover'"
        />
      </div>

      <div class="flex flex-1 flex-col gap-5 p-6 sm:p-8" [class]="classes().body">
        <!-- The number is decoration: the list's order already says it. -->
        <p class="eyebrow m-0 flex flex-wrap gap-x-3 text-muted-foreground">
          <span class="text-foreground" aria-hidden="true">{{ indexLabel() }}</span>
          @if (project().descriptor) {
            <span>{{ project().descriptor }}</span>
          }
        </p>
        <h3
          class="m-0 w-fit text-balance text-h3 text-foreground"
          [style.view-transition-name]="titleTransitionName()"
        >
          {{ project().name }}
        </h3>
        @if (project().hook) {
          <p class="m-0 line-clamp-2 text-pretty text-muted-foreground">
            {{ project().hook }}
          </p>
        }

        @if (metrics().length) {
          <dl class="m-0 grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-3">
            @for (metric of metrics(); track metric.label) {
              <div class="flex flex-col gap-1 border-t-2 border-accent-orange pt-3">
                <dt class="order-2 font-mono text-meta text-muted-foreground">
                  {{ metric.label }}
                </dt>
                <dd class="order-1 m-0 text-h3 tabular-nums text-foreground">
                  {{ metric.value }}
                </dd>
              </div>
            }
          </dl>
        }

        @if (stack().shown.length) {
          <ul
            class="m-0 flex list-none flex-wrap gap-2 p-0"
            role="list"
            [attr.aria-label]="lang.t().projectCard.techStackAriaLabel"
          >
            @for (tech of stack().shown; track tech) {
              <li class="chip">{{ tech }}</li>
            }
            @if (stack().more) {
              <li class="chip text-muted-foreground">
                <span aria-hidden="true">+{{ stack().more }}</span
                ><span class="sr-only">{{ stack().rest }}</span>
              </li>
            }
          </ul>
        }

        @if (!project().hasCaseStudy && hasDetails()) {
          <details class="card-details group/details rounded-lg border border-border">
            <summary
              class="flex cursor-pointer list-none items-center gap-2 px-4 py-3 font-mono text-meta text-foreground [&::-webkit-details-marker]:hidden"
            >
              <span
                class="inline-block text-accent-orange motion-safe:transition-transform motion-safe:duration-(--dur-3) group-open/details:rotate-45"
                aria-hidden="true"
                >+</span
              >
              {{ chrome().details }}
            </summary>
            <dl class="m-0 grid gap-4 border-t border-border px-4 py-4">
              @for (block of blocks(); track block.label) {
                <div class="flex flex-col gap-1.5">
                  <dt class="eyebrow text-accent-orange">{{ block.label }}</dt>
                  @if (block.list) {
                    <dd class="m-0">
                      <ul class="m-0 flex list-none flex-col gap-1 p-0" role="list">
                        @for (item of block.list; track item) {
                          <li
                            class="flex items-baseline gap-2 text-sm leading-relaxed text-foreground/90"
                          >
                            <span class="text-accent-orange" aria-hidden="true">▸</span>
                            <span>{{ item }}</span>
                          </li>
                        }
                      </ul>
                    </dd>
                  } @else {
                    <!-- Sanitized on write by the API; Angular sanitizes again here. -->
                    <dd
                      class="prose-compact m-0 text-sm leading-relaxed text-foreground/90"
                      [innerHTML]="block.body"
                    ></dd>
                  }
                </div>
              }
            </dl>
          </details>
        }

        @if (project().hasCaseStudy || links().length) {
          <div class="mt-auto flex flex-wrap items-center justify-between gap-x-6 gap-y-3 pt-1">
            @if (project().hasCaseStudy) {
              <!-- Stretched over the whole card (motion.css). -->
              <a
                class="card-link inline-flex min-h-6 items-center gap-2 font-mono text-meta font-medium text-foreground"
                [routerLink]="caseStudyLink()"
              >
                <span
                  >{{ lang.t().caseStudy.readCaseStudy
                  }}<span class="sr-only">: {{ project().name }}</span></span
                >
                <ng-icon
                  class="card-arrow text-accent-orange"
                  name="lucideArrowRight"
                  size="14"
                  aria-hidden="true"
                />
              </a>
            }
            @if (links().length) {
              <ul
                class="m-0 flex list-none flex-wrap gap-2 p-0"
                role="list"
                [attr.aria-label]="chrome().links"
              >
                @for (link of links(); track link.href) {
                  <li>
                    <a
                      class="relative z-10 inline-flex h-9 items-center gap-1.5 rounded-md border border-border px-2.5 font-mono text-meta text-muted-foreground transition-colors duration-(--dur-2) hover:border-border-strong hover:text-foreground"
                      [href]="link.href"
                      target="_blank"
                      rel="noreferrer noopener"
                    >
                      <ng-icon [name]="link.icon" size="14" aria-hidden="true" />
                      <span>{{ link.label }}</span>
                    </a>
                  </li>
                }
              </ul>
            }
          </div>
        }
      </div>
    </article>
  `,
})
export class ProjectCardComponent {
  readonly lang = inject(LanguageService);
  readonly project = input.required<Project>();
  readonly index = input<number>(0);
  /** Where the card sits in the section's grid (project-layout.ts). */
  readonly layout = input<CardLayout>("half");

  protected readonly classes = computed(() => LAYOUTS[this.layout()]);
  protected readonly chrome = computed(() => CHROME[this.lang.lang()].projectCard);

  readonly caseStudyLink = computed(() => ["/", this.lang.lang(), "work", this.project().slug]);
  /** Shared with the case study's cover and `<h1>`, which these morph into. */
  readonly transitionName = computed(() =>
    this.project().hasCaseStudy ? projectTransitionName(this.project().slug) : null,
  );
  readonly titleTransitionName = computed(() =>
    this.project().hasCaseStudy ? projectTitleTransitionName(this.project().slug) : null,
  );

  readonly indexLabel = computed(() => {
    // Padding lives here now rather than baked into the copy, so the editable
    // string is just `case · {i}` and it still reads correctly past 9.
    const i = String(this.index() + 1).padStart(2, "0");
    return fmt(this.lang.t().projectCard.caseLabel, { i });
  });

  protected readonly metrics = computed(() => this.project().metrics.slice(0, CARD_METRICS));

  /** The chips shown, and the rest: counted on screen, named for screen readers. */
  protected readonly stack = computed(() => {
    const stack = this.project().stack;
    return {
      shown: stack.slice(0, CARD_STACK),
      more: Math.max(0, stack.length - CARD_STACK),
      rest: stack.slice(CARD_STACK).join(", "),
    };
  });

  readonly blocks = computed<DetailBlock[]>(() => {
    const p = this.project();
    const c = this.lang.t().projectCard;
    const blocks: DetailBlock[] = [
      { label: c.problem, body: p.problem, rich: true },
      { label: c.arch, body: p.aiArchitecture, rich: true },
      { label: c.infra, body: p.fullStackInfra, rich: true },
      { label: c.outcomes, body: "", list: p.outcomes },
    ];
    return blocks.filter((block) => (block.list ? block.list.length > 0 : hasText(block.body)));
  });

  protected readonly hasDetails = computed(() => this.blocks().length > 0);

  readonly links = computed<ExternalLink[]>(() => {
    const l = this.project().links;
    const c = this.lang.t().projectCard;
    const out: ExternalLink[] = [];
    if (l.live) out.push({ label: c.live, href: l.live, icon: "lucideExternalLink" });
    if (l.repo) out.push({ label: c.repo, href: l.repo, icon: "brandGithub" });
    if (l.caseStudy) out.push({ label: c.caseStudy, href: l.caseStudy, icon: "lucideFileText" });
    return out;
  });

  constructor() {
    // The indigo spotlight follows a mouse over a card that leads somewhere.
    // Attached in the browser only, so the server's HTML carries no listener.
    if (!isPlatformBrowser(inject(PLATFORM_ID))) return;
    const host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
    const move = (event: PointerEvent) => {
      if (this.project().hasCaseStudy) trackPointer(host, event);
    };
    afterNextRender(() => host.addEventListener("pointermove", move, { passive: true }));
    inject(DestroyRef).onDestroy(() => host.removeEventListener("pointermove", move));
  }
}

/** Rich text with something in it once the tags are gone. */
function hasText(html: string): boolean {
  let cursor = 0;

  while (cursor < html.length) {
    const tagStart = html.indexOf("<", cursor);
    if (tagStart === -1) return html.slice(cursor).trim().length > 0;

    if (html.slice(cursor, tagStart).trim().length > 0) return true;

    const tagEnd = html.indexOf(">", tagStart + 1);
    if (tagEnd === -1) return html.slice(tagStart).trim().length > 0;

    cursor = tagEnd + 1;
  }

  return false;
}
