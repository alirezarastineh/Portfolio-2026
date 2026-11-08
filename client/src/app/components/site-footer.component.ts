import { ChangeDetectionStrategy, Component, computed, inject, VERSION } from "@angular/core";
import { RouterLink } from "@angular/router";

import { isWebLink } from "../content/social";
import { CHROME } from "../i18n/chrome";
import { fmt } from "../i18n/interpolate";
import { LanguageService } from "../services/language.service";

/** The public repository; the footer's build id links to its commit there. */
const REPO = "https://github.com/alirezarastineh/Portfolio-2026";

/** Case studies and posts a footer column lists, at most. */
const FOOTER_ITEMS = 4;

interface FooterLink {
  label: string;
  /** A route (`/en/work/atlas`), or with `href` set a plain link (a file, another site). */
  route?: string[];
  fragment?: string;
  href?: string;
}

interface FooterColumn {
  label: string;
  links: FooterLink[];
}

/** 44px tall on touch, so the rows themselves are the gap there. */
const linkClass =
  "inline-flex items-center text-muted-foreground transition-colors duration-(--dur-2) [overflow-wrap:anywhere] hover:text-foreground pointer-coarse:min-h-11";

/**
 * Every page's end: the name once more, as a closing statement, the site in
 * columns (case studies and Check the fit, writing, the legal pages every site
 * run from Germany must link from every page, and profiles elsewhere), then the
 * colophon and the build it was made from. Text links only: every page's HTML
 * carries the footer.
 */
@Component({
  selector: "app-site-footer",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  host: {
    class: "block",
  },
  template: `
    <footer class="mt-24 border-t border-border">
      <p class="container-site m-0 pb-14 pt-16 text-display" translate="no">
        {{ name() }}<span class="text-signal" aria-hidden="true">.</span>
      </p>
      <div
        class="container-site grid grid-cols-2 gap-x-(--col-gap) gap-y-10 pb-12 sm:grid-cols-4 lg:grid-cols-12"
      >
        @for (column of columns(); track column.label) {
          <nav class="flex flex-col gap-3 lg:col-span-3" [attr.aria-label]="column.label">
            <p class="m-0 text-small font-semibold" aria-hidden="true">{{ column.label }}</p>
            <ul
              class="m-0 flex list-none flex-col items-start gap-2 p-0 text-small pointer-coarse:gap-0"
              role="list"
            >
              @for (link of column.links; track link.label) {
                <li>
                  @if (link.href) {
                    <a
                      [class]="linkClass"
                      [href]="link.href"
                      [attr.target]="isWeb(link.href) ? '_blank' : null"
                      [attr.rel]="isWeb(link.href) ? 'noreferrer noopener' : null"
                      >{{ link.label }}</a
                    >
                  } @else {
                    <a [class]="linkClass" [routerLink]="link.route" [fragment]="link.fragment">{{
                      link.label
                    }}</a>
                  }
                </li>
              }
            </ul>
          </nav>
        }
      </div>
      <!-- Clear of the ask button, fixed at the bottom right. -->
      <div
        class="container-site flex flex-wrap justify-between gap-x-6 gap-y-2 pb-20 text-meta text-muted-foreground"
      >
        <p class="m-0">
          © {{ year() }} <span translate="no">{{ name() }}</span>
        </p>
        <p class="m-0">
          {{ colophon() }}
          @if (build(); as build) {
            @if (build.href) {
              <a class="link-underline" [href]="build.href">{{ chrome().build }} {{ build.id }}</a>
            } @else {
              {{ chrome().build }} {{ build.id }}
            }
          }
        </p>
      </div>
    </footer>
  `,
})
export class SiteFooterComponent {
  readonly lang = inject(LanguageService);
  protected readonly linkClass = linkClass;
  protected readonly chrome = computed(() => CHROME[this.lang.lang()].footer);

  readonly name = computed(() => this.lang.content().identity.name);
  readonly year = computed(() => new Date().getFullYear());
  protected readonly colophon = computed(() =>
    fmt(this.chrome().colophon, { angular: VERSION.major }),
  );

  /** The commit this build was made from, linked when it is a real SHA. */
  readonly build = computed(() => {
    const raw = import.meta.env.VITE_GIT_SHA;
    if (!raw || raw.length < 4) return null;
    const id = raw.length > 12 ? raw.slice(0, 12) : raw;
    return { id, href: /^[0-9a-f]{7,40}$/i.test(raw) ? `${REPO}/commit/${raw}` : null };
  });

  protected readonly columns = computed<FooterColumn[]>(() => {
    const { projects, posts, socials } = this.lang.content();
    const t = this.lang.t();
    const home = ["/", this.lang.lang()];

    const work: FooterLink[] = [
      ...projects
        .filter((p) => p.hasCaseStudy)
        .slice(0, FOOTER_ITEMS)
        .map((p) => ({ label: p.name, route: [...home, "work", p.slug] })),
      { label: t.caseStudy.allWork, route: home, fragment: "projects" },
      // The match page answers even with its switch off, and then points to contact.
      { label: this.chrome().match, route: [...home, "match"] },
    ];
    const writing: FooterLink[] = [
      ...posts
        .slice(0, FOOTER_ITEMS - 1)
        .map((p) => ({ label: p.title, route: [...home, "writing", p.slug] })),
      { label: t.writing.allPosts, route: [...home, "writing"] },
      { label: t.writing.rss, href: `/${this.lang.lang()}/rss.xml` },
    ];
    const legal: FooterLink[] = [
      { label: t.legal.imprint, route: [...home, "legal", "imprint"] },
      { label: t.legal.privacy, route: [...home, "legal", "privacy"] },
    ];
    const elsewhere = socials.map((s) => ({ label: s.label, href: s.href }));

    return [
      { label: t.nav.work, links: work },
      ...(posts.length ? [{ label: t.nav.writing, links: writing }] : []),
      // Impressum and Datenschutz: reachable from every page.
      { label: t.legal.nav, links: legal },
      ...(elsewhere.length ? [{ label: this.chrome().elsewhere, links: elsewhere }] : []),
    ];
  });

  isWeb(href: string): boolean {
    return isWebLink(href);
  }
}
