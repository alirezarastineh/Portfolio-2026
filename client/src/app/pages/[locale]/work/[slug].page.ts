import { DOCUMENT } from "@angular/common";
import { ChangeDetectionStrategy, Component, computed, inject } from "@angular/core";
import { toSignal } from "@angular/core/rxjs-interop";
import { ActivatedRoute, RouterLink, type ResolveFn } from "@angular/router";
import type { MetaTag, RouteMeta } from "@analogjs/router";
import { NgIcon, provideIcons } from "@ng-icons/core";
import { lucideArrowLeft, lucideArrowRight, lucideExternalLink } from "@ng-icons/lucide";
import { map } from "rxjs";

import { AskLauncherService } from "../../../ask/ask-launcher.service";
import type { BreadcrumbItem } from "../../../components/breadcrumb.component";
import { BreadcrumbComponent } from "../../../components/breadcrumb.component";
import { GalleryComponent } from "../../../components/gallery.component";
import { NotFoundComponent } from "../../../components/not-found.component";
import { PictureComponent } from "../../../components/picture.component";
import { ProseBodyComponent } from "../../../components/prose-body.component";
import { TocComponent, type TocItem } from "../../../components/toc.component";
import { DocStore } from "../../../content/doc.store";
import { switchTargets } from "../../../content/locale";
import { formatPeriod } from "../../../content/period";
import type { Project, ProjectDoc } from "../../../content/schema";
import { CHROME } from "../../../i18n/chrome";
import { fmt } from "../../../i18n/interpolate";
import { sentenceCase } from "../../../i18n/sentence-case";
import { brandGithub } from "../../../icons/brand-icons";
import {
  projectTitleTransitionName,
  projectTransitionName,
} from "../../../navigation/view-transitions";
import { applyHead } from "../../../seo/head";
import { injectMarkNotFound } from "../../../seo/http-status";
import {
  socialCard,
  docLanguageAlternates,
  pageMeta,
  pageUrl,
  siteOrigin,
} from "../../../seo/seo-meta";
import { caseStudyJsonLd } from "../../../seo/structured-data";
import { LanguageService } from "../../../services/language.service";

interface CaseStudy {
  project: Project;
  doc: ProjectDoc;
}

const SLUG = /^[a-z0-9-]{1,80}$/;

/**
 * The project and its case study, or null: an unknown slug, a project without
 * a case study, or one whose case study is not written in this language.
 * Every resolver below asks; the store fetches the doc once.
 */
async function caseStudy(slug: string | null): Promise<CaseStudy | null> {
  if (!slug || !SLUG.test(slug)) return null;
  const lang = inject(LanguageService);
  const store = inject(DocStore);
  const project = lang.content().projects.find((p) => p.slug === slug);
  if (!project?.hasCaseStudy) return null;

  const doc = await store.ensure(lang.lang(), "projects", slug);
  return doc?.kind === "project" ? { project, doc } : null;
}

const studyResolver: ResolveFn<CaseStudy | null> = (route) => caseStudy(route.paramMap.get("slug"));

const titleResolver: ResolveFn<string> = async (route) => {
  const name = inject(LanguageService).content().identity.name;
  const study = await caseStudy(route.paramMap.get("slug"));
  return study ? `${study.project.name} · ${name}` : `404 · ${name}`;
};

function describe(study: CaseStudy, fallback: string): string {
  return study.doc.seo.description || study.project.hook || study.project.descriptor || fallback;
}

const metaResolver: ResolveFn<MetaTag[]> = async (route) => {
  const lang = inject(LanguageService);
  const study = await caseStudy(route.paramMap.get("slug"));
  if (!study) return [{ name: "robots", content: "noindex" }];

  const content = lang.content();
  const origin = siteOrigin(content);
  return pageMeta(content, lang.lang(), {
    title: `${study.project.name} · ${content.identity.name}`,
    description: describe(study, content.seo.description),
    url: pageUrl(origin, lang.lang(), `/work/${study.project.slug}`),
    robots: "index, follow",
    image: socialCard(origin, lang.lang(), "work", study.project.slug),
    imageAlt: study.project.name,
  });
};

