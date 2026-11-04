import { DOCUMENT } from "@angular/common";
import { inject, Injectable, signal } from "@angular/core";

/** Below this the panel is a sheet over the whole page (Tailwind's `lg`; ask-sheet.component.ts). */
const SHEET_QUERY = "(width < 64rem)";

/** Where a visitor opened the assistant from, reported once with `ask_open`. */
export type AskSource =
  | "hero"
  | "starter"
  | "palette"
  | "button"
  | "shortcut"
  | "terminal"
  | "case-study"
  | "post"
  /** A reader page's buttons and selection (visitor plan V9, reader-ask.ts). */
  | "section"
  | "code"
  | "selection"
  /** "How do they connect?" under read next (visitor plan V15, read-next-block.ts). */
  | "read-next"
  /** A shared link's question, put in the prompt unsent (visitor plan V17, ask-link.ts). */
  | "link";

/**
 * What a reader points at on a case study or a post (visitor plan V9), as the
 * request sends it: a section by its heading's id, a code block by its place,
 * or a selection's text. The server takes the first two from the page's
 * document and trusts a selection only if the document holds it.
 */
export type AskFocus =
  | { kind: "section"; id: string }
  | { kind: "code"; index: number }
  | { kind: "selection"; text: string };

/** A question's focus, and how the terminal names it beside the question. */
export interface AskAbout {
  focus: AskFocus;
  label: string;
}

/**
 * How the rest of the site reaches the assistant without loading it: the hero's
 * ask bar, the floating button, the palette and a reader's buttons all open the
 * same panel, on every page. A question can come along, sent once the prompt has
 * it. The panel's code loads the first time one of these happens.
 */
@Injectable({ providedIn: "root" })
export class AskLauncherService {
  private readonly _focusPending = signal(false);
  private readonly _sheet = signal(false);
  private readonly _sheetRequested = signal(false);
  private readonly _question = signal<string | null>(null);
  /** A question for the prompt that only the visitor sends (visitor plan V17). */
  private draft: string | null = null;
  /** What the waiting question is about, when a reader pointed at something. */
  private about: AskAbout | null = null;
  private source: AskSource | null = null;

  readonly sheetOpen = this._sheet.asReadonly();
  /** True from the first time the sheet is asked for, which loads its code. */
  readonly sheetRequested = this._sheetRequested.asReadonly();
  /**
   * Whether the assistant answers (`online`) or the offline shell does
   * (`resting`), as the terminal's code learns it from the server; null until
   * then. For the panel's title bar.
   */
  readonly assistant = signal<"online" | "resting" | null>(null);
  /** Below 1024px: the panel covers the page, which is inert behind it (plan 4 U8). */
  readonly narrow = signal(false);
  /** Where the panel shows a visible Turnstile check; the panel sets it. */
  turnstileHost: HTMLElement | null = null;
  /**
   * Whether the hero's ask bar is on screen, where the floating button would only repeat it.
   * True until the bar says otherwise, so the server prints no button over it on home.
   */
  readonly barInView = signal(true);

  constructor() {
    const query = inject(DOCUMENT).defaultView?.matchMedia?.(SHEET_QUERY);
    if (query) {
      this.narrow.set(query.matches);
      query.addEventListener("change", (event) => this.narrow.set(event.matches));
    }
  }

  /** The panel takes each request to open or to ask, so it happens once. */
  takeFocus(): boolean {
    if (!this._focusPending()) return false;
    this._focusPending.set(false);
    return true;
  }

  openSheet(source?: AskSource): void {
    if (source) this.source = source;
    this._sheetRequested.set(true);
    this._sheet.set(true);
    this._focusPending.set(true);
  }

  closeSheet(): void {
    this._sheet.set(false);
  }

  /**
   * Closes the panel where it covers the page, so the page a visitor chose (a citation, the
   * contact form) is what they see and can focus. Beside the page, from 1024px, it stays.
   */
  closeIfSheet(): void {
    if (this.narrow()) this.closeSheet();
  }

  /** Where a visible Turnstile check goes: the panel while it is open; else the page's own box. */
  checkHost(): HTMLElement | undefined {
    return this._sheet() ? (this.turnstileHost ?? undefined) : undefined;
  }

  /** Puts a question to the assistant, with what a reader points at, when they did (visitor plan V9). */
  ask(text: string, source: AskSource, about?: AskAbout): void {
    const question = text.trim();
    if (!question) return;
    this._question.set(question);
    this.about = about ?? null;
    this.openSheet(source);
  }

  /**
   * Puts a question in the prompt without sending it (visitor plan V17: a shared
   * link proposes, only the visitor sends), focused.
   */
  prefill(text: string, source: AskSource): void {
    const question = text.trim();
    if (!question) return;
    this.draft = question;
    this.openSheet(source);
  }

  /** The question to put in the prompt, unsent, once. */
  takeDraft(): string | null {
    const draft = this.draft;
    this.draft = null;
    return draft;
  }

  /** The waiting question, once. */
  takeQuestion(): string | null {
    const question = this._question();
    this._question.set(null);
    return question;
  }

  /** What the waiting question is about, once; taken with the question. */
  takeAbout(): AskAbout | null {
    const about = this.about;
    this.about = null;
    return about;
  }

  /** Where the latest request came from; "terminal" when it did not say. */
  takeSource(): AskSource {
    const source = this.source ?? "terminal";
    this.source = null;
    return source;
  }
}
