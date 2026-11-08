import { ChangeDetectionStrategy, Component, computed, input, signal } from "@angular/core";
import { NgIcon, provideIcons } from "@ng-icons/core";
import { lucideCheck, lucideLink } from "@ng-icons/lucide";

import type { Locale } from "../content/schema";
import { COPIED_MS, copyText, type CopyResult } from "../services/copy-text";
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
      <span class="mr-1 text-small text-muted-foreground" aria-hidden="true">
        {{ labels().share }}
      </span>
      <button type="button" [class]="control" (click)="copy()">
        <ng-icon
          [name]="copied() === 'copied' ? 'lucideCheck' : 'lucideLink'"
          size="16"
          aria-hidden="true"
        />
        <span>{{ labels()[copied() ?? "copy"] }}</span>
      </button>
      @for (network of networks(); track network.name) {
        <a
          [class]="control"
          [href]="network.href"
          target="_blank"
          rel="noreferrer noopener"
          [attr.aria-label]="network.label"
        >
          <ng-icon [name]="network.icon" size="16" aria-hidden="true" />
          <span aria-hidden="true">{{ network.name }}</span>
        </a>
      }
      <span class="sr-only" aria-live="polite">{{ labels()[copied() ?? "idle"] }}</span>
    </div>
  `,
})
export class ShareLinksComponent {
  readonly url = input.required<string>();
  readonly title = input.required<string>();
  readonly locale = input.required<Locale>();

  protected readonly copied = signal<CopyResult | null>(null);
  protected readonly labels = computed(() => CHROME[this.locale()].share);

  protected readonly control = "control press text-foreground";

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
    this.copied.set(await copyText(this.url()));
    setTimeout(() => this.copied.set(null), COPIED_MS);
  }
}