const headResolver: ResolveFn<true> = async (route): Promise<true> => {
  const lang = inject(LanguageService);
  const document = inject(DOCUMENT);
  const notFound = injectMarkNotFound();
  const study = await caseStudy(route.paramMap.get("slug"));
  if (!study) {
    notFound();
    return true;
  }

  const content = lang.content();
  const locale = lang.lang();
  const origin = siteOrigin(content);
  const path = `/${locale}/work/${study.project.slug}`;
  applyHead(document, {
    canonical: `${origin}${path}`,
    alternates: docLanguageAlternates(origin, study.doc.alternates),
    jsonLd: caseStudyJsonLd(content, locale, origin, study.project, study.doc),
  });
  // Written in one language only: the switch leads to the other one's projects.
  lang.pinAlternates(
    path,
    switchTargets(study.doc.alternates, (l) => `/${l}#projects`),
  );
  return true;
};

/** `/en/work/atlas`: a project's case study. */
export const routeMeta: RouteMeta = {
  title: titleResolver,
  meta: metaResolver,
  resolve: { study: studyResolver, head: headResolver },
};

interface Section {
  id: string;
  label: string;
  html: string;
}

/**
 * A case study: a spec-sheet header (name and hook, beside a card of facts,
 * stack and links), the metrics, the cover, then the narrative — numbered
 * headings, with the table of contents alongside — and an end block that
 * hands over to the assistant or the contact form. The cover and the `<h1>`
 * are what the home page's card morphs into.
 */
