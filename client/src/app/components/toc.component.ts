import { isPlatformBrowser } from "@angular/common";
import {
  afterRenderEffect,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  inject,
  input,
  PLATFORM_ID,
  signal,
} from "@angular/core";
import { RouterLink } from "@angular/router";

export interface TocItem {
  id: string;
  text: string;
  level: 2 | 3;
}

/**
 * "On this page": links to the page's own sections, with the one being read
 * marked. Links go through the router (`[routerLink]="[]"` + fragment): with
 * `<base href="/">` a bare `#id` would resolve to `/#id` and leave the page.
 */
@Component({
  selector: "app-toc",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  host: { class: "block" },
  template: `
    <nav [attr.aria-label]="label()">
      <p class="eyebrow m-0 mb-3 text-muted-foreground" aria-hidden="true">// {{ label() }}</p>
      <ol class="m-0 flex list-none flex-col gap-1 border-l border-border p-0">
        @for (item of items(); track item.id) {
          <li>
            <a
              class="-ml-px block border-l py-1 text-sm leading-snug transition-colors duration-200 hover:text-foreground"
              [class.pl-4]="item.level === 2"
              [class.pl-7]="item.level === 3"
              [class.border-accent-orange]="active() === item.id"
              [class.text-foreground]="active() === item.id"
              [class.border-transparent]="active() !== item.id"
              [class.text-muted-foreground]="active() !== item.id"
              [attr.aria-current]="active() === item.id ? 'location' : null"
              [routerLink]="[]"
              [fragment]="item.id"
              >{{ item.text }}</a
            >
          </li>
        }
      </ol>
    </nav>
  `,
})
export class TocComponent {
  readonly items = input.required<readonly TocItem[]>();
  readonly label = input.required<string>();

  protected readonly active = signal<string | null>(null);

  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  private observer?: IntersectionObserver;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.observer?.disconnect());

    // After render, when the targets (and the ids restored on them) exist.
    afterRenderEffect(() => {
      const ids = this.items().map((item) => item.id);
      if (this.isBrowser) this.watch(ids);
    });
  }

  /** The current section: the last heading that has scrolled past the header. */
  private watch(ids: string[]): void {
    this.observer?.disconnect();
    if (typeof IntersectionObserver === "undefined") return;

    const visible = new Set<string>();
    this.observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) visible.add(entry.target.id);
          else visible.delete(entry.target.id);
        }
        const current = ids.find((id) => visible.has(id));
        if (current) this.active.set(current);
      },
      // A band just below the fixed header: a heading counts once it reaches it.
      { rootMargin: "-80px 0px -70% 0px" },
    );
    for (const id of ids) {
      const target = document.getElementById(id);
      if (target) this.observer.observe(target);
    }
  }
}
