import { isPlatformBrowser } from "@angular/common";
import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  PLATFORM_ID,
  signal,
  untracked,
} from "@angular/core";
import { RouterLink } from "@angular/router";
import { NgIcon, provideIcons } from "@ng-icons/core";
import { lucideDownload, lucideMenu, lucideX } from "@ng-icons/lucide";

import { otherLocale } from "../content/locale";
import { LanguageService } from "../services/language.service";

const SECTION_IDS = ["hero", "skills", "projects", "experience", "about", "contact"] as const;
type SectionId = (typeof SECTION_IDS)[number];

/** A home section (`/en#projects`) or a page of its own (`/en/writing`). */
interface NavLink {
  label: string;
  key: SectionId | "writing";
  commands: string[];
  fragment?: SectionId;
}

const LABELS = {
  en: {
    home: "Home",
    primary: "Primary",
    mobile: "Mobile",
    menu: "Toggle navigation",
    switchTo: "Deutsch",
  },
  de: {
    home: "Startseite",
    primary: "Hauptnavigation",
    mobile: "Mobil",
    menu: "Navigation umschalten",
    switchTo: "English",
  },
} as const;

@Component({
  selector: "app-site-header",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgIcon, RouterLink],
  viewProviders: [provideIcons({ lucideDownload, lucideMenu, lucideX })],
  host: {
    class: "contents",
  },
  template: `
    <header
      class="fixed inset-x-0 top-0 z-40 border-b border-border bg-[oklch(0.235_0_0/78%)] backdrop-blur-md backdrop-saturate-140"
    >
      <div
        class="mx-auto grid max-w-7xl grid-cols-[auto_1fr_auto_auto] items-center gap-4 px-6 py-3.5"
      >
        <a
          class="inline-flex items-center gap-[0.4rem] font-mono text-[0.95rem] font-semibold tracking-[0.04em] text-foreground"
          [routerLink]="home()"
          fragment="hero"
          [attr.aria-label]="labels().home"
          (click)="closeMenu()"
        >
          <span aria-hidden="true">{{ initials() }}</span>
          <span class="size-1.5 rounded-full bg-accent-orange" aria-hidden="true"></span>
        </a>
        <nav
          class="hidden justify-center gap-5 md:inline-flex lg:gap-7"
          [attr.aria-label]="labels().primary"
        >
          @for (link of links(); track link.key) {
            <a
              class="relative inline-flex items-center font-mono text-[0.8rem] transition-colors duration-200 ease-in-out hover:text-foreground"
              [class.text-foreground]="isActive(link)"
              [class.text-muted-foreground]="!isActive(link)"
              [attr.aria-current]="isActive(link) ? 'true' : null"
              [routerLink]="link.commands"
              [fragment]="link.fragment"
              (click)="closeMenu()"
            >
              @if (isActive(link)) {
                <span
                  class="mr-1.5 inline-block size-1 rounded-full bg-accent-orange"
                  aria-hidden="true"
                ></span>
              }
              <span>{{ link.label }}</span>
            </a>
          }
        </nav>
        <div class="hidden items-center gap-2 md:inline-flex">
          <!-- A file, not a page: a plain link the router leaves alone. -->
          @if (resumeHref(); as href) {
            <a
              class="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 font-mono text-[0.8rem] text-muted-foreground transition-colors duration-200 ease-in-out hover:border-accent-orange/50 hover:text-foreground"
              [href]="href"
              download
            >
              <ng-icon name="lucideDownload" size="13" aria-hidden="true" />
              CV
            </a>
          }
          <!-- A real link to this page in the other language: crawlable, works
               without JavaScript, and remembered for the next visit to "/". -->
          <a
            class="inline-flex cursor-pointer items-center justify-center rounded-md border border-border px-2.5 py-1 font-mono text-[0.8rem] text-muted-foreground transition-colors duration-200 ease-in-out hover:border-accent-orange/50 hover:text-foreground"
            [routerLink]="lang.alternates()[other()]"
            [attr.hreflang]="other()"
            [attr.lang]="other()"
            [attr.aria-label]="labels().switchTo"
            (click)="lang.remember(other())"
          >
            {{ other().toUpperCase() }}
          </a>
        </div>
        <button
          type="button"
          class="inline-flex size-10 cursor-pointer items-center justify-center rounded-lg border border-border bg-transparent text-foreground md:hidden"
          [attr.aria-expanded]="open()"
          [attr.aria-label]="labels().menu"
          (click)="toggleMenu()"
        >
          <ng-icon [name]="open() ? 'lucideX' : 'lucideMenu'" size="20" aria-hidden="true" />
        </button>
      </div>
      @if (open()) {
        <nav
          class="flex flex-col gap-1 border-t border-border px-6 pb-4 pt-2 md:hidden"
          [attr.aria-label]="labels().mobile"
        >
          @for (link of links(); track link.key) {
            <a
              class="flex items-center gap-2 px-1 py-2.5 font-mono text-[0.95rem]"
              [class.text-foreground]="isActive(link)"
              [class.text-muted-foreground]="!isActive(link)"
              [attr.aria-current]="isActive(link) ? 'true' : null"
              [routerLink]="link.commands"
              [fragment]="link.fragment"
              (click)="closeMenu()"
            >
              @if (isActive(link)) {
                <span
                  class="inline-block size-1 rounded-full bg-accent-orange"
                  aria-hidden="true"
                ></span>
              }
              <span>{{ link.label }}</span>
            </a>
          }
          @if (resumeHref(); as href) {
            <a
              class="flex items-center gap-2 px-1 py-2.5 font-mono text-[0.95rem] text-muted-foreground"
              [href]="href"
              download
              (click)="closeMenu()"
            >
              <ng-icon name="lucideDownload" size="16" aria-hidden="true" />
              {{ lang.t().hero.downloadCv }}
            </a>
          }
          <a
            class="mt-1 flex cursor-pointer items-center gap-2 rounded-md border border-border px-3 py-2 font-mono text-[0.85rem] text-muted-foreground transition-colors duration-200 ease-in-out hover:border-accent-orange/50 hover:text-foreground"
            [routerLink]="lang.alternates()[other()]"
            [attr.hreflang]="other()"
            [attr.lang]="other()"
            (click)="lang.remember(other()); closeMenu()"
          >
            {{ other().toUpperCase() }} — {{ labels().switchTo }}
          </a>
        </nav>
      }
    </header>
  `,
})
export class SiteHeaderComponent {
  readonly lang = inject(LanguageService);

