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
 * the links and the controls do not fit beside the name and "Let's talk".
 */
const DESKTOP = "(min-width: 1024px)";

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
         it works before the app is interactive too. Waits above the screen and
         drops in, over the header, when focused (not sr-only: undoing that on
         focus makes it static, under the header). -->
    <a
      class="fixed left-4 top-3 z-(--z-skip) -translate-y-16 rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background focus:translate-y-0"
      [attr.href]="skipHref()"
      (click)="skipToContent($event)"
      >{{ labels().skip }}</a
    >

    <!-- See-through over the top of the page, solid once scrolled
         (styles/motion.css; without scroll timelines it stays as styled here),
         and while the menu is open. -->
    <header
      #bar
      class="site-header fixed inset-x-0 top-0 z-(--z-header) border-b border-border bg-background"
      [attr.data-open]="open() ? '' : null"
      (keydown)="trapFocus($event)"
    >
      <div
        class="site-header-row container-site grid h-16 grid-cols-[auto_1fr_auto] items-center gap-4"
      >
        <!-- The name, ended by the favicon's square full stop. The first name alone below 360px. -->
        <a
          class="inline-flex h-10 items-center text-small font-semibold text-foreground"
          [routerLink]="home()"
          fragment="hero"
          (click)="closeMenu()"
        >
          <span translate="no"
            >{{ name().first }}<span class="max-[360px]:hidden">&ngsp;{{ name().rest }}</span></span
          ><span class="text-signal" aria-hidden="true">.</span
          ><span class="sr-only"> – {{ labels().home }}</span>
        </a>

        <nav
          class="hidden justify-center gap-6 lg:inline-flex xl:gap-8"
          [attr.aria-label]="labels().primary"
        >
          @for (link of links(); track link.key) {
            <a
              class="nav-link relative inline-flex h-10 items-center text-small transition-colors duration-(--dur-2) hover:text-foreground pointer-coarse:h-11"
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
          <!-- The palette, whose first row asks the assistant. Its keys show once the
               browser knows the platform, so hydration never meets different markup. -->
          <button
            type="button"
            class="control press hidden lg:inline-flex"
            aria-keyshortcuts="Control+K Meta+K"
            (click)="palette.show()"
          >
            <ng-icon name="lucideSearch" size="16" aria-hidden="true" />
            {{ labels().search }}
            @if (shortcut(); as keys) {
              <kbd class="ml-1 font-sans text-faint-foreground" aria-hidden="true">{{ keys }}</kbd>
            }
          </button>
          <!-- The server renders dark; the icon for the other theme is picked
               in CSS, so hydration never meets different markup. Below lg the
               menu has the switch. The new theme grows from the button. -->
          <button
            #themeButton
            type="button"
            class="control press hidden lg:inline-flex"
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
            class="control press hidden lg:inline-flex"
            [routerLink]="lang.alternates()[other()]"
            [attr.hreflang]="other()"
            [attr.lang]="other()"
            (click)="lang.remember(other())"
          >
            {{ other().toUpperCase() }}<span class="sr-only"> – {{ labels().switchTo }}</span>
          </a>
          <!-- The one orange fill, in view at every width. -->
          <a
            class="btn btn-primary press"
            [routerLink]="home()"
            fragment="contact"
            (click)="closeMenu()"
          >
            {{ labels().talk }}
          </a>
          <button
            #toggle
            type="button"
            class="control press pointer-coarse:size-12 lg:hidden"
            aria-controls="mobile-nav"
            [attr.aria-expanded]="open()"
            [attr.aria-label]="labels().menu"
            (click)="toggleMenu()"
          >
            <ng-icon [name]="open() ? 'lucideX' : 'lucideMenu'" size="20" aria-hidden="true" />
          </button>
        </div>
      </div>

      <!-- The rest of the screen, the page inert and still behind it (the public
           shell, styles.css). Large links low, within a thumb's reach; then the
           palette and the CV; language and theme at the bottom. -->
      @if (open()) {
        <nav
          id="mobile-nav"
          class="flex h-[calc(100dvh-4rem)] flex-col overflow-y-auto overscroll-contain border-t border-border px-(--gutter) pb-[max(env(safe-area-inset-bottom),1.5rem)] lg:hidden"
          [attr.aria-label]="labels().mobile"
        >
          <ul class="m-0 mt-auto flex list-none flex-col p-0 pt-6" role="list">
            @for (link of links(); track link.key; let i = $index) {
              <li class="menu-rise" [style.--i]="i">
                <a
                  class="flex min-h-14 items-center gap-3 text-h2 transition-colors duration-(--dur-2) hover:text-foreground"
                  [class.text-foreground]="isActive(link)"
                  [class.text-muted-foreground]="!isActive(link)"
                  [attr.aria-current]="isActive(link) ? 'true' : null"
                  [routerLink]="link.commands"
                  [fragment]="link.fragment"
                  (click)="closeMenu()"
                >
                  {{ link.label }}
                  @if (isActive(link)) {
                    <span class="size-2 bg-signal" aria-hidden="true"></span>
                  }
                </a>
              </li>
            }
          </ul>
          <div
            class="menu-rise mt-6 flex flex-wrap items-center gap-x-6 gap-y-2"
            [style.--i]="links().length"
          >
            <button type="button" class="btn btn-secondary press" (click)="openPalette()">
              <ng-icon name="lucideSearch" size="16" aria-hidden="true" />
              {{ labels().search }}
            </button>
            @if (resumeHref(); as href) {
              <a class="btn btn-quiet press" [href]="href" download (click)="closeMenu()">
                <ng-icon name="lucideDownload" size="16" aria-hidden="true" />
                {{ lang.t().hero.downloadCv }}
              </a>
            }
          </div>

          <div
            class="mt-6 flex flex-wrap items-center justify-between gap-4 border-t border-border pt-5"
          >
            <div
              class="inline-flex rounded-lg border border-border"
              role="group"
              [attr.aria-label]="labels().language"
            >
              @for (locale of locales; track locale) {
                @if (locale === lang.lang()) {
                  <span
                    class="control cursor-default border-transparent bg-surface-2 text-foreground"
                    aria-current="true"
                    >{{ locale.toUpperCase() }}</span
                  >
                } @else {
                  <a
                    class="control press border-transparent"
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
              class="inline-flex rounded-lg border border-border"
              role="group"
              [attr.aria-label]="labels().theme"
            >
              <button
                #darkButton
                type="button"
                class="control press border-transparent"
                [attr.aria-pressed]="theme.theme() === 'dark'"
                (click)="theme.set('dark', darkButton)"
              >
                <ng-icon name="lucideMoon" size="16" aria-hidden="true" />
                {{ labels().dark }}
              </button>
              <button
                #lightButton
                type="button"
                class="control press border-transparent"
                [attr.aria-pressed]="theme.theme() === 'light'"
                (click)="theme.set('light', lightButton)"
              >
                <ng-icon name="lucideSun" size="16" aria-hidden="true" />
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

  protected readonly locales = LOCALES;

  private readonly bar = viewChild.required<ElementRef<HTMLElement>>("bar");
  private readonly toggleButton = viewChild.required<ElementRef<HTMLElement>>("toggle");

  /** The full name, split where narrow phones drop the rest. */
  readonly name = computed(() => {
    const [first = "", ...rest] = this.lang.content().identity.name.split(" ");
    return { first, rest: rest.join(" ") };
  });

  /** The palette's keys on this platform, known only in the browser. */
  protected readonly shortcut = signal<string | null>(null);

  /** Home sections that exist in this language's content. */
  private readonly sections = computed(() => homeSections(this.lang.content()));

  /**
   * Work, About, Experience and Writing, in the page's order: Skills and Contact stay on
   * the page, in the palette and behind "Let's talk". Writing links to its own page; on
   * home it lights up while its section is in view.
   */
  readonly links = computed<NavLink[]>(() => {
    const n = this.lang.t().nav;
    const labels: Partial<Record<SectionId, string>> = {
      projects: n.projects,
      experience: n.experience,
      writing: n.writing,
      about: n.about,
    };
    const home = this.home();
    return this.sections().flatMap<NavLink>((id) => {
      const label = labels[id];
      if (!label) return [];
      return id === "writing"
        ? [{ label, key: id, commands: [...home, "writing"] }]
        : [{ label, key: id, commands: home, fragment: id }];
    });
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
      // This runs in the server's render too, whose platform is not the visitor's.
      if (this.isBrowser) {
        this.shortcut.set(/Mac|iPhone|iPad/.test(navigator.platform) ? "⌘\u00A0K" : "Ctrl\u00A0K");
      }
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

  /** From the menu: the palette takes over, and gives focus back to the menu's toggle. */
  protected openPalette(): void {
    this.closeMenu();
    this.toggleButton().nativeElement.focus();
    this.palette.show();
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
