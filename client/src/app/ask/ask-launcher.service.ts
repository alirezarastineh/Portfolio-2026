import { inject, Injectable, signal } from "@angular/core";

import { LanguageService } from "../services/language.service";

/**
 * The hero's ask bar's input; `/` focuses it (layouts/public-shell.component.ts).
 * Here rather than beside the bar, so the shell does not load the bar's code.
 */
export const ASK_BAR_ID = "ask-bar";

/** Where a visitor opened the assistant from, reported once with `ask_open`. */
export type AskSource =
  "hero" | "starter" | "palette" | "button" | "shortcut" | "terminal" | "case-study" | "post";

/**
 * How the rest of the site reaches the assistant without loading it: the
 * hero's ask bar and the palette's "Ask AI…" ask for the prompt to be focused
 * (on home, the About terminal); on other pages they open the same shell in a
 * sheet. A question can come along, sent once the prompt has it. The
 * terminal's own code loads only when one of these happens or the About
 * section comes into view.
 */
@Injectable({ providedIn: "root" })
export class AskLauncherService {
  private readonly lang = inject(LanguageService);

  private readonly _focusPending = signal(false);
  private readonly _sheet = signal(false);
  private readonly _sheetRequested = signal(false);
  private readonly _question = signal<string | null>(null);
  private source: AskSource | null = null;

  /** A request to focus the prompt that no terminal has taken yet. */
  readonly focusPending = this._focusPending.asReadonly();
  readonly sheetOpen = this._sheet.asReadonly();
  /** True from the first time the sheet is asked for, which loads its code. */
  readonly sheetRequested = this._sheetRequested.asReadonly();
  /** A question waiting for the prompt that takes the focus request. */
  readonly pendingQuestion = this._question.asReadonly();
  /**
   * Whether the assistant answers (`online`) or the offline shell does
   * (`resting`), as the terminal's code learns it from the server; null until
   * then. For the About terminal's title bar, which cannot load that code.
   */
  readonly assistant = signal<"online" | "resting" | null>(null);

  focusPrompt(source?: AskSource): void {
    if (source) this.source = source;
    this._focusPending.set(true);
  }

  /** The terminal that focused its prompt takes the request, so it happens once. */
  takeFocus(): boolean {
    if (!this._focusPending()) return false;
    this._focusPending.set(false);
    return true;
  }

  openSheet(source?: AskSource): void {
    this._sheetRequested.set(true);
    this._sheet.set(true);
    this.focusPrompt(source);
  }

  closeSheet(): void {
    this._sheet.set(false);
  }

  /** Puts a question to the assistant: the About terminal on home, the sheet elsewhere. */
  ask(text: string, source: AskSource): void {
    const question = text.trim();
    if (!question) return;
    this._question.set(question);
    if (this.lang.page() === "/") this.focusPrompt(source);
    else this.openSheet(source);
  }

  /** The waiting question, once. */
  takeQuestion(): string | null {
    const question = this._question();
    this._question.set(null);
    return question;
  }

  /** Where the latest request came from; a prompt focused directly is "terminal". */
  takeSource(): AskSource {
    const source = this.source ?? "terminal";
    this.source = null;
    return source;
  }
}
