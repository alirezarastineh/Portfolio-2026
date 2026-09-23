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
import { lucideMenu, lucideX } from "@ng-icons/lucide";

import { otherLocale } from "../content/locale";
import { LanguageService } from "../services/language.service";

const SECTION_IDS = ["hero", "skills", "projects", "about", "contact"] as const;
type SectionId = (typeof SECTION_IDS)[number];

interface NavLink {
  label: string;
  id: SectionId;
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
  viewProviders: [provideIcons({ lucideMenu, lucideX })],
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
          class="hidden justify-center gap-7 md:inline-flex"
          [attr.aria-label]="labels().primary"
        >
          @for (link of links(); track link.id) {
            <a
              class="relative inline-flex items-center font-mono text-[0.8rem] transition-colors duration-200 ease-in-out hover:text-foreground"
              [class.text-foreground]="isActive(link.id)"
              [class.text-muted-foreground]="!isActive(link.id)"
              [attr.aria-current]="isActive(link.id) ? 'true' : null"
              [routerLink]="home()"
              [fragment]="link.id"
              (click)="closeMenu()"
            >
              @if (isActive(link.id)) {
                <span
                  class="mr-1.5 inline-block size-1 rounded-full bg-accent-orange"
                  aria-hidden="true"
                ></span>
              }
              <span>{{ link.label }}</span>
            </a>
          }
        </nav>
        <!-- A real link to this page in the other language: crawlable, works
             without JavaScript, and remembered for the next visit to "/". -->
        <a
          class="hidden cursor-pointer items-center justify-center rounded-md border border-border px-2.5 py-1 font-mono text-[0.8rem] text-muted-foreground transition-colors duration-200 ease-in-out hover:border-accent-orange/50 hover:text-foreground md:inline-flex"
          [routerLink]="lang.alternates()[other()]"
          [attr.hreflang]="other()"
          [attr.lang]="other()"
          [attr.aria-label]="labels().switchTo"
          (click)="lang.remember(other())"
        >
          {{ other().toUpperCase() }}
        </a>
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
          @for (link of links(); track link.id) {
            <a
              class="flex items-center gap-2 px-1 py-2.5 font-mono text-[0.95rem]"
              [class.text-foreground]="isActive(link.id)"
              [class.text-muted-foreground]="!isActive(link.id)"
              [attr.aria-current]="isActive(link.id) ? 'true' : null"
              [routerLink]="home()"
              [fragment]="link.id"
              (click)="closeMenu()"
            >
              @if (isActive(link.id)) {
                <span
                  class="inline-block size-1 rounded-full bg-accent-orange"
                  aria-hidden="true"
                ></span>
              }
              <span>{{ link.label }}</span>
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

  readonly links = computed<NavLink[]>(() => {
    const n = this.lang.t().nav;
    return [
      { label: n.skills, id: "skills" },
      { label: n.projects, id: "projects" },
      { label: n.about, id: "about" },
      { label: n.contact, id: "contact" },
    ];
  });

  readonly home = computed(() => ["/", this.lang.lang()]);
  readonly other = computed(() => otherLocale(this.lang.lang()));
  readonly labels = computed(() => LABELS[this.lang.lang()]);

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

  /** Only the home page has sections; elsewhere no link claims to be current. */
  isActive(id: SectionId): boolean {
    return this.lang.page() === "/" && this.active() === id;
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
    if (!this.isBrowser) return;

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
        const next = SECTION_IDS.find((id) => this.visible.has(id));
        if (next) this.active.set(next);
      },
      { rootMargin: "-30% 0px -55% 0px", threshold: 0 },
    );

    this.observePending();
    if (this.observed.size < SECTION_IDS.length) {
      // Sections can render after the header (deferred or late content).
      this.mutationObserver = new MutationObserver(() => {
        this.observePending();
        if (this.observed.size >= SECTION_IDS.length) {
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

  private observePending(): void {
    if (!this.observer) return;
    for (const id of SECTION_IDS) {
      if (this.observed.has(id)) continue;
      const el = document.getElementById(id);
      if (el) {
        this.observer.observe(el);
        this.observed.add(id);
      }
    }
  }
}
