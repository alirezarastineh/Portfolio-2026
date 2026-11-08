import { isPlatformBrowser } from "@angular/common";
import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  Injectable,
  input,
  PLATFORM_ID,
  signal,
} from "@angular/core";
import { RouterLink } from "@angular/router";

import type { Locale } from "../content/locale";
import { LanguageService } from "../services/language.service";

/**
 * The tab's stored conversation as pages read it without loading the
 * assistant: whether there is one (the About section), and the marks its last
 * match puts on the work. One module, so a page with marks loads one chunk.
 */
export const ASK_STORAGE_KEY = "ask:v1";

export function hasStoredConversation(): boolean {
  try {
    return !!sessionStorage.getItem(ASK_STORAGE_KEY);
  } catch {
    return false;
  }
}

type Loose = Record<string, unknown> | undefined;
const loose = (value: unknown): Loose =>
  value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
const list = (value: unknown): Loose[] => (Array.isArray(value) ? value.map(loose) : []);

/**
 * Matched work marked on the site (plan 3 W4), from the tab's stored
 * conversation: each page its last match cites on an evidence row, by id
 * without the locale (an English match marks `/de` too), with how many of the
 * brief's points it backs. Partial rows mark nothing, nor does a match that
 * has scrolled out of the stored conversation.
 */
export function matchMarks(stored: unknown): Map<string, number> {
  const marks = new Map<string, number>();
  const data = loose(
    list(loose(stored)?.["messages"])
      .flatMap((message) => list(message?.["parts"]))
      .findLast((part) => part?.["type"] === "data-match")?.["data"],
  );
  if (data?.["v"] !== 1) return marks;
  for (const row of list(data["items"])) {
    if (row?.["status"] !== "evidence") continue;
    const pages = new Set(
      list(row["cites"]).map((cite) => {
        const id = cite?.["id"];
        return typeof id === "string" ? id.split("@")[0] : "";
      }),
    );
    for (const page of pages) if (page) marks.set(page, (marks.get(page) ?? 0) + 1);
  }
  return marks;
}

/**
 * The marks as one signal for the whole page. It never imports the terminal's
 * store, so home stays light; the store keeps it in step instead (`read`).
 */
@Injectable({ providedIn: "root" })
export class MatchMarks {
  private readonly marks = signal<ReadonlyMap<string, number>>(new Map());

  constructor() {
    // Empty on the server and until hydration, so the server's HTML and hydration carry no mark.
    if (!isPlatformBrowser(inject(PLATFORM_ID))) return;
    afterNextRender(() => {
      try {
        this.read(JSON.parse(sessionStorage.getItem(ASK_STORAGE_KEY) ?? "null"));
      } catch {
        // Blocked or broken storage marks nothing.
      }
    });
  }

  /** How many of the brief's points a page backs: `project:<slug>`, `experience:<id>`. */
  count(page: string): number {
    return this.marks().get(page) ?? 0;
  }

  /** The conversation as the store keeps it (`ask:v1`), each time it changes. */
  read(stored: unknown): void {
    this.marks.set(matchMarks(stored));
  }
}

const MARK_COPY: Record<Locale, string> = {
  en: "Matches your brief",
  de: "Passt zur Beschreibung",
};

/**
 * A matched page's mark, back to the match. Its words live here, not in
 * `i18n/chrome.ts`, so pages without marks carry none. Off paper (styles.css).
 */
@Component({
  selector: "app-match-mark",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  // Above a card's stretched link, as its other links are.
  host: { class: "match-mark relative z-10 w-fit" },
  template: `
    <a
      class="link-underline inline-flex items-center text-data pointer-coarse:min-h-11"
      [routerLink]="['/', lang.lang(), 'match']"
      (click)="followed()"
      >{{ text() }}</a
    >
  `,
})
export class MatchMarkComponent {
  readonly n = input.required<number>();

  protected readonly lang = inject(LanguageService);
  protected readonly text = computed(() => `${MARK_COPY[this.lang.lang()]}: ${this.n()}`);

  protected followed(): void {
    // Loaded on the click: a static import would put one more chunk on every page with marks.
    void import("./track").then(({ track }) => track("match_mark_click")).catch(() => undefined);
  }
}