@Component({
  selector: "app-case-study-page",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    BreadcrumbComponent,
    GalleryComponent,
    NgIcon,
    NotFoundComponent,
    PictureComponent,
    ProseBodyComponent,
    RouterLink,
    TocComponent,
  ],
  viewProviders: [
    provideIcons({ brandGithub, lucideArrowLeft, lucideArrowRight, lucideExternalLink }),
  ],
  host: { class: "block" },
  template: `
    @if (study(); as s) {
      <main id="main" class="pb-24 pt-28 lg:pt-32">
        <!-- Fills as the page scrolls (styles/motion.css). -->
        <div class="reading-progress" aria-hidden="true"></div>
        <article class="container-site flex flex-col gap-12 lg:gap-16">
          <header class="grid gap-8 lg:grid-cols-12 lg:gap-x-(--col-gap)">
            <div class="flex flex-col gap-5 lg:col-span-7">
              <app-breadcrumb [items]="crumbs()" [locale]="lang.lang()" />
              @if (s.project.descriptor) {
                <p class="eyebrow m-0 mt-2 text-muted-foreground">{{ s.project.descriptor }}</p>
              }
              <h1
                class="m-0 w-fit text-balance text-h1 text-foreground hyphens-auto"
                [style.view-transition-name]="titleTransitionName()"
              >
                {{ s.project.name }}
              </h1>
              @if (s.project.hook) {
                <p class="m-0 max-w-[46ch] text-pretty text-lead text-muted-foreground">
                  {{ s.project.hook }}
                </p>
              }
            </div>

            @if (facts().length || s.project.stack.length || links().length) {
              <div
                class="surface-card flex flex-col gap-5 p-6 lg:col-span-5 lg:self-end xl:col-span-4 xl:col-start-9"
              >
                @if (facts().length || s.project.stack.length) {
                  <dl
                    class="m-0 grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-6 gap-y-3"
                  >
                    @for (fact of facts(); track fact.label) {
                      <dt class="eyebrow text-muted-foreground">{{ fact.label }}</dt>
                      <dd class="m-0 text-sm text-foreground">{{ fact.value }}</dd>
                    }
                    @if (s.project.stack.length) {
                      <dt class="eyebrow text-muted-foreground">
                        {{ lang.t().projectCard.techStackAriaLabel }}
                      </dt>
                      <dd class="m-0">
                        <ul class="m-0 flex list-none flex-wrap gap-1.5 p-0" role="list">
                          @for (tech of s.project.stack; track tech) {
                            <li class="chip">{{ tech }}</li>
                          }
                        </ul>
                      </dd>
                    }
                  </dl>
                }
                @if (links().length) {
                  <ul
                    class="m-0 flex list-none flex-wrap gap-2 border-t border-border p-0 pt-5"
                    role="list"
                  >
                    @for (link of links(); track link.href) {
                      <li>
                        <a
                          class="press inline-flex h-9 items-center gap-2 rounded-md border border-border px-3 font-mono text-meta text-foreground hover:border-border-strong"
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
          </header>

          @if (s.project.metrics.length) {
            <section>
              <h2 class="sr-only">{{ lang.t().caseStudy.metrics }}</h2>
              <dl
                class="m-0 grid grid-cols-2 gap-x-6 gap-y-8 sm:grid-cols-[repeat(auto-fit,minmax(11rem,1fr))]"
              >
                @for (metric of s.project.metrics; track $index) {
                  <div class="reveal flex flex-col gap-1.5 border-t-2 border-accent-orange pt-4">
                    <dt class="order-2 text-sm text-muted-foreground">{{ metric.label }}</dt>
                    <dd class="order-1 m-0 text-metric tabular-nums text-foreground">
                      {{ metric.value }}
                    </dd>
                    @if (metric.context) {
                      <dd class="order-3 m-0 font-mono text-meta text-muted-foreground">
                        {{ metric.context }}
                      </dd>
                    }
                  </div>
                }
              </dl>
            </section>
          }

          @if (s.project.cover) {
            <div
              class="aspect-video overflow-hidden rounded-2xl border border-border bg-muted"
              [style.view-transition-name]="transitionName()"
            >
              <!-- Bound, not static: the server would print static inputs
                   on <app-picture> as attributes too. -->
              <app-picture
                [image]="s.project.cover"
                [priority]="true"
                [sizes]="'(min-width: 1280px) 1184px, 100vw'"
                [imgClass]="'block size-full object-cover'"
              />
            </div>
          }

          <div class="grid gap-12 lg:grid-cols-12 lg:gap-x-(--col-gap)">
            @if (toc().length > 1) {
              <aside class="lg:col-span-3 lg:col-start-10 lg:row-start-1">
                <app-toc
                  class="lg:sticky lg:top-28"
                  [items]="toc()"
                  [label]="lang.t().caseStudy.toc"
                />
              </aside>
            }

            <!-- The narrative. Its top-level headings are numbered in CSS
                 (.case-flow in styles/prose.css), the body's included. -->
            <div class="case-flow flex min-w-0 flex-col gap-14 lg:col-span-8 lg:row-start-1">
              @for (section of sections(); track section.id) {
                <section class="flex flex-col gap-4">
                  <h2 class="case-h" [id]="section.id">{{ section.label }}</h2>
                  <!-- Sanitized on write by the API; Angular sanitizes again here. -->
                  <div class="prose-body" [innerHTML]="section.html"></div>
                </section>
              }

              @if (s.project.outcomes.length) {
                <section class="flex flex-col gap-4">
                  <h2 class="case-h" [id]="ids().outcomes">{{ labels().outcomes }}</h2>
                  <ul class="m-0 flex list-none flex-col gap-2 p-0" role="list">
                    @for (outcome of s.project.outcomes; track $index) {
                      <li class="flex items-baseline gap-3 leading-relaxed text-muted-foreground">
                        <span class="text-accent-orange" aria-hidden="true">▸</span>
                        <span>{{ outcome }}</span>
                      </li>
                    }
                  </ul>
                </section>
              }

              @if (s.doc.body) {
                <app-prose-body [html]="s.doc.body" [toc]="s.doc.toc" />
              }

              @if (s.doc.gallery.length) {
                <section class="flex flex-col gap-6">
                  <h2 class="case-h" [id]="ids().gallery">{{ lang.t().caseStudy.gallery }}</h2>
                  <app-gallery
                    [images]="s.doc.gallery"
                    [label]="lang.t().caseStudy.gallery"
                    [locale]="lang.lang()"
                  />
                </section>
              }
            </div>
          </div>

          @if (neighbours().previous || neighbours().next) {
            <nav
              class="grid gap-4 border-t border-border pt-10 sm:grid-cols-2"
              [attr.aria-label]="lang.t().caseStudy.allWork"
            >
              @if (neighbours().previous; as previous) {
                <a [class]="neighbourLink" [routerLink]="workLink(previous.slug)">
                  <span class="eyebrow flex items-center gap-2 text-muted-foreground">
                    <ng-icon name="lucideArrowLeft" size="14" aria-hidden="true" />
                    {{ lang.t().caseStudy.previous }}
                  </span>
                  <span class="text-lg text-foreground">{{ previous.name }}</span>
                </a>
              }
              @if (neighbours().next; as next) {
                <a
                  [class]="neighbourLink + ' sm:col-start-2 sm:items-end sm:text-right'"
                  [routerLink]="workLink(next.slug)"
                >
                  <span class="eyebrow flex items-center gap-2 text-muted-foreground">
                    {{ lang.t().caseStudy.next }}
                    <ng-icon name="lucideArrowRight" size="14" aria-hidden="true" />
                  </span>
                  <span class="text-lg text-foreground">{{ next.name }}</span>
                </a>
              }
            </nav>
          }

          <!-- The end, as terminal output: what to do next. The article's
               footer, as on a post: print leaves it out (styles.css). -->
          <footer
            class="reveal surface-card flex flex-col items-start gap-4 rounded-2xl p-6 sm:p-10"
          >
            <p class="m-0 font-mono text-meta text-muted-foreground" aria-hidden="true">
              <span class="text-accent-orange">&gt;</span> next
            </p>
            <h2 class="m-0 text-h3 text-foreground">{{ lang.t().caseStudy.ctaHeading }}</h2>
            <p class="m-0 max-w-2xl text-pretty text-muted-foreground">
              {{ lang.t().caseStudy.ctaBody }}
            </p>
            <div class="mt-2 flex flex-wrap gap-3">
              <a
                class="press inline-flex min-h-11 items-center gap-2 rounded-lg bg-accent-orange px-5 py-2 font-mono text-meta font-medium text-accent-orange-foreground hover:bg-accent-orange-hover"
                [routerLink]="['/', lang.lang()]"
                fragment="contact"
              >
                {{ lang.t().caseStudy.ctaButton }}
                <ng-icon name="lucideArrowRight" size="16" aria-hidden="true" />
              </a>
              <button
                type="button"
                class="press inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-border px-5 py-2 text-left font-mono text-meta text-foreground hover:border-border-strong"
                (click)="askAbout(s.project.name)"
              >
                <span class="text-accent-orange" aria-hidden="true">&gt;_</span>
                {{ askLabel() }}
              </button>
            </div>
          </footer>
        </article>
      </main>
    } @else {
      <app-not-found [locale]="lang.lang()" />
    }
  `,
})
export default class CaseStudyPageComponent {
  protected readonly lang = inject(LanguageService);
  private readonly launcher = inject(AskLauncherService);

