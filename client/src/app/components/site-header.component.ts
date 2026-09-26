import { DOCUMENT, isPlatformBrowser } from "@angular/common";
import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  PLATFORM_ID,
  signal,
  untracked,
  viewChild,
} from "@angular/core";
import { RouterLink } from "@angular/router";
import { NgIcon, provideIcons } from "@ng-icons/core";
import {
  lucideDownload,
  lucideMenu,
  lucideMoon,
  lucideSearch,
  lucideSun,
  lucideX,
} from "@ng-icons/lucide";

import { otherLocale } from "../content/locale";
import { CHROME } from "../i18n/chrome";
import { CommandPaletteService } from "../services/command-palette.service";
import { LanguageService } from "../services/language.service";
import { ThemeService } from "../services/theme.service";

/** The home sections, in page order; the header highlights the one in view. */
const SECTION_IDS = [
  "hero",
  "projects",
  "experience",
  "skills",
  "writing",
  "about",
  "contact",
] as const;
type SectionId = (typeof SECTION_IDS)[number];

/** A home section (`/en#projects`) or a page of its own (`/en/writing`). */
interface NavLink {
  label: string;
  key: SectionId;
  commands: string[];
  fragment?: SectionId;
}

/** Tailwind's `md`: the desktop navigation takes over from the menu. */
const DESKTOP = "(min-width: 768px)";

const iconButton =
  "inline-flex size-9 cursor-pointer items-center justify-center rounded-md border border-border text-muted-foreground transition-colors duration-200 ease-in-out hover:border-accent-orange/50 hover:text-foreground";

