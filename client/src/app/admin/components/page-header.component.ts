import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  type ElementRef,
  inject,
  input,
  output,
  signal,
  viewChild,
} from "@angular/core";
import { NgIcon, provideIcons } from "@ng-icons/core";
import { lucideExternalLink } from "@ng-icons/lucide";
import { HlmButton } from "@spartan-ng/helm/button";

import { LocaleToggleComponent } from "./editor-chrome.component";
import type { LocaleView } from "./field-pair.component";

/**
 * Every admin page's heading: the title (the page's `<h1>`), a slot beside it
 * for a status badge, a slot for actions, an optional Preview link (a new
 * tab) and an optional EN / DE / both switch.
 *
 * The title row sticks to the top of the window, and takes a blurred surface
 * once it does, so the title and the actions stay in reach down a long
 * editor. The line under it (a slug, the description) scrolls away.
 *
 * The host is `display: contents`, so the row is a child of the page's own
 * column and sticks for the whole page: a block host would be only as tall as
 * the row, with nothing to stick within. Pages put it first in a
 * `flex flex-col gap-6` column; the line under it pulls up against that gap.
 */
@Component({
  selector: "app-page-header",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [HlmButton, LocaleToggleComponent, NgIcon],
  viewProviders: [provideIcons({ lucideExternalLink })],
  host: { class: "contents" },
  template: `
    <div
      #bar
      class="sticky -top-px z-30 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3 before:pointer-events-none before:absolute before:inset-y-0 before:inset-x-[-100vw] before:-z-10 before:border-b before:border-transparent data-stuck:before:border-border data-stuck:before:bg-background/85 data-stuck:before:shadow-e1 data-stuck:before:backdrop-blur-md"
      [attr.data-stuck]="stuck() ? '' : null"
    >
      <div class="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
        <h1 class="m-0 min-w-0 text-h3 wrap-break-word text-foreground">{{ title() }}</h1>
        <ng-content select="[headerStatus]" />
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <ng-content select="[headerActions]" />
        @if (preview(); as href) {
          <a hlmBtn variant="outline" size="sm" [href]="href" target="_blank" rel="noopener">
            Preview
            <ng-icon name="lucideExternalLink" size="14" class="ml-1.5" aria-hidden="true" />
            <span class="sr-only">(opens in a new tab)</span>
          </a>
        }
        @if (view(); as current) {
          <app-locale-toggle [view]="current" (viewChange)="viewChange.emit($event)" />
        }
      </div>
    </div>
    @if (meta() || description()) {
      <div class="-mt-7 flex max-w-prose flex-col gap-1">
        @if (meta()) {
          <p class="m-0 font-mono text-meta wrap-anywhere text-muted-foreground">{{ meta() }}</p>
        }
        @if (description()) {
          <p class="m-0 text-sm text-muted-foreground">{{ description() }}</p>
        }
      </div>
    }
  `,
})
export class AdminPageHeaderComponent {
  readonly title = input.required<string>();
  readonly description = input("");
  /** A machine line under the title, in mono: a project's path, say. */
  readonly meta = input("");
  /** Where the draft of this page can be seen, opened in a new tab. */
  readonly preview = input<string | null>(null);
  /**
   * Bound (`[(view)]`) when the page is bilingual: shows the EN / DE / both
   * switch. An input and an output rather than a model, so a page's own
   * `signal<LocaleView>` binds without taking on the unset case.
   */
  readonly view = input<LocaleView | null>(null);
  readonly viewChange = output<LocaleView>();

  private readonly bar = viewChild.required<ElementRef<HTMLElement>>("bar");
  protected readonly stuck = signal(false);

  constructor() {
    const destroyRef = inject(DestroyRef);
    // Stuck at `top: -1px`, the row is one pixel out of the window: less than
    // fully visible is the signal. At rest at the top of the page, it is whole.
    afterNextRender(() => {
      if (typeof IntersectionObserver === "undefined") return;
      const observer = new IntersectionObserver(
        ([entry]) => {
          if (entry)
            this.stuck.set(entry.intersectionRatio < 1 && entry.boundingClientRect.top < 1);
        },
        { threshold: [1] },
      );
      observer.observe(this.bar().nativeElement);
      destroyRef.onDestroy(() => observer.disconnect());
    });
  }
}
