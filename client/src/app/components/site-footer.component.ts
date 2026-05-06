import { ChangeDetectionStrategy, Component, computed, inject } from "@angular/core";
import { NgIcon, provideIcons } from "@ng-icons/core";
import { lucideGithub, lucideLinkedin, lucideMail } from "@ng-icons/lucide";

import { profile, type SocialLink } from "../data/profile.data";
import { LanguageService } from "../services/language.service";

const ICON_MAP: Record<SocialLink["icon"], string> = {
  github: "lucideGithub",
  linkedin: "lucideLinkedin",
  mail: "lucideMail",
  twitter: "lucideMail",
};

@Component({
  selector: "app-site-footer",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgIcon],
  viewProviders: [provideIcons({ lucideGithub, lucideLinkedin, lucideMail })],
  host: {
    class: "block",
  },
  template: `
    <footer class="mt-24 border-t border-border px-6 py-8">
      <div class="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-x-6 gap-y-4">
        <span class="font-mono text-[0.78rem] text-muted-foreground">
          © {{ year() }} {{ profile.name }}
          @if (buildRef()) {
            <span class="text-muted-foreground/75"> · {{ buildRef() }}</span>
          }
        </span>
        <span class="font-mono text-[0.78rem] text-muted-foreground"
          >{{ lang.t().profile.role }} · {{ profile.location }}</span
        >
        <ul class="m-0 inline-flex list-none gap-2 p-0" role="list">
          @for (s of profile.socials; track s.href) {
            <li>
              <a
                class="inline-flex size-9 items-center justify-center rounded-lg border border-border text-muted-foreground transition-[color,border-color] duration-200 ease-in-out hover:border-accent-indigo/50 hover:text-foreground"
                [href]="s.href"
                [attr.aria-label]="s.label"
                target="_blank"
                rel="noreferrer noopener"
              >
                <ng-icon [name]="iconFor(s.icon)" size="18" />
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
  readonly profile = profile;
  readonly year = computed(() => new Date().getFullYear());
  readonly buildRef = computed(() => {
    const raw = import.meta.env.VITE_GIT_SHA;
    if (!raw || raw.length < 4) return "";
    return raw.length > 12 ? raw.slice(0, 12) : raw;
  });

  iconFor(icon: SocialLink["icon"]): string {
    return ICON_MAP[icon];
  }
}
