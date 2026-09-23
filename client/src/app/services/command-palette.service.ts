import { Injectable, signal } from "@angular/core";

/**
 * Opens and closes the public ⌘K palette. `requested` turns true the first
 * time anyone asks for it, which is when its code loads (a `@defer` in the
 * public shell): visitors who never open it never download it.
 */
@Injectable({ providedIn: "root" })
export class CommandPaletteService {
  private readonly _requested = signal(false);
  private readonly _open = signal(false);
  readonly requested = this._requested.asReadonly();
  readonly open = this._open.asReadonly();

  show(): void {
    this._requested.set(true);
    this._open.set(true);
  }

  hide(): void {
    this._open.set(false);
  }

  toggle(): void {
    if (this._open()) this.hide();
    else this.show();
  }
}