  protected readonly study = toSignal(
    inject(ActivatedRoute).data.pipe(map((data) => (data["study"] as CaseStudy | null) ?? null)),
    { initialValue: null },
  );

  protected readonly neighbourLink =
    "reveal flex flex-col gap-2 rounded-xl border border-border p-6 transition-colors duration-200 hover:border-accent-orange/40";

  /** Shared with the home page's card, which morphs into these. */
  protected readonly transitionName = computed(() => {
    const s = this.study();
    return s ? projectTransitionName(s.project.slug) : null;
  });
  protected readonly titleTransitionName = computed(() => {
    const s = this.study();
    return s ? projectTitleTransitionName(s.project.slug) : null;
  });

  protected readonly crumbs = computed<BreadcrumbItem[]>(() => {
    const s = this.study();
    const t = this.lang.t();
    const l = this.lang.lang();
    return [
      { label: this.lang.content().identity.name, link: ["/", l] },
      { label: t.nav.work, link: ["/", l], fragment: "projects" },
      { label: s?.project.name ?? "" },
    ];
  });

  protected readonly facts = computed(() => {
    const s = this.study();
    if (!s) return [];
    const t = this.lang.t();
    const p = s.project;
    return [
      { label: t.caseStudy.role, value: p.role },
      {
        label: t.caseStudy.period,
        value: p.period ? formatPeriod(p.period, this.lang.lang(), t.experience.present) : "",
      },
      { label: t.caseStudy.category, value: p.category?.label ?? "" },
    ].filter((fact) => fact.value);
  });

