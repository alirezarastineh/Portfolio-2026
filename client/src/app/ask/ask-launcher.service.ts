import { Injectable, signal } from "@angular/core";

/**
 * How the rest of the site reaches the assistant without loading it: the
 * hero's "ask my portfolio" link and the palette's "Ask AI…" ask for the
 * prompt to be focused (on home, the About terminal); on other pages they open
 * the same shell in a sheet. The terminal's own code loads only when one of
 * these happens or the About section comes into view.
 */
@Injectable({ providedIn: "root" })
export class AskLauncherService {
  private readonly _focusPending = signal(false);
  private readonly _sheet = signal(false);
  private readonly _sheetRequested = signal(false);

  /** A request to focus the prompt that no terminal has taken yet. */
  readonly focusPending = this._focusPending.asReadonly();
  readonly sheetOpen = this._sheet.asReadonly();
  /** True from the first time the sheet is asked for, which loads its code. */
  readonly sheetRequested = this._sheetRequested.asReadonly();

  focusPrompt(): void {
    this._focusPending.set(true);
  }

  /** The terminal that focused its prompt takes the request, so it happens once. */
  takeFocus(): boolean {
    if (!this._focusPending()) return false;
    this._focusPending.set(false);
    return true;
  }

  openSheet(): void {
    this._sheetRequested.set(true);
    this._sheet.set(true);
    this.focusPrompt();
  }

  closeSheet(): void {
    this._sheet.set(false);
  }
}
