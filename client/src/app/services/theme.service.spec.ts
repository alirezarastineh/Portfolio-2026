import { DOCUMENT } from "@angular/common";
import { TestBed } from "@angular/core/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { applyTheme, revealCircle, THEME_STORAGE_KEY, ThemeService } from "./theme.service";

/** A controllable `(prefers-color-scheme: light)`. */
function systemTheme(light: boolean) {
  const listeners = new Set<(event: MediaQueryListEvent) => void>();
  const query = {
    matches: light,
    addEventListener: (_: string, fn: (event: MediaQueryListEvent) => void) => listeners.add(fn),
    removeEventListener: (_: string, fn: (event: MediaQueryListEvent) => void) =>
      listeners.delete(fn),
  };
  vi.stubGlobal("matchMedia", () => query);
  return {
    change(nextLight: boolean) {
      query.matches = nextLight;
      for (const fn of listeners) fn({ matches: nextLight } as MediaQueryListEvent);
    },
  };
}

describe("ThemeService", () => {
  let root: HTMLElement;

  beforeEach(() => {
    TestBed.resetTestingModule();
    root = TestBed.inject(DOCUMENT).documentElement;
    localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    applyTheme(document, "dark");
    localStorage.clear();
  });

  it("starts from what index.html's script applied", () => {
    systemTheme(false);
    applyTheme(document, "light");
    expect(TestBed.inject(ThemeService).theme()).toBe("light");
  });

  it("toggles the attribute and Spartan's class, and remembers the choice", () => {
    systemTheme(false);
    applyTheme(document, "dark");
    const theme = TestBed.inject(ThemeService);

    theme.toggle();
    expect(theme.theme()).toBe("light");
    expect(root.getAttribute("data-theme")).toBe("light");
    expect(root.classList.contains("dark")).toBe(false);
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");

    theme.toggle();
    expect(root.classList.contains("dark")).toBe(true);
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
  });

  it("follows the system setting until the visitor chooses", () => {
    const system = systemTheme(false);
    applyTheme(document, "dark");
    const theme = TestBed.inject(ThemeService);

    system.change(true);
    expect(theme.theme()).toBe("light");

    theme.set("dark");
    system.change(true);
    expect(theme.theme()).toBe("dark");
  });
});

describe("revealCircle", () => {
  it("centres on the button and reaches the viewport's farthest corner", () => {
    const circle = revealCircle({ left: 100, top: 20, width: 40, height: 40 }, 1000, 800);
    expect(circle).toEqual({ x: 120, y: 40, r: Math.hypot(880, 760) });
  });
});

describe("ThemeService, switching from a button", () => {
  /** What a browser with typed view transitions offers, recorded. */
  function viewTransitions() {
    const starts: { types: string[]; update: () => Promise<void> }[] = [];
    vi.stubGlobal(
      "ViewTransition",
      class {
        get types() {
          return new Set<string>();
        }
      },
    );
    Object.defineProperty(document, "startViewTransition", {
      configurable: true,
      value: (options: { types: string[]; update: () => Promise<void> }) => {
        starts.push(options);
        return { ready: Promise.resolve() };
      },
    });
    const animate = vi.fn();
    Object.defineProperty(document.documentElement, "animate", {
      configurable: true,
      value: animate,
    });
    return { starts, animate };
  }

  function button(): HTMLElement {
    const el = document.createElement("button");
    el.getBoundingClientRect = () => ({ left: 100, top: 20, width: 40, height: 40 }) as DOMRect;
    return el;
  }

  function motion(reduced: boolean) {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: reduced && query.includes("reduced-motion"),
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }));
  }

  beforeEach(() => {
    TestBed.resetTestingModule();
    localStorage.clear();
    applyTheme(document, "dark");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    Reflect.deleteProperty(document, "startViewTransition");
    Reflect.deleteProperty(document.documentElement, "animate");
    applyTheme(document, "dark");
    localStorage.clear();
  });

  it("grows the new theme from the button in a `theme` view transition", async () => {
    motion(false);
    const { starts, animate } = viewTransitions();
    const theme = TestBed.inject(ThemeService);

    theme.toggle(button());
    expect(starts).toHaveLength(1);
    expect(starts[0]!.types).toEqual(["theme"]);
    // Remembered at once; shown once the old picture is taken.
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");

    void starts[0]!.update();
    expect(theme.theme()).toBe("light");
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");

    const { x, y, r } = revealCircle(
      { left: 100, top: 20, width: 40, height: 40 },
      globalThis.innerWidth,
      globalThis.innerHeight,
    );
    await vi.waitFor(() => expect(animate).toHaveBeenCalledOnce());
    expect(animate).toHaveBeenCalledWith(
      { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${r}px at ${x}px ${y}px)`] },
      expect.objectContaining({ duration: 360, pseudoElement: "::view-transition-new(root)" }),
    );
  });

  it("toggles from the theme it is switching to, before it is shown", () => {
    motion(false);
    const { starts } = viewTransitions();
    const theme = TestBed.inject(ThemeService);

    theme.toggle(button());
    theme.toggle(button());
    expect(starts).toHaveLength(2);
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    // Choosing what it is already switching to starts nothing new.
    theme.set("dark", button());
    expect(starts).toHaveLength(2);
  });

  it("switches at once under reduced motion", () => {
    motion(true);
    const { starts } = viewTransitions();
    const theme = TestBed.inject(ThemeService);

    theme.toggle(button());
    expect(starts).toHaveLength(0);
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
  });

  it("switches at once from the command palette, which has no button", () => {
    motion(false);
    const { starts } = viewTransitions();
    const theme = TestBed.inject(ThemeService);

    theme.toggle();
    expect(starts).toHaveLength(0);
    expect(theme.theme()).toBe("light");
  });

  it("switches at once where view transitions have no types", () => {
    motion(false);
    const { starts } = viewTransitions();
    vi.stubGlobal("ViewTransition", class {});
    const theme = TestBed.inject(ThemeService);

    theme.toggle(button());
    expect(starts).toHaveLength(0);
    expect(theme.theme()).toBe("light");
  });
});
