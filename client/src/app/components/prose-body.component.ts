import { isPlatformBrowser } from "@angular/common";
import {
  type AfterViewChecked,
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  ElementRef,
  inject,
  input,
  PLATFORM_ID,
  viewChild,
} from "@angular/core";

import type { TocEntry } from "../content/schema";
import { CHROME } from "../i18n/chrome";
import { LanguageService } from "../services/language.service";

/** How long a copy button says "Copied" before it goes back. */
const COPIED_MS = 1500;

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
 * Puts each highlighted code block in a frame with its language (from the
 * build's `code-lang-ts` class) and a copy button, in the band prose.css
 * reserves at the top of the block, so nothing moves when they appear. Blocks
 * already framed are left alone.
 */
export function frameCodeBlocks(root: Element, copyLabel: string): void {
  const doc = root.ownerDocument;
  for (const pre of Array.from(root.querySelectorAll("pre.code-block"))) {
    if (pre.parentElement?.classList.contains("code-frame")) continue;
    const frame = doc.createElement("div");
    frame.className = "code-frame";
    pre.replaceWith(frame);

    const tools = doc.createElement("div");
    tools.className = "code-tools";
    const lang = /(?:^|\s)code-lang-(\S+)/.exec(pre.className)?.[1];
    if (lang) {
      const label = doc.createElement("span");
      label.textContent = lang;
      tools.append(label);
    }
    const button = doc.createElement("button");
    button.type = "button";
    button.className = "code-copy";
    button.textContent = copyLabel;
    tools.append(button);

    frame.append(pre, tools);
  }
}

/**
 * A published long-form body: a case study, a post, a legal page. Sanitized
 * on write by the API; Angular sanitizes it again here, and the table of
 * contents' anchors are put back afterwards — in the server render too, so a
 * shared `#section` link works before the app has loaded. In the browser,
 * code blocks get a copy button, handled by one listener on the body (no
 * inline script, so the CSP holds).
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
  private readonly lang = inject(LanguageService);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  constructor() {
    if (!this.isBrowser) return;
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const onClick = (event: MouseEvent) => {
      const button = (event.target as Element | null)?.closest?.("button.code-copy");
      const code = button?.closest(".code-frame")?.querySelector("code");
      if (!button || !code) return;
      void navigator.clipboard?.writeText(code.textContent ?? "").then(
        () => {
          const labels = CHROME[this.lang.lang()].code;
          button.textContent = `${labels.copied} ✓`;
          const timer = setTimeout(() => {
            timers.delete(timer);
            button.textContent = labels.copy;
          }, COPIED_MS);
          timers.add(timer);
        },
        () => undefined,
      );
    };
    let el: HTMLElement | undefined;
    afterNextRender(() => {
      el = this.body().nativeElement;
      el.addEventListener("click", onClick);
    });
    inject(DestroyRef).onDestroy(() => {
      el?.removeEventListener("click", onClick);
      for (const timer of timers) clearTimeout(timer);
    });
  }

  /** After every check: a new `html` replaces the headings and code blocks, ids and all. */
  ngAfterViewChecked(): void {
    const root = this.body().nativeElement;
    if (this.toc().length > 0) restoreHeadingIds(root, this.toc());
    if (this.isBrowser) frameCodeBlocks(root, CHROME[this.lang.lang()].code.copy);
  }
}