  readonly initials = computed(() =>
    this.lang
      .content()
      .identity.name.split(" ")
      .map((p) => p[0])
      .join("")
      .toUpperCase(),
  );

  /** Home sections that exist in this language's content; Experience only with entries. */
  private readonly sections = computed<SectionId[]>(() =>
    SECTION_IDS.filter((id) => id !== "experience" || this.lang.content().experiences.length > 0),
  );

  readonly links = computed<NavLink[]>(() => {
    const n = this.lang.t().nav;
    const labels: Record<Exclude<SectionId, "hero">, string> = {
      skills: n.skills,
      projects: n.projects,
      experience: n.experience,
      about: n.about,
      contact: n.contact,
    };
    const home = this.home();
    const links: NavLink[] = this.sections()
      .filter((id) => id !== "hero")
      .map((id) => ({
        label: labels[id as keyof typeof labels],
        key: id,
        commands: home,
        fragment: id,
      }));
    if (this.lang.content().posts.length > 0) {
      links.push({ label: n.writing, key: "writing", commands: [...home, "writing"] });
    }
    return links;
  });

  readonly home = computed(() => ["/", this.lang.lang()]);
  readonly other = computed(() => otherLocale(this.lang.lang()));
  readonly labels = computed(() => LABELS[this.lang.lang()]);
  /** `/en/resume.pdf`, which redirects to this language's CV; null when there is none. */
  readonly resumeHref = computed(() =>
    this.lang.content().identity.resume ? `/${this.lang.lang()}/resume.pdf` : null,
  );

  readonly open = signal(false);
  readonly active = signal<SectionId>("hero");

  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  private observer?: IntersectionObserver;
  private mutationObserver?: MutationObserver;
  private readonly visible = new Set<SectionId>();
  private readonly observed = new Set<SectionId>();
  private rendered = false;

  constructor() {
    afterNextRender(() => {
      this.rendered = true;
      this.watchSections();
    });

    // The sections are recreated whenever the home page is entered again, so
    // observing starts over on every page change.
    effect(() => {
      this.lang.page();
      if (this.rendered) untracked(() => this.watchSections());
    });

    inject(DestroyRef).onDestroy(() => this.unwatch());
  }

  /**
   * On home, the section in view. Elsewhere, the part of the site a page
   * belongs to: a case study to Projects, a post to Writing.
   */
  isActive(link: NavLink): boolean {
    const page = this.lang.page();
    if (page === "/") return this.active() === link.key;
    if (link.key === "writing") return page === "/writing" || page.startsWith("/writing/");
    return link.key === "projects" && page.startsWith("/work/");
  }

  toggleMenu(): void {
    this.open.update((v) => !v);
  }

  closeMenu(): void {
    this.open.set(false);
  }

  private watchSections(): void {
    this.unwatch();
    this.visible.clear();
    this.observed.clear();
    this.active.set("hero");
    // Sections exist on the home page only.
    if (!this.isBrowser || this.lang.page() !== "/") return;

    const expected = this.sections();
    this.observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const id = entry.target.id as SectionId;
          if (entry.isIntersecting) {
            this.visible.add(id);
          } else {
            this.visible.delete(id);
          }
        }
        const next = expected.find((id) => this.visible.has(id));
        if (next) this.active.set(next);
      },
      { rootMargin: "-30% 0px -55% 0px", threshold: 0 },
    );

    this.observePending(expected);
    if (this.observed.size < expected.length) {
      // Sections can render after the header (deferred or late content).
      this.mutationObserver = new MutationObserver(() => {
        this.observePending(expected);
        if (this.observed.size >= expected.length) {
          this.mutationObserver?.disconnect();
          this.mutationObserver = undefined;
        }
      });
      this.mutationObserver.observe(document.body, { childList: true, subtree: true });
    }
  }

  private unwatch(): void {
    this.observer?.disconnect();
    this.observer = undefined;
    this.mutationObserver?.disconnect();
    this.mutationObserver = undefined;
  }

  private observePending(ids: readonly SectionId[]): void {
    if (!this.observer) return;
    for (const id of ids) {
      if (this.observed.has(id)) continue;
      const el = document.getElementById(id);
      if (el) {
        this.observer.observe(el);
        this.observed.add(id);
      }
    }
  }
}