  protected readonly links = computed(() => {
    const s = this.study();
    if (!s) return [];
    const c = this.lang.t().projectCard;
    return [
      { label: c.live, href: s.project.links.live, icon: "lucideExternalLink" },
      { label: c.repo, href: s.project.links.repo, icon: "brandGithub" },
    ].filter((link) => link.href);
  });

  /**
   * The fixed sections' names as headings. The CMS writes them in capitals
   * for the project card's labels (`PROBLEM`); here they read as `Problem`.
   */
  protected readonly labels = computed(() => {
    const c = this.lang.t().projectCard;
    const l = this.lang.lang();
    return {
      problem: sentenceCase(c.problem, l),
      arch: sentenceCase(c.arch, l),
      infra: sentenceCase(c.infra, l),
      outcomes: sentenceCase(c.outcomes, l),
    };
  });

  /**
   * Anchors for the fixed sections. The body's own headings got theirs from
   * their text, so a body heading called "Problem" would already hold
   * `problem`; the fixed section then yields.
   */
  protected readonly ids = computed(() => {
    const taken = new Set(this.study()?.doc.toc.map((entry) => entry.id));
    const id = (base: string) => (taken.has(base) ? `${base}-overview` : base);
    return {
      problem: id("problem"),
      architecture: id("architecture"),
      infrastructure: id("infrastructure"),
      outcomes: id("outcomes"),
      gallery: id("gallery"),
    };
  });

  protected readonly sections = computed<Section[]>(() => {
    const s = this.study();
    if (!s) return [];
    const labels = this.labels();
    const ids = this.ids();
    return [
      { id: ids.problem, label: labels.problem, html: s.project.problem },
      { id: ids.architecture, label: labels.arch, html: s.project.aiArchitecture },
      { id: ids.infrastructure, label: labels.infra, html: s.project.fullStackInfra },
    ].filter((section) => section.html.trim() !== "");
  });

  protected readonly toc = computed<TocItem[]>(() => {
    const s = this.study();
    if (!s) return [];
    const ids = this.ids();
    const t = this.lang.t();
    return [
      ...this.sections().map((section) => ({
        id: section.id,
        text: section.label,
        level: 2 as const,
      })),
      ...(s.project.outcomes.length
        ? [{ id: ids.outcomes, text: this.labels().outcomes, level: 2 as const }]
        : []),
      ...s.doc.toc,
      ...(s.doc.gallery.length
        ? [{ id: ids.gallery, text: t.caseStudy.gallery, level: 2 as const }]
        : []),
    ];
  });

  /** The case studies either side of this one, in the order the home page lists them. */
  protected readonly neighbours = computed(() => {
    const slug = this.study()?.project.slug;
    const studies = this.lang.content().projects.filter((p) => p.hasCaseStudy);
    const i = studies.findIndex((p) => p.slug === slug);
    return {
      previous: i > 0 ? studies[i - 1] : undefined,
      next: i >= 0 && i < studies.length - 1 ? studies[i + 1] : undefined,
    };
  });

  protected readonly askLabel = computed(() =>
    fmt(CHROME[this.lang.lang()].caseStudy.ask, { name: this.study()?.project.name ?? "" }),
  );

  protected workLink(slug: string): string[] {
    return ["/", this.lang.lang(), "work", slug];
  }

  /** Puts a question about this project to the assistant, in the sheet. */
  protected askAbout(name: string): void {
    this.launcher.ask(fmt(CHROME[this.lang.lang()].caseStudy.question, { name }), "case-study");
  }
}
