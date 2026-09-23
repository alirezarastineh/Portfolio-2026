import { DOCUMENT } from "@angular/common";
import { TestBed } from "@angular/core/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { applyTheme, THEME_STORAGE_KEY, ThemeService } from "./theme.service";

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
