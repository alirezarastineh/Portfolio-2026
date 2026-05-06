import { isPlatformBrowser } from "@angular/common";
import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject,
  PLATFORM_ID,
  signal,
} from "@angular/core";
import { NgIcon, provideIcons } from "@ng-icons/core";
import { lucideMenu, lucideX } from "@ng-icons/lucide";

import { profile } from "../data/profile.data";
import { LanguageService } from "../services/language.service";

const SECTION_IDS = ["hero", "skills", "projects", "about", "contact"] as const;
type SectionId = (typeof SECTION_IDS)[number];

interface NavLink {
  label: string;
  href: string;
  id: SectionId;
}

@Component({
  selector: "app-site-header",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgIcon],
  viewProviders: [provideIcons({ lucideMenu, lucideX })],
  host: {
    class: "contents",
  },
  template: `
    <header
      class="fixed inset-x-0 top-0 z-40 border-b border-border bg-[oklch(0.235_0_0/78%)] backdrop-blur-md backdrop-saturate-140"
    >
      <div class="mx-auto grid max-w-7xl grid-cols-[auto_1fr_auto_auto] items-center gap-4 px-6 py-3.5">
        <a
          class="inline-flex items-center gap-[0.4rem] font-mono text-[0.95rem] font-semibold tracking-[0.04em] text-foreground"
          href="#hero"
          (click)="closeMenu()"
        >
          <span>{{ initials }}</span>
          <span class="size-1.5 rounded-full bg-accent-orange"></span>
        </a>
        <nav class="hidden justify-center gap-7 md:inline-flex" aria-label="Primary">
          @for (link of links(); track link.href) {
            <a
              class="relative inline-flex items-center font-mono text-[0.8rem] transition-colors duration-200 ease-in-out hover:text-foreground"
              [class.text-foreground]="isActive(link.id)"
              [class.text-muted-foreground]="!isActive(link.id)"
              [attr.aria-current]="isActive(link.id) ? 'true' : null"
              [href]="link.href"
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
        <button
          type="button"
          class="hidden cursor-pointer items-center justify-center rounded-md border border-border px-2.5 py-1 font-mono text-[0.8rem] text-muted-foreground transition-colors duration-200 ease-in-out hover:border-accent-orange/50 hover:text-foreground md:inline-flex"
          [attr.aria-label]="lang.lang() === 'en' ? 'Switch to German' : 'Auf Englisch wechseln'"
          (click)="lang.toggle()"
        >
          {{ lang.lang() === "en" ? "DE" : "EN" }}
        </button>
        <button
          type="button"
          class="inline-flex size-10 cursor-pointer items-center justify-center rounded-lg border border-border bg-transparent text-foreground md:hidden"
          [attr.aria-expanded]="open()"
          aria-label="Toggle navigation"
          (click)="toggleMenu()"
        >
          <ng-icon [name]="open() ? 'lucideX' : 'lucideMenu'" size="20" />
        </button>
      </div>
      @if (open()) {
        <nav
          class="flex flex-col gap-1 border-t border-border px-6 pb-4 pt-2 md:hidden"
          aria-label="Mobile"
        >
          @for (link of links(); track link.href) {
            <a
              class="flex items-center gap-2 px-1 py-2.5 font-mono text-[0.95rem]"
              [class.text-foreground]="isActive(link.id)"
              [class.text-muted-foreground]="!isActive(link.id)"
              [attr.aria-current]="isActive(link.id) ? 'true' : null"
              [href]="link.href"
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
          <button
            type="button"
            class="mt-1 flex cursor-pointer items-center gap-2 rounded-md border border-border px-3 py-2 font-mono text-[0.85rem] text-muted-foreground transition-colors duration-200 ease-in-out hover:border-accent-orange/50 hover:text-foreground"
            [attr.aria-label]="lang.lang() === 'en' ? 'Switch to German' : 'Auf Englisch wechseln'"
            (click)="lang.toggle(); closeMenu()"
          >
            {{ lang.lang() === "en" ? "DE — Deutsch" : "EN — English" }}
          </button>
        </nav>
      }
    </header>
  `,
})
export class SiteHeaderComponent {
  readonly lang = inject(LanguageService);

  readonly initials = profile.name
    .split(" ")
    .map((p) => p[0])
    .join("")
    .toUpperCase();

  readonly links = computed<NavLink[]>(() => {
    const n = this.lang.t().nav;
    return [
      { label: n.skills, href: "#skills", id: "skills" },
      { label: n.projects, href: "#projects", id: "projects" },
      { label: n.about, href: "#about", id: "about" },
      { label: n.contact, href: "#contact", id: "contact" },
    ];
  });

  readonly open = signal(false);
  readonly active = signal<SectionId>("hero");

  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  private readonly destroyRef = inject(DestroyRef);
  private observer?: IntersectionObserver;
  private mutationObserver?: MutationObserver;
  private readonly visible = new Set<SectionId>();
  private readonly observed = new Set<SectionId>();

  readonly activeId = computed(() => this.active());

  constructor() {
    afterNextRender(() => this.setupObserver());
    this.destroyRef.onDestroy(() => {
      this.observer?.disconnect();
      this.mutationObserver?.disconnect();
    });
  }

  isActive(id: SectionId): boolean {
    return this.activeId() === id;
  }

  toggleMenu(): void {
    this.open.update((v) => !v);
  }

  closeMenu(): void {
    this.open.set(false);
  }

  private setupObserver(): void {
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
