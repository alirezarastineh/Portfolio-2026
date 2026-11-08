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
 * marked. Folded on phones; from lg a rail that stays in view (prose.css), its
 * label shown in place of the fold's. Links go through the router
 * (`[routerLink]="[]"` + fragment): with `<base href="/">` a bare `#id` would
 * resolve to `/#id` and leave the page.
 */
@Component({
  selector: "app-toc",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  // The rail sticks within its parent: the host, not the nav inside it, which would have no room.
  host: { class: "toc block" },
  template: `
    <nav [attr.aria-label]="label()">
      <details class="toc-fold disclosure">
        <summary class="press">{{ label() }}</summary>
        <p class="toc-label" aria-hidden="true">{{ label() }}</p>
        <!-- Its block padding is room for a link's focus ring: the fold clips what it holds. -->
        <ol class="m-0 flex list-none flex-col gap-1 border-l border-border px-0 py-1">
          @for (item of items(); track item.id) {
            <li>
              <!-- Styled in prose.css: one short class per link, the current
                   one marked by aria-current alone. -->
              <a
                class="toc-link"
                [class.pl-4]="item.level === 2"
                [class.pl-7]="item.level === 3"
                [attr.aria-current]="active() === item.id ? 'location' : null"
                [routerLink]="[]"
                [fragment]="item.id"
                >{{ item.text }}</a
              >
            </li>
          }
        </ol>
      </details>
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
