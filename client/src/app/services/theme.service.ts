import { DOCUMENT, isPlatformBrowser } from "@angular/common";
import {
  afterNextRender,
  DestroyRef,
  inject,
  Injectable,
  Injector,
  PLATFORM_ID,
  signal,
} from "@angular/core";

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
 * The circle a theme switch grows from `from` (the button's box, in viewport
 * pixels): centred on it, and large enough to reach the viewport's farthest
 * corner.
 */
export function revealCircle(
  from: Pick<DOMRect, "left" | "top" | "width" | "height">,
  width: number,
  height: number,
): { x: number; y: number; r: number } {
  const x = from.left + from.width / 2;
  const y = from.top + from.height / 2;
  return { x, y, r: Math.hypot(Math.max(x, width - x), Math.max(y, height - y)) };
}

/**
 * Light or dark. index.html's inline `theme-init` script applies the saved
 * choice, or else the system setting, before the first paint; this service
 * reads what it applied and switches it. The server always renders dark, so
 * anything that differs by theme is switched in CSS (`[data-theme]`) rather
 * than in markup, which keeps hydration identical.
 *
 * A switch from a button grows the new theme from it in a circle (a view
 * transition of type `theme`, styled in styles.css), where the browser has
 * typed view transitions and the visitor has not asked for reduced motion.
 * Anywhere else, and from the command palette, it applies at once.
 *
 * With no saved choice the site follows the system setting as it changes.
 */
@Injectable({ providedIn: "root" })
export class ThemeService {
  private readonly doc = inject(DOCUMENT);
  private readonly injector = inject(Injector);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  private readonly _theme = signal<Theme>(this.current());
  readonly theme = this._theme.asReadonly();

  /** The theme a running transition is switching to, until it has. */
  private switchingTo: Theme | null = null;

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

  /** `from`: the button pressed, which the new theme grows from. */
  toggle(from?: Element): void {
    const shown = this.switchingTo ?? this._theme();
    this.set(shown === "dark" ? "light" : "dark", from);
  }

  /** An explicit choice: applied now (growing from `from`) and remembered for later visits. */
  set(theme: Theme, from?: Element): void {
    if (theme !== (this.switchingTo ?? this._theme())) this.switchTo(theme, from);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // Storage may be blocked; the choice then lasts for this page view.
    }
  }

  private switchTo(theme: Theme, from?: Element): void {
    const doc = this.doc;
    const animate =
      from &&
      typeof ViewTransition !== "undefined" &&
      "types" in ViewTransition.prototype &&
      !globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (!animate) {
      this.apply(theme);
      return;
    }

    const { x, y, r } = revealCircle(
      from.getBoundingClientRect(),
      globalThis.innerWidth,
      globalThis.innerHeight,
    );
    this.switchingTo = theme;
    const transition = doc.startViewTransition({
      types: ["theme"],
      // The new picture is taken once Angular has rendered the switch (the
      // pressed state, the grid's colour), as the router does for pages.
      update: () => {
        this.switchingTo = null;
        this.apply(theme);
        return new Promise<void>((resolve) => {
          afterNextRender({ read: () => setTimeout(resolve) }, { injector: this.injector });
        });
      },
    });
    transition.ready
      .then(() => {
        doc.documentElement.animate(
          { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${r}px at ${x}px ${y}px)`] },
          // --dur-4 and --ease-out (styles/motion.css).
          {
            duration: 360,
            easing: "cubic-bezier(0.2, 0, 0, 1)",
            pseudoElement: "::view-transition-new(root)",
          },
        );
      })
      // Skipped (another transition took over): the theme is applied all the same.
      .catch(() => undefined);
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
