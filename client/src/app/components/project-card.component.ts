import { ChangeDetectionStrategy, Component, computed, inject, input } from "@angular/core";
import { RouterLink } from "@angular/router";
import { NgIcon, provideIcons } from "@ng-icons/core";
import {
  lucideArrowRight,
  lucideChevronDown,
  lucideExternalLink,
  lucideFileText,
} from "@ng-icons/lucide";

import { brandGithub } from "../icons/brand-icons";
import { PictureComponent } from "./picture.component";
import type { Project } from "../content/schema";
import { CHROME } from "../i18n/chrome";
import { fmt } from "../i18n/interpolate";
import { projectTransitionName } from "../navigation/view-transitions";
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

/**
 * A project on the home page. With a case study it leads there; without one,
 * its problem / architecture / infra / outcomes open in place (a native
 * `<details>`, so no script is needed). A featured project spans the row.
 */
@Component({
  selector: "app-project-card",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgIcon, PictureComponent, RouterLink],
  viewProviders: [
    provideIcons({
      lucideArrowRight,
      lucideChevronDown,
      lucideExternalLink,
      lucideFileText,
      brandGithub,
    }),
  ],
  host: {
    class: "block",
  },
  template: `
    <article
      class="flex h-full flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-elevated transition-colors duration-200 hover:border-accent-orange/40"
      [class]="featured() ? 'lg:flex-row' : ''"
    >
      <!-- Shares its view-transition name with the case study's cover, so
           opening the case study morphs this image into it. -->
      <div
        class="relative aspect-16/10 shrink-0 overflow-hidden border-b border-border bg-muted"
        [class]="featured() ? 'lg:aspect-auto lg:w-3/5 lg:border-b-0 lg:border-r' : ''"
        [style.view-transition-name]="transitionName()"
      >
        <app-picture
          [image]="project().cover"
          [sizes]="
            featured() ? '(min-width: 1024px) 60vw, 100vw' : '(min-width: 1024px) 50vw, 100vw'
          "
          imgClass="block size-full object-cover"
        />
        <span
          class="absolute left-4 top-4 rounded-md border border-border bg-card/80 px-2.5 py-1 font-mono text-[0.7rem] uppercase tracking-[0.18em] text-muted-foreground backdrop-blur-sm"
        >
          {{ indexLabel() }}
        </span>
      </div>

      <div class="flex flex-1 flex-col gap-5 p-6 sm:p-8">
        @if (project().descriptor) {
          <p class="m-0 font-mono text-[0.72rem] uppercase tracking-[0.22em] text-muted-foreground">
            {{ project().descriptor }}
          </p>
        }
        <h3
          class="m-0 text-2xl font-semibold leading-tight tracking-tight text-foreground sm:text-3xl"
        >
          {{ project().name }}
        </h3>
        @if (project().hook) {
          <p class="m-0 text-pretty leading-relaxed text-muted-foreground">
            {{ project().hook }}
          </p>
        }

        @if (metrics().length) {
          <dl
            class="m-0 grid grid-cols-2 gap-x-6 gap-y-4 border-y border-border py-4 sm:grid-cols-3"
          >
            @for (metric of metrics(); track metric.label) {
              <div class="flex flex-col-reverse gap-1">
                <dt class="text-xs leading-snug text-muted-foreground">{{ metric.label }}</dt>
                <dd class="m-0 text-2xl font-semibold tracking-tight text-foreground">
                  {{ metric.value }}
                </dd>
              </div>
            }
          </dl>
        }

        @if (project().stack.length) {
          <ul
            class="m-0 flex list-none flex-wrap gap-2 p-0"
            role="list"
            [attr.aria-label]="lang.t().projectCard.techStackAriaLabel"
          >
            @for (tech of project().stack; track tech) {
              <li
                class="rounded-md border border-border bg-muted/50 px-2 py-1 font-mono text-[0.7rem] text-foreground/85"
              >
                {{ tech }}
              </li>
            }
          </ul>
        }

        @if (!project().hasCaseStudy && hasDetails()) {
          <details class="group/details rounded-xl border border-border">
            <summary
              class="flex cursor-pointer list-none items-center justify-between gap-2 px-4 py-3 font-mono text-[0.78rem] text-foreground [&::-webkit-details-marker]:hidden"
            >
              {{ chrome().details }}
              <ng-icon
                name="lucideChevronDown"
                size="14"
                class="transition-transform duration-200 group-open/details:rotate-180"
                aria-hidden="true"
              />
            </summary>
            <dl class="m-0 grid gap-4 border-t border-border px-4 py-4">
              @for (block of blocks(); track block.label) {
                <div class="flex flex-col gap-1.5">
                  <dt
                    class="font-mono text-[0.68rem] uppercase tracking-[0.22em] text-accent-orange"
                  >
                    {{ block.label }}
                  </dt>
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

        <div class="mt-auto flex flex-wrap items-center gap-2 pt-2">
          @if (project().hasCaseStudy) {
            <a
              class="inline-flex h-10 items-center gap-2 rounded-lg bg-accent-orange px-4 font-mono text-[0.8rem] font-medium text-accent-orange-foreground transition-colors duration-200 hover:bg-accent-orange-hover"
              [routerLink]="caseStudyLink()"
            >
              <span
                >{{ lang.t().caseStudy.readCaseStudy
                }}<span class="sr-only">: {{ project().name }}</span></span
              >
              <ng-icon name="lucideArrowRight" size="14" aria-hidden="true" />
            </a>
          }
          @if (links().length) {
            <ul class="m-0 flex list-none flex-wrap gap-2 p-0" [attr.aria-label]="chrome().links">
              @for (link of links(); track link.href) {
                <li>
                  <a
                    class="inline-flex h-10 items-center gap-2 rounded-lg border border-border px-3 font-mono text-[0.78rem] text-foreground transition-colors duration-200 hover:border-accent-orange/50"
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
      </div>
    </article>
  `,
})
export class ProjectCardComponent {
  readonly lang = inject(LanguageService);
  readonly project = input.required<Project>();
  readonly index = input<number>(0);
  /** Spans the row, with the image beside the text on wide screens. */
  readonly featured = input<boolean>(false);

  protected readonly chrome = computed(() => CHROME[this.lang.lang()].projectCard);

  readonly caseStudyLink = computed(() => ["/", this.lang.lang(), "work", this.project().slug]);
  readonly transitionName = computed(() =>
    this.project().hasCaseStudy ? projectTransitionName(this.project().slug) : null,
  );

  readonly indexLabel = computed(() => {
    // Padding lives here now rather than baked into the copy, so the editable
    // string is just `case · {i}` and it still reads correctly past 9.
    const i = String(this.index() + 1).padStart(2, "0");
    return fmt(this.lang.t().projectCard.caseLabel, { i });
  });

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
