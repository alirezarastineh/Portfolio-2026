import { ChangeDetectionStrategy, Component, computed, inject, input } from "@angular/core";
import { RouterLink } from "@angular/router";
import { NgIcon, provideIcons } from "@ng-icons/core";
import { lucideExternalLink, lucideFileText } from "@ng-icons/lucide";

import { MatchMarkComponent, MatchMarks } from "../ask/match-marks";
import { MetricsComponent } from "./metrics.component";
import { brandGithub } from "../icons/brand-icons";
import { PictureComponent } from "./picture.component";
import type { CardLayout } from "./project-layout";
import type { Project } from "../content/schema";
import { CHROME } from "../i18n/chrome";
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

/** Metrics a plate shows; the case study shows them all. */
const CARD_METRICS = 3;

/**
 * Per layout: the plate's grid, the cover's and the text's columns, and the
 * cover's rendered width for `sizes`. Below `lg`, and without a cover, a plate
 * is one column.
 */
const LAYOUTS: Record<CardLayout, { card: string; media: string; body: string; sizes: string }> = {
  featured: {
    card: "lg:grid lg:grid-cols-12 lg:items-start lg:gap-x-(--col-gap)",
    media: "lg:col-span-7",
    body: "lg:col-span-5",
    sizes: "(min-width: 1280px) 690px, (min-width: 1024px) 55vw, 100vw",
  },
  wide: {
    card: "lg:grid lg:grid-cols-12 lg:items-start lg:gap-x-(--col-gap)",
    media: "lg:col-span-5",
    body: "lg:col-span-7",
    sizes: "(min-width: 1280px) 495px, (min-width: 1024px) 40vw, 100vw",
  },
  half: {
    card: "",
    media: "",
    body: "",
    sizes: "(min-width: 1280px) 580px, (min-width: 768px) 46vw, 100vw",
  },
};

/**
 * A project on the home page, as a flat plate: no box, space around it. With a
 * case study the whole plate is its "Read case study" link (stretched over it;
 * the live and repo links sit above it), its title's underline draws while the
 * link is hovered, focused or pressed, and its cover and title morph into the
 * case study's. Without one, its problem / architecture / infra / outcomes open
 * in place (a native `<details>`, so no script is needed). Link styles:
 * motion.css.
 */
@Component({
  selector: "app-project-card",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatchMarkComponent, MetricsComponent, NgIcon, PictureComponent, RouterLink],
  viewProviders: [provideIcons({ lucideExternalLink, lucideFileText, brandGithub })],
  host: {
    class: "block",
  },
  template: `
    <article class="relative isolate flex h-full flex-col gap-6" [class]="classes().card">
      @if (project().cover; as cover) {
        <div
          class="card-media relative aspect-16/10 shrink-0 overflow-hidden bg-muted"
          [class]="classes().media"
          [style.view-transition-name]="transitionName()"
        >
          <app-picture
            [image]="cover"
            [sizes]="classes().sizes"
            [imgClass]="'block size-full object-cover'"
          />
        </div>
      }

      <!-- What it is close together; its proof and its stack apart. -->
      <div class="flex flex-1 flex-col gap-6" [class]="classes().body">
        <div class="flex flex-col gap-3">
          <div class="flex flex-col gap-1">
            <h3
              class="m-0 w-fit text-balance text-title text-foreground"
              [style.view-transition-name]="titleTransitionName()"
            >
              <span class="title-draw">{{ project().name }}</span>
            </h3>
            @if (project().descriptor) {
              <p class="m-0 text-muted-foreground">{{ project().descriptor }}</p>
            }
          </div>
          @if (project().hook) {
            <p class="m-0 max-w-[60ch] text-pretty text-foreground/85">{{ project().hook }}</p>
          }
        </div>
        @if (marks.count("project:" + project().slug); as n) {
          <app-match-mark [n]="n" />
        }

        @if (metrics().length) {
          <!-- No larger than the title: the plate is the project, not the number. -->
          <app-metrics class="[--metric-max:2rem] [--metric-min:8.5rem]" [metrics]="metrics()" />
        }

        @if (project().stack.length) {
          <p class="m-0 text-small text-muted-foreground">
            <span class="sr-only">{{ lang.t().projectCard.techStackAriaLabel }}: </span
            ><span translate="no">{{ project().stack.join(", ") }}</span>
          </p>
        }

        @if (!project().hasCaseStudy && hasDetails()) {
          <details class="disclosure">
            <summary class="press w-fit">{{ chrome().details }}</summary>
            <dl class="m-0 grid gap-4 pt-2">
              @for (block of blocks(); track block.label) {
                <div class="flex flex-col gap-1">
                  <dt class="text-data text-muted-foreground">{{ block.label }}</dt>
                  @if (block.list) {
                    <dd class="m-0">
                      <ul class="list-trace text-small text-foreground/90" role="list">
                        @for (item of block.list; track item) {
                          <li>{{ item }}</li>
                        }
                      </ul>
                    </dd>
                  } @else {
                    <!-- Sanitized on write by the API; Angular sanitizes again here. -->
                    <dd
                      class="prose-compact m-0 text-small text-foreground/90"
                      [innerHTML]="block.body"
                    ></dd>
                  }
                </div>
              }
            </dl>
          </details>
        }

        @if (project().hasCaseStudy || links().length) {
          <div class="mt-auto flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
            @if (project().hasCaseStudy) {
              <!-- Stretched over the whole plate (motion.css). -->
              <a
                class="card-link inline-flex min-h-6 items-center font-medium text-foreground"
                [routerLink]="caseStudyLink()"
                >{{ lang.t().caseStudy.readCaseStudy
                }}<span class="sr-only">: {{ project().name }}</span></a
              >
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
                      class="control press relative z-10"
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
  /** Where the plate sits in the section's grid (project-layout.ts). */
  readonly layout = input<CardLayout>("half");

  /** A plate without a cover is its text alone, one column at every width. */
  protected readonly classes = computed(
    () => LAYOUTS[this.project().cover ? this.layout() : "half"],
  );
  protected readonly chrome = computed(() => CHROME[this.lang.lang()].projectCard);
  protected readonly marks = inject(MatchMarks);

  readonly caseStudyLink = computed(() => ["/", this.lang.lang(), "work", this.project().slug]);
  /** Shared with the case study's cover and `<h1>`, which these morph into. */
  readonly transitionName = computed(() =>
    this.project().hasCaseStudy ? projectTransitionName(this.project().slug) : null,
  );
  readonly titleTransitionName = computed(() =>
    this.project().hasCaseStudy ? projectTitleTransitionName(this.project().slug) : null,
  );

  protected readonly metrics = computed(() => this.project().metrics.slice(0, CARD_METRICS));

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
