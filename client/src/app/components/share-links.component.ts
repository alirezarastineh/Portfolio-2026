import { ChangeDetectionStrategy, Component, computed, input, signal } from "@angular/core";
import { NgIcon, provideIcons } from "@ng-icons/core";
import { lucideCheck, lucideLink } from "@ng-icons/lucide";

import type { Locale } from "../content/schema";
import { CHROME } from "../i18n/chrome";
import { fmt } from "../i18n/interpolate";
import { brandLinkedin, brandX } from "../icons/brand-icons";

/**
 * Sharing a post without third-party scripts: plain links to the networks'
 * share pages, and a button that copies the post's link.
 */
@Component({
  selector: "app-share-links",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgIcon],
  viewProviders: [provideIcons({ brandLinkedin, brandX, lucideCheck, lucideLink })],
  host: { class: "block" },
  template: `
    <div class="flex flex-wrap items-center gap-2" role="group" [attr.aria-label]="labels().share">
      <span class="eyebrow mr-1 text-muted-foreground" aria-hidden="true">
        {{ labels().share }}
      </span>
      <button type="button" [class]="control" (click)="copy()">
        <ng-icon [name]="copied() ? 'lucideCheck' : 'lucideLink'" size="14" aria-hidden="true" />
        <span>{{ copied() ? labels().copied : labels().copy }}</span>
      </button>
      @for (network of networks(); track network.name) {
        <a
          [class]="control"
          [href]="network.href"
          target="_blank"
          rel="noreferrer noopener"
          [attr.aria-label]="network.label"
        >
          <ng-icon [name]="network.icon" size="14" aria-hidden="true" />
          <span aria-hidden="true">{{ network.name }}</span>
        </a>
      }
      <span class="sr-only" aria-live="polite">{{ copied() ? labels().copied : "" }}</span>
    </div>
  `,
})
export class ShareLinksComponent {
  readonly url = input.required<string>();
  readonly title = input.required<string>();
  readonly locale = input.required<Locale>();

  protected readonly copied = signal(false);
  protected readonly labels = computed(() => CHROME[this.locale()].share);

  protected readonly control =
    "inline-flex h-9 cursor-pointer items-center gap-2 rounded-lg border border-border bg-transparent px-3 font-mono text-meta text-foreground transition-colors duration-200 hover:border-accent-orange/50";

  protected readonly networks = computed(() => {
    const url = encodeURIComponent(this.url());
    const text = encodeURIComponent(this.title());
    const on = this.labels().on;
    return [
      {
        name: "LinkedIn",
        icon: "brandLinkedin",
        label: fmt(on, { site: "LinkedIn" }),
        href: `https://www.linkedin.com/sharing/share-offsite/?url=${url}`,
      },
      {
        name: "X",
        icon: "brandX",
        label: fmt(on, { site: "X" }),
        href: `https://x.com/intent/post?url=${url}&text=${text}`,
      },
    ];
  });

  protected async copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.url());
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 2500);
    } catch {
      // Clipboard access denied (an insecure context, a policy): the URL bar still works.
    }
  }
}