@Component({
  selector: "app-site-header",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgIcon, RouterLink],
  viewProviders: [
    provideIcons({ lucideDownload, lucideMenu, lucideMoon, lucideSearch, lucideSun, lucideX }),
  ],
  host: {
    class: "contents",
    "(document:keydown.escape)": "onEscape()",
    "(document:click)": "onDocumentClick($event)",
  },
  template: `
    <!-- First stop for keyboard users. A real link to this page's <main>, so
         it works before the app is interactive too. -->
    <a
      class="sr-only fixed left-4 top-3 z-60 rounded-md bg-accent-orange px-4 py-2 font-mono text-sm font-medium text-accent-orange-foreground focus:not-sr-only"
      [attr.href]="skipHref()"
      (click)="skipToContent($event)"
      >{{ labels().skip }}</a
    >

    <!-- Solid while the menu is open, so the page does not show through it. -->
    <header
      #bar
      class="fixed inset-x-0 top-0 z-40 border-b border-border backdrop-blur-md"
      [class]="open() ? 'bg-background' : 'bg-background/80'"
      (keydown)="trapFocus($event)"
    >
      <div class="container-site grid grid-cols-[auto_1fr_auto] items-center gap-4 py-3">
        <a
          class="inline-flex items-center gap-1.5 font-mono text-base font-semibold tracking-wide text-foreground"
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
              class="relative inline-flex items-center font-mono text-meta transition-colors duration-200 ease-in-out hover:text-foreground"
              [class.text-foreground]="isActive(link)"
              [class.text-muted-foreground]="!isActive(link)"
              [attr.aria-current]="isActive(link) ? 'true' : null"
              [routerLink]="link.commands"
              [fragment]="link.fragment"
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

        <!-- Pinned to the last column: on phones the navigation before it is hidden. -->
        <div class="col-start-3 flex items-center justify-self-end gap-2">
          <button
            type="button"
            [class]="searchClass"
            [attr.aria-label]="labels().search"
            aria-keyshortcuts="Control+K Meta+K"
            (click)="palette.show()"
          >
            <ng-icon name="lucideSearch" size="15" aria-hidden="true" />
            <kbd class="hidden font-mono text-meta md:inline" aria-hidden="true">⌘K</kbd>
          </button>
          <!-- A file, not a page: a plain link the router leaves alone. -->
          @if (resumeHref(); as href) {
            <a
              class="hidden h-9 items-center gap-1.5 rounded-md border border-border px-2.5 font-mono text-meta text-muted-foreground transition-colors duration-200 ease-in-out hover:border-accent-orange/50 hover:text-foreground md:inline-flex"
              [href]="href"
              download
            >
              <ng-icon name="lucideDownload" size="13" aria-hidden="true" />
              CV
            </a>
          }
          <!-- The server renders dark; the icon for the other theme is picked
               in CSS, so hydration never meets different markup. -->
          <button
            type="button"
            [class]="iconButton"
            [attr.aria-label]="theme.theme() === 'dark' ? labels().toLight : labels().toDark"
            (click)="theme.toggle()"
          >
            <span class="inline-flex in-data-[theme=light]:hidden" aria-hidden="true">
              <ng-icon name="lucideSun" size="16" />
            </span>
            <span class="hidden in-data-[theme=light]:inline-flex" aria-hidden="true">
              <ng-icon name="lucideMoon" size="16" />
            </span>
          </button>
          <!-- A real link to this page in the other language: crawlable, works
               without JavaScript, and remembered for the next visit to "/".
               Its name keeps the visible "DE" and adds the language's name. -->
          <a
            class="hidden h-9 items-center justify-center rounded-md border border-border px-2.5 font-mono text-meta text-muted-foreground transition-colors duration-200 ease-in-out hover:border-accent-orange/50 hover:text-foreground md:inline-flex"
            [routerLink]="lang.alternates()[other()]"
            [attr.hreflang]="other()"
            [attr.lang]="other()"
            (click)="lang.remember(other())"
          >
            {{ other().toUpperCase() }}<span class="sr-only"> – {{ labels().switchTo }}</span>
          </a>
          <button
            #toggle
            type="button"
            [class]="iconButton + ' md:hidden'"
            aria-controls="mobile-nav"
            [attr.aria-expanded]="open()"
            [attr.aria-label]="labels().menu"
            (click)="toggleMenu()"
          >
            <ng-icon [name]="open() ? 'lucideX' : 'lucideMenu'" size="18" aria-hidden="true" />
          </button>
        </div>
      </div>

      @if (open()) {
        <nav
          id="mobile-nav"
          class="flex max-h-[calc(100svh-4rem)] flex-col gap-1 overflow-y-auto border-t border-border px-(--gutter) pb-5 pt-2 md:hidden"
          [attr.aria-label]="labels().mobile"
        >
          @for (link of links(); track link.key) {
            <a
              class="flex items-center gap-2 px-1 py-2.5 font-mono text-base"
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
              class="flex items-center gap-2 px-1 py-2.5 font-mono text-base text-muted-foreground"
              [href]="href"
              download
              (click)="closeMenu()"
            >
              <ng-icon name="lucideDownload" size="16" aria-hidden="true" />
              {{ lang.t().hero.downloadCv }}
            </a>
          }
          <a
            class="mt-1 flex cursor-pointer items-center gap-2 rounded-md border border-border px-3 py-2 font-mono text-sm text-muted-foreground transition-colors duration-200 ease-in-out hover:border-accent-orange/50 hover:text-foreground"
            [routerLink]="lang.alternates()[other()]"
            [attr.hreflang]="other()"
            [attr.lang]="other()"
            (click)="lang.remember(other()); closeMenu()"
          >
            {{ other().toUpperCase() }} – {{ labels().switchTo }}
          </a>
        </nav>
      }
    </header>
  `,
})
export class SiteHeaderComponent {
  readonly lang = inject(LanguageService);
  readonly theme = inject(ThemeService);
  readonly palette = inject(CommandPaletteService);
  private readonly doc = inject(DOCUMENT);

  protected readonly iconButton = iconButton;
  protected readonly searchClass = `${iconButton} md:w-auto md:gap-1.5 md:px-2.5`;

  private readonly bar = viewChild.required<ElementRef<HTMLElement>>("bar");
  private readonly toggleButton = viewChild.required<ElementRef<HTMLElement>>("toggle");

  readonly initials = computed(() =>
    this.lang
      .content()
      .identity.name.split(" ")
      .map((p) => p[0])
      .join("")
      .toUpperCase(),
  );

  /** Home sections that exist in this language's content. */
  private readonly sections = computed<SectionId[]>(() => {
    const content = this.lang.content();
    return SECTION_IDS.filter(
      (id) =>
        (id !== "experience" || content.experiences.length > 0) &&
        (id !== "writing" || content.posts.length > 0),
    );
  });

