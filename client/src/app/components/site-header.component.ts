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

import { homeSections, type HomeSection as SectionId } from "../content/home-sections";
import { LOCALES, otherLocale } from "../content/locale";
import { CHROME } from "../i18n/chrome";
import { CommandPaletteService } from "../services/command-palette.service";
import { LanguageService } from "../services/language.service";
import { ThemeService } from "../services/theme.service";

/** A home section (`/en#projects`) or a page of its own (`/en/writing`). */
interface NavLink {
  label: string;
  key: SectionId;
  commands: string[];
  fragment?: SectionId;
}

/**
 * Tailwind's `lg`: the desktop navigation takes over from the menu. Below it
 * six links, the CTA and the controls do not fit (German especially).
 */
const DESKTOP = "(min-width: 1024px)";

const iconButton =
  "press inline-flex size-9 cursor-pointer items-center justify-center rounded-md border border-border text-muted-foreground hover:border-accent-orange/50 hover:text-foreground";

/** One option of the mobile menu's language and theme switches (`press` on those that act). */
const segment =
  "inline-flex h-9 min-w-11 cursor-pointer items-center justify-center gap-1.5 rounded-md px-3";

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

    <!-- See-through over the top of the page, a raised surface once scrolled
         (styles/motion.css; without scroll timelines it stays as styled here).
         Solid while the menu is open, so the page does not show through it. -->
    <header
      #bar
      class="site-header fixed inset-x-0 top-0 z-40 border-b border-border backdrop-blur-md"
      [class]="open() ? 'bg-background' : 'bg-background/80'"
      [attr.data-open]="open() ? '' : null"
      (keydown)="trapFocus($event)"
    >
      <div
        class="site-header-row container-site grid h-16 grid-cols-[auto_1fr_auto] items-center gap-4"
      >
        <!-- The favicon's mark. Its name starts with the visible word. -->
        <a
          class="inline-flex h-9 items-center font-mono text-sm font-semibold text-foreground"
          [routerLink]="home()"
          fragment="hero"
          (click)="closeMenu()"
        >
          <span class="text-accent-orange" aria-hidden="true">&gt;</span
          ><span class="wordmark-caret" aria-hidden="true">_</span>
          <span class="ml-2">{{ wordmark() }}</span
          ><span class="sr-only"> – {{ labels().home }}</span>
        </a>

        <nav
          class="hidden justify-center gap-5 lg:inline-flex xl:gap-7"
          [attr.aria-label]="labels().primary"
        >
          @for (link of links(); track link.key) {
            <a
              class="nav-link relative inline-flex h-9 items-center font-mono text-meta transition-colors duration-(--dur-2) hover:text-foreground"
              [class.text-foreground]="isActive(link)"
              [class.text-muted-foreground]="!isActive(link)"
              [attr.aria-current]="isActive(link) ? 'true' : null"
              [routerLink]="link.commands"
              [fragment]="link.fragment"
            >
              {{ link.label }}
            </a>
          }
        </nav>

        <!-- Pinned to the last column: below lg the navigation before it is hidden. -->
        <div class="col-start-3 flex items-center justify-self-end gap-2">
          <button
            type="button"
            [class]="searchClass"
            [attr.aria-label]="labels().search"
            aria-keyshortcuts="Control+K Meta+K"
            (click)="palette.show()"
          >
            <ng-icon name="lucideSearch" size="15" aria-hidden="true" />
            <kbd class="hidden font-mono text-meta lg:inline" aria-hidden="true">⌘K</kbd>
          </button>
          <!-- The one call to action that is always in view. The CV stays in
               the hero, the palette and the mobile menu. -->
          <a
            class="press hidden h-9 items-center rounded-md bg-accent-orange px-3 font-mono text-meta font-medium text-accent-orange-foreground hover:bg-accent-orange-hover lg:inline-flex"
            [routerLink]="home()"
            fragment="contact"
          >
            {{ labels().talk }}
          </a>
          <!-- The server renders dark; the icon for the other theme is picked
               in CSS, so hydration never meets different markup. Below lg the
               menu has the switch. The new theme grows from the button. -->
          <button
            #themeButton
            type="button"
            [class]="iconButton + ' max-lg:hidden'"
            [attr.aria-label]="theme.theme() === 'dark' ? labels().toLight : labels().toDark"
            (click)="theme.toggle(themeButton)"
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
            class="press hidden h-9 items-center justify-center rounded-md border border-border px-2.5 font-mono text-meta text-muted-foreground hover:border-accent-orange/50 hover:text-foreground lg:inline-flex"
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
            [class]="iconButton + ' lg:hidden'"
            aria-controls="mobile-nav"
            [attr.aria-expanded]="open()"
            [attr.aria-label]="labels().menu"
            (click)="toggleMenu()"
          >
            <ng-icon [name]="open() ? 'lucideX' : 'lucideMenu'" size="18" aria-hidden="true" />
          </button>
        </div>
      </div>

      <!-- The rest of the screen: large links, then the CV, then language and
           theme as switches at the bottom. -->
      @if (open()) {
        <nav
          id="mobile-nav"
          class="flex h-[calc(100svh-4rem)] flex-col overflow-y-auto overscroll-contain border-t border-border px-(--gutter) pb-[max(env(safe-area-inset-bottom),1.5rem)] pt-4 lg:hidden"
          [attr.aria-label]="labels().mobile"
        >
          <ul class="m-0 flex list-none flex-col p-0" role="list">
            @for (link of links(); track link.key; let i = $index) {
              <li class="menu-rise" [style.--i]="i">
                <a
                  class="flex items-center gap-3 py-2.5 text-h3 transition-colors duration-(--dur-2) hover:text-foreground"
                  [class.text-foreground]="isActive(link)"
                  [class.text-muted-foreground]="!isActive(link)"
                  [attr.aria-current]="isActive(link) ? 'true' : null"
                  [routerLink]="link.commands"
                  [fragment]="link.fragment"
                  (click)="closeMenu()"
                >
                  {{ link.label }}
                  @if (isActive(link)) {
                    <span class="size-1.5 rounded-full bg-accent-orange" aria-hidden="true"></span>
                  }
                </a>
              </li>
            }
          </ul>
          @if (resumeHref(); as href) {
            <a
              class="menu-rise mt-4 inline-flex w-fit items-center gap-2 py-2 font-mono text-meta text-muted-foreground transition-colors duration-(--dur-2) hover:text-foreground"
              [style.--i]="links().length"
              [href]="href"
              download
              (click)="closeMenu()"
            >
              <ng-icon name="lucideDownload" size="16" aria-hidden="true" />
              {{ lang.t().hero.downloadCv }}
            </a>
          }

          <div
            class="mt-auto flex flex-wrap items-center justify-between gap-4 border-t border-border pt-5 font-mono text-meta"
          >
            <div
              class="inline-flex rounded-lg border border-border p-1"
              role="group"
              [attr.aria-label]="labels().language"
            >
              @for (locale of locales; track locale) {
                @if (locale === lang.lang()) {
                  <span [class]="segment + ' bg-muted text-foreground'" aria-current="true">{{
                    locale.toUpperCase()
                  }}</span>
                } @else {
                  <a
                    [class]="segment + ' press text-muted-foreground hover:text-foreground'"
                    [routerLink]="lang.alternates()[locale]"
                    [attr.hreflang]="locale"
                    [attr.lang]="locale"
                    (click)="lang.remember(locale); closeMenu()"
                  >
                    {{ locale.toUpperCase()
                    }}<span class="sr-only"> – {{ labels().switchTo }}</span>
                  </a>
                }
              }
            </div>
            <div
              class="inline-flex rounded-lg border border-border p-1"
              role="group"
              [attr.aria-label]="labels().theme"
            >
              <button
                #darkButton
                type="button"
                [class]="
                  segment +
                  ' press text-muted-foreground aria-pressed:bg-muted aria-pressed:text-foreground'
                "
                [attr.aria-pressed]="theme.theme() === 'dark'"
                (click)="theme.set('dark', darkButton)"
              >
                <ng-icon name="lucideMoon" size="14" aria-hidden="true" />
                {{ labels().dark }}
              </button>
              <button
                #lightButton
                type="button"
                [class]="
                  segment +
                  ' press text-muted-foreground aria-pressed:bg-muted aria-pressed:text-foreground'
                "
                [attr.aria-pressed]="theme.theme() === 'light'"
                (click)="theme.set('light', lightButton)"
              >
                <ng-icon name="lucideSun" size="14" aria-hidden="true" />
                {{ labels().light }}
              </button>
            </div>
          </div>
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
  protected readonly segment = segment;
  protected readonly searchClass = `${iconButton} lg:w-auto lg:gap-1.5 lg:px-2.5`;
  protected readonly locales = LOCALES;

  private readonly bar = viewChild.required<ElementRef<HTMLElement>>("bar");
  private readonly toggleButton = viewChild.required<ElementRef<HTMLElement>>("toggle");

  /** The wordmark: the first name, as a shell would print it. */
  readonly wordmark = computed(() =>
    this.lang.content().identity.name.split(" ")[0]!.toLowerCase(),
  );

  /** Home sections that exist in this language's content. */
  private readonly sections = computed(() => homeSections(this.lang.content()));

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
