import { ChangeDetectionStrategy, Component, computed, inject } from "@angular/core";
import { RouterLink } from "@angular/router";
import { NgIcon } from "@ng-icons/core";

import { iconFor, provideRegistryIcons } from "../icons/icon-registry";
import { LanguageService } from "../services/language.service";

@Component({
  selector: "app-site-footer",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgIcon, RouterLink],
  viewProviders: [provideRegistryIcons()],
  host: {
    class: "block",
  },
  template: `
    <footer class="mt-24 border-t border-border py-8">
      <div class="container-site flex flex-wrap items-center justify-between gap-x-6 gap-y-4">
        <span class="font-mono text-meta text-muted-foreground">
          © {{ year() }} {{ identity().name }}
          @if (buildRef()) {
            <span class="text-muted-foreground/75"> · {{ buildRef() }}</span>
          }
        </span>
        <span class="font-mono text-meta text-muted-foreground"
          >{{ lang.t().profile.role }} · {{ lang.t().profile.location }}</span
        >
        <!-- Impressum and Datenschutz: required for a site run from Germany,
             and reachable from every page. -->
        <nav class="inline-flex gap-4 font-mono text-meta" [attr.aria-label]="lang.t().legal.nav">
          <a
            class="text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline"
            [routerLink]="['/', lang.lang(), 'legal', 'imprint']"
            >{{ lang.t().legal.imprint }}</a
          >
          <a
            class="text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline"
            [routerLink]="['/', lang.lang(), 'legal', 'privacy']"
            >{{ lang.t().legal.privacy }}</a
          >
        </nav>
        <ul class="m-0 inline-flex list-none gap-2 p-0" role="list">
          @for (s of socials(); track s.href) {
            <li>
              <a
                class="inline-flex size-9 items-center justify-center rounded-lg border border-border text-muted-foreground transition-[color,border-color] duration-200 ease-in-out hover:border-accent-orange/50 hover:text-foreground"
                [href]="s.href"
                [attr.aria-label]="s.label"
                [attr.target]="isWeb(s.href) ? '_blank' : null"
                [attr.rel]="isWeb(s.href) ? 'noreferrer noopener' : null"
              >
                <ng-icon [name]="iconFor(s.icon)" size="18" aria-hidden="true" />
              </a>
            </li>
          }
        </ul>
      </div>
    </footer>
  `,
})
export class SiteFooterComponent {
  readonly lang = inject(LanguageService);
  readonly identity = computed(() => this.lang.content().identity);
  readonly socials = computed(() => this.lang.content().socials);
  readonly year = computed(() => new Date().getFullYear());
  readonly buildRef = computed(() => {
    const raw = import.meta.env.VITE_GIT_SHA;
    if (!raw || raw.length < 4) return "";
    return raw.length > 12 ? raw.slice(0, 12) : raw;
  });

  iconFor(icon: string): string {
    return iconFor(icon);
  }

  /** A web page opens in a new tab; `mailto:` and the like never should. */
  isWeb(href: string): boolean {
    return /^https?:/i.test(href);
  }
}