  /** Writing links to its own page; on home it lights up while its section is in view. */
  readonly links = computed<NavLink[]>(() => {
    const n = this.lang.t().nav;
    const labels: Record<Exclude<SectionId, "hero">, string> = {
      projects: n.projects,
      experience: n.experience,
      skills: n.skills,
      writing: n.writing,
      about: n.about,
      contact: n.contact,
    };
    const home = this.home();
    return this.sections()
      .filter((id) => id !== "hero")
      .map((id) =>
        id === "writing"
          ? { label: labels[id], key: id, commands: [...home, "writing"] }
          : { label: labels[id], key: id, commands: home, fragment: id },
      );
  });

  readonly home = computed(() => ["/", this.lang.lang()]);
  readonly other = computed(() => otherLocale(this.lang.lang()));
  readonly labels = computed(() => CHROME[this.lang.lang()].header);
  /** `/en/resume.pdf`, which redirects to this language's CV; null when there is none. */
  readonly resumeHref = computed(() =>
    this.lang.content().identity.resume ? `/${this.lang.lang()}/resume.pdf` : null,
  );
  /** This page's `<main>`, as a real in-page link. */
  protected readonly skipHref = computed(() => {
    const page = this.lang.page();
    return `/${this.lang.lang()}${page === "/" ? "" : page}#main`;
  });

  readonly open = signal(false);
  readonly active = signal<SectionId>("hero");

  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  private observer?: IntersectionObserver;
  private mutationObserver?: MutationObserver;
  private readonly visible = new Set<SectionId>();
  private readonly observed = new Set<SectionId>();
  private readonly cleanups: (() => void)[] = [];
  private rendered = false;

  constructor() {
    afterNextRender(() => {
      this.rendered = true;
      this.watchSections();
      this.closeOnDesktop();
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

  /** Moves focus into the page's <main>, rather than only scrolling to it. */
  skipToContent(event: Event): void {
    const main = this.doc.getElementById("main");
    if (!main) return;
    event.preventDefault();
    if (!main.hasAttribute("tabindex")) main.setAttribute("tabindex", "-1");
    main.focus();
  }

  onEscape(): void {
    if (!this.open()) return;
    this.closeMenu();
    this.toggleButton().nativeElement.focus();
  }

  onDocumentClick(event: MouseEvent): void {
    if (this.open() && !this.bar().nativeElement.contains(event.target as Node)) this.closeMenu();
  }

  /** While the menu is open, Tab cycles through the header rather than the page behind it. */
  trapFocus(event: KeyboardEvent): void {
    if (event.key !== "Tab" || !this.open()) return;
    const focusable = [
      ...this.bar().nativeElement.querySelectorAll<HTMLElement>("a[href], button:not([disabled])"),
    ].filter((el) => el.offsetParent !== null);
    const first = focusable[0];
    const last = focusable.at(-1);
    if (!first || !last) return;
    const current = this.doc.activeElement;
    if (event.shiftKey && current === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && current === last) {
      event.preventDefault();
      first.focus();
    }
  }

  /** Widening the window to the desktop layout closes the menu it no longer shows. */
  private closeOnDesktop(): void {
    const query = globalThis.matchMedia?.(DESKTOP);
    if (!query) return;
    const close = (e: MediaQueryListEvent) => {
      if (e.matches) this.closeMenu();
    };
    query.addEventListener("change", close);
    this.cleanups.push(() => query.removeEventListener("change", close));
  }

  private watchSections(): void {
    this.unwatchSections();
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
      this.mutationObserver.observe(this.doc.body, { childList: true, subtree: true });
    }
  }

  private unwatchSections(): void {
    this.observer?.disconnect();
    this.observer = undefined;
    this.mutationObserver?.disconnect();
    this.mutationObserver = undefined;
  }

  private unwatch(): void {
    this.unwatchSections();
    for (const cleanup of this.cleanups) cleanup();
  }

  private observePending(ids: readonly SectionId[]): void {
    if (!this.observer) return;
    for (const id of ids) {
      if (this.observed.has(id)) continue;
      const el = this.doc.getElementById(id);
      if (el) {
        this.observer.observe(el);
        this.observed.add(id);
      }
    }
  }
}
