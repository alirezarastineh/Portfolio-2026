import { DOCUMENT, isPlatformBrowser } from "@angular/common";
import { DestroyRef, inject, Injectable, PLATFORM_ID, signal } from "@angular/core";

export type Theme = "light" | "dark";

/** Where an explicit choice is kept. Read by index.html's pre-paint script too. */
export const THEME_STORAGE_KEY = "theme";

const LIGHT_QUERY = "(prefers-color-scheme: light)";

/** Sets the theme on `<html>`: the attribute the tokens use, and Spartan's `dark` class. */
export function applyTheme(doc: Document, theme: Theme): void {
  const root = doc.documentElement;
  root.setAttribute("data-theme", theme); // NOSONAR
  root.classList.toggle("dark", theme === "dark");
}

/**
 * Light or dark. index.html's inline `theme-init` script applies the saved
 * choice, or else the system setting, before the first paint; this service
 * reads what it applied and switches it. The server always renders dark, so
 * anything that differs by theme is switched in CSS (`[data-theme]`) rather
 * than in markup, which keeps hydration identical.
 *
 * With no saved choice the site follows the system setting as it changes.
 */
@Injectable({ providedIn: "root" })
export class ThemeService {
  private readonly doc = inject(DOCUMENT);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  private readonly _theme = signal<Theme>(this.current());
  readonly theme = this._theme.asReadonly();

  constructor() {
    if (!this.isBrowser) return;
    const query = globalThis.matchMedia?.(LIGHT_QUERY);
    if (!query) return;
    const follow = (event: MediaQueryListEvent) => {
      if (this.saved() === null) this.apply(event.matches ? "light" : "dark");
    };
    query.addEventListener("change", follow);
    inject(DestroyRef).onDestroy(() => query.removeEventListener("change", follow));
  }

  toggle(): void {
    this.set(this._theme() === "dark" ? "light" : "dark");
  }

  /** An explicit choice: applied now and remembered for later visits. */
  set(theme: Theme): void {
    this.apply(theme);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // Storage may be blocked; the choice then lasts for this page view.
    }
  }

  private apply(theme: Theme): void {
    if (this.isBrowser) applyTheme(this.doc, theme);
    this._theme.set(theme);
  }

  private current(): Theme {
    return this.doc.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark"; // NOSONAR
  }

  private saved(): Theme | null {
    try {
      const value = localStorage.getItem(THEME_STORAGE_KEY);
      return value === "light" || value === "dark" ? value : null;
    } catch {
      return null;
    }
  }
}
