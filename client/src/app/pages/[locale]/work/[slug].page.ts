import { DOCUMENT } from "@angular/common";
import { ChangeDetectionStrategy, Component, computed, inject } from "@angular/core";
import { toSignal } from "@angular/core/rxjs-interop";
import { ActivatedRoute, RouterLink, type ResolveFn } from "@angular/router";
import type { MetaTag, RouteMeta } from "@analogjs/router";
import { NgIcon, provideIcons } from "@ng-icons/core";
import { lucideArrowLeft, lucideArrowRight, lucideExternalLink } from "@ng-icons/lucide";
import { map } from "rxjs";

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
import { brandGithub } from "../../../icons/brand-icons";
import { projectTransitionName } from "../../../navigation/view-transitions";
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
      <main id="main" class="px-6 pb-24 pt-28 sm:px-8 lg:px-12 lg:pt-32">
        <article class="mx-auto flex max-w-6xl flex-col gap-12">
          <header class="flex flex-col gap-6">
            <app-breadcrumb [items]="crumbs()" [locale]="lang.lang()" />

            <div class="flex flex-col gap-4">
              @if (s.project.descriptor) {
                <p class="eyebrow m-0 text-muted-foreground">
                  {{ s.project.descriptor }}
                </p>
              }
              <h1 class="m-0 text-balance text-h1 text-foreground hyphens-auto">
                {{ s.project.name }}
              </h1>
              @if (s.project.hook) {
                <p class="m-0 max-w-3xl text-pretty text-lg leading-relaxed text-muted-foreground">
                  {{ s.project.hook }}
                </p>
              }
            </div>

            @if (facts().length) {
              <!-- A fixed grid on phones: a flowing row re-wrapped when the web
                   fonts arrived and pushed the page down (layout shift). -->
              <dl class="m-0 grid grid-cols-2 gap-x-6 gap-y-4 sm:flex sm:flex-wrap sm:gap-x-10">
                @for (fact of facts(); track fact.label) {
                  <div class="flex flex-col gap-1">
                    <dt class="eyebrow text-muted-foreground">{{ fact.label }}</dt>
                    <dd class="m-0 text-sm text-foreground">{{ fact.value }}</dd>
                  </div>
                }
              </dl>
            }

            @if (s.project.stack.length) {
              <ul
                class="m-0 flex list-none flex-wrap gap-2 p-0"
                role="list"
                [attr.aria-label]="lang.t().projectCard.techStackAriaLabel"
              >
                @for (tech of s.project.stack; track tech) {
                  <li class="chip">{{ tech }}</li>
                }
              </ul>
            }

            @if (links().length) {
              <ul class="m-0 flex list-none flex-wrap gap-2 p-0" role="list">
                @for (link of links(); track link.href) {
                  <li>
                    <a
                      class="inline-flex h-9 items-center gap-2 rounded-lg border border-border px-3 font-mono text-meta text-foreground transition-colors duration-200 hover:border-accent-orange/50"
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
          </header>

          @if (s.project.metrics.length) {
            <section class="rounded-2xl border border-border bg-card/40 px-6 py-8 sm:px-10">
              <h2 class="sr-only">{{ lang.t().caseStudy.metrics }}</h2>
              <dl class="m-0 grid grid-cols-2 gap-x-6 gap-y-8 lg:grid-cols-4">
                @for (metric of s.project.metrics; track $index) {
                  <div class="flex flex-col gap-1">
                    <dt class="order-2 text-sm leading-snug text-muted-foreground">
                      {{ metric.label }}
                    </dt>
                    <dd
                      class="order-1 m-0 text-3xl font-semibold tracking-tight text-accent-orange sm:text-4xl"
                    >
                      {{ metric.value }}
                    </dd>
                    @if (metric.context) {
                      <dd class="order-3 m-0 text-xs leading-snug text-muted-foreground">
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
              <app-picture
                [image]="s.project.cover"
                [priority]="true"
                sizes="(min-width: 1200px) 1152px, 100vw"
                imgClass="block size-full object-cover"
              />
            </div>
          }

          <div class="grid gap-12 lg:grid-cols-[minmax(0,1fr)_15rem]">
            @if (toc().length > 1) {
              <aside class="lg:col-start-2 lg:row-start-1">
                <app-toc
                  class="lg:sticky lg:top-28"
                  [items]="toc()"
                  [label]="lang.t().caseStudy.toc"
                />
              </aside>
            }

            <div class="flex min-w-0 flex-col gap-14 lg:col-start-1 lg:row-start-1">
              @for (section of sections(); track section.id) {
                <section class="flex flex-col gap-4">
                  <h2 [id]="section.id" [class]="sectionHeading">{{ section.label }}</h2>
                  <!-- Sanitized on write by the API; Angular sanitizes again here. -->
                  <div class="prose-body" [innerHTML]="section.html"></div>
                </section>
              }

              @if (s.project.outcomes.length) {
                <section class="flex flex-col gap-4">
                  <h2 [id]="ids().outcomes" [class]="sectionHeading">
                    {{ lang.t().projectCard.outcomes }}
                  </h2>
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
                  <h2 [id]="ids().gallery" [class]="sectionHeading">
                    {{ lang.t().caseStudy.gallery }}
                  </h2>
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

          <section
            class="flex flex-col items-start gap-4 rounded-2xl border border-border bg-card/40 px-6 py-10 sm:px-10"
          >
            <h2 class="m-0 text-2xl font-semibold tracking-tight text-foreground">
              {{ lang.t().caseStudy.ctaHeading }}
            </h2>
            <p class="m-0 max-w-2xl leading-relaxed text-muted-foreground">
              {{ lang.t().caseStudy.ctaBody }}
            </p>
            <a
              class="mt-2 inline-flex h-11 items-center gap-2 rounded-lg bg-accent-orange px-6 font-mono text-sm font-medium text-accent-orange-foreground transition-colors duration-200 hover:bg-accent-orange-hover"
              [routerLink]="['/', lang.lang()]"
              fragment="contact"
            >
              {{ lang.t().caseStudy.ctaButton }}
              <ng-icon name="lucideArrowRight" size="16" aria-hidden="true" />
            </a>
          </section>
        </article>
      </main>
    } @else {
      <app-not-found [locale]="lang.lang()" />
    }
  `,
})
export default class CaseStudyPageComponent {
  protected readonly lang = inject(LanguageService);

  protected readonly study = toSignal(
    inject(ActivatedRoute).data.pipe(map((data) => (data["study"] as CaseStudy | null) ?? null)),
    { initialValue: null },
  );

  protected readonly sectionHeading =
    "m-0 font-mono text-sm uppercase tracking-label text-accent-orange";
  protected readonly neighbourLink =
    "flex flex-col gap-2 rounded-xl border border-border p-6 transition-colors duration-200 hover:border-accent-orange/40";

  protected readonly transitionName = computed(() => {
    const s = this.study();
    return s ? projectTransitionName(s.project.slug) : null;
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
    const c = this.lang.t().projectCard;
    const ids = this.ids();
    return [
      { id: ids.problem, label: c.problem, html: s.project.problem },
      { id: ids.architecture, label: c.arch, html: s.project.aiArchitecture },
      { id: ids.infrastructure, label: c.infra, html: s.project.fullStackInfra },
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
        ? [{ id: ids.outcomes, text: t.projectCard.outcomes, level: 2 as const }]
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

  protected workLink(slug: string): string[] {
    return ["/", this.lang.lang(), "work", slug];
  }
}
