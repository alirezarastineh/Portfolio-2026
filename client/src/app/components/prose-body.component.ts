import {
  type AfterViewChecked,
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  input,
  viewChild,
} from "@angular/core";

import type { TocEntry } from "../content/schema";

/**
 * Gives the body's headings the ids the build assigned (listed in `toc`).
 *
 * The published HTML has them, but Angular's sanitizer drops every `id` from
 * `[innerHTML]` — it guards against DOM clobbering. Headings are matched by
 * level and text rather than position, so a heading the build skipped (an
 * empty one) cannot shift the rest.
 */
export function restoreHeadingIds(root: Element, toc: readonly TocEntry[]): void {
  const pending = [...toc];
  for (const heading of Array.from(root.querySelectorAll("h2, h3"))) {
    const text = (heading.textContent ?? "").replace(/\s+/g, " ").trim();
    const level = heading.tagName.toLowerCase() === "h2" ? 2 : 3;
    const index = pending.findIndex((entry) => entry.level === level && entry.text === text);
    if (index === -1) continue;
    const [entry] = pending.splice(index, 1);
    // Not `heading.id =`: the server renders with Domino, where attributes are the safe path.
    if (entry && heading.getAttribute("id") !== entry.id) heading.setAttribute("id", entry.id);
  }
}

/**
 * The published body minus the heading ids Angular's sanitizer would strip
 * anyway (they are restored from the table of contents after rendering). With
 * nothing left for it to remove, the sanitizer stays on and silent: in dev mode
 * it warns on every body otherwise.
 */
export function withoutHeadingIds(html: string): string {
  return html.replace(/<(h[23])\s+id="[^"<>]*"/g, "<$1");
}

/**
 * A published long-form body: a case study, a post, a legal page. Sanitized
 * on write by the API; Angular sanitizes it again here, and the table of
 * contents' anchors are put back afterwards — in the server render too, so a
 * shared `#section` link works before the app has loaded.
 */
@Component({
  selector: "app-prose-body",
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: "block" },
  template: `<div #body class="prose-body" [innerHTML]="sanitizable()"></div>`,
})
export class ProseBodyComponent implements AfterViewChecked {
  readonly html = input.required<string>();
  readonly toc = input<readonly TocEntry[]>([]);

  protected readonly sanitizable = computed(() => withoutHeadingIds(this.html()));

  private readonly body = viewChild.required<ElementRef<HTMLElement>>("body");

  /** After every check: a new `html` replaces the headings, ids and all. */
  ngAfterViewChecked(): void {
    if (this.toc().length > 0) restoreHeadingIds(this.body().nativeElement, this.toc());
  }
}
