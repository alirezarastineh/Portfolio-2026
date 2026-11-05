import { DOCUMENT } from "@angular/common";
import { computed, inject, Injectable, signal } from "@angular/core";

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
 * stage, the floating button, the palette and a reader's buttons all lead to one
 * conversation, on home's stage while it is on screen, else in the panel. A
 * question can come along, sent once the prompt has it. The console's code loads
 * the first time one of these happens.
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
  /** Where the console shows a visible Turnstile check; the console sets it. */
  turnstileHost: HTMLElement | null = null;
  /**
   * Whether the hero's stage is on screen, where the floating button would only repeat it.
   * True until the stage says otherwise, so the server prints no button over it on home.
   */
  readonly stageInView = signal(true);
  /** Home's stage is on the page, in a browser. */
  readonly stageReady = signal(false);
  /** The visitor's latest question, as the console knows it: there is a conversation to show. */
  readonly lastQuestion = signal<string | null>(null);
  /** The admin's suggested questions by language, read once a page load; null until they come. */
  readonly questions = signal<Record<string, string[]> | null>(null);
  /** Whether the scorecard is published; null until the server has said. */
  readonly scorecard = signal<boolean | null>(null);
  private readonly stageAsked = signal(false);
  /**
   * The console runs on the stage: one was asked for there, or a conversation exists. Never below
   * 1024px, where the stage is the sheet's door, nor while the panel holds the conversation.
   */
  readonly stageLive = computed(
    () =>
      this.stageReady() &&
      !this.narrow() &&
      !this._sheet() &&
      (this.stageAsked() || this.lastQuestion() !== null),
  );
  /** `ask_open` went out: once per page load, wherever the console stands. */
  opened = false;

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

  /** Home's stage takes a request while it is on screen; otherwise the panel does (plan 4 U11b). */
  openSheet(source?: AskSource): void {
    if (source) this.source = source;
    if (this.stageReady() && this.stageInView() && !this.narrow() && !this._sheet()) {
      this.stageAsked.set(true);
    } else {
      this.openPanel();
    }
    this._focusPending.set(true);
  }

  /** The panel, wherever the visitor is: it never scrolls them back to the stage. */
  openPanel(): void {
    this._sheetRequested.set(true);
    this._sheet.set(true);
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

  /** Where a visible Turnstile check goes: the console on show; else the page's own box. */
  checkHost(): HTMLElement | undefined {
    return this._sheet() || this.stageLive() ? (this.turnstileHost ?? undefined) : undefined;
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
