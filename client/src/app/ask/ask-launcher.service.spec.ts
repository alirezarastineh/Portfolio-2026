import { TestBed } from "@angular/core/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AskLauncherService } from "./ask-launcher.service";

describe("AskLauncherService", () => {
  beforeEach(() => TestBed.resetTestingModule());

  it("opens the panel with the question, on every page, and hands both over once (plan 4 U10)", () => {
    const launcher = TestBed.inject(AskLauncherService);
    launcher.ask("  What did he build?  ", "hero");
    expect(launcher.sheetOpen()).toBe(true);
    expect(launcher.sheetRequested()).toBe(true);
    expect(launcher.takeFocus()).toBe(true);
    expect(launcher.takeFocus()).toBe(false);
    expect(launcher.takeQuestion()).toBe("What did he build?");
    expect(launcher.takeQuestion()).toBeNull();
    expect(launcher.takeSource()).toBe("hero");
    expect(launcher.takeSource()).toBe("terminal");
  });

  it("hands over what a reader pointed at with the question, once (visitor plan V9)", () => {
    const launcher = TestBed.inject(AskLauncherService);
    const about = { focus: { kind: "section" as const, id: "problem" }, label: "Problem" };
    launcher.ask("Explain this section", "section", about);
    expect(launcher.takeQuestion()).toBe("Explain this section");
    expect(launcher.takeAbout()).toEqual(about);
    expect(launcher.takeAbout()).toBeNull();
    // A question without one leaves none behind.
    launcher.ask("Which stack?", "starter");
    expect(launcher.takeAbout()).toBeNull();
  });

  it("puts a shared link's question in the prompt, never as one to send (visitor plan V17)", () => {
    const launcher = TestBed.inject(AskLauncherService);
    launcher.prefill("  Is he available?  ", "link");
    expect(launcher.sheetOpen()).toBe(true);
    expect(launcher.takeQuestion()).toBeNull();
    expect(launcher.takeDraft()).toBe("Is he available?");
    expect(launcher.takeDraft()).toBeNull();
    expect(launcher.takeSource()).toBe("link");
    launcher.prefill("   ", "link");
    expect(launcher.takeDraft()).toBeNull();
  });

  it("ignores an empty question", () => {
    const launcher = TestBed.inject(AskLauncherService);
    launcher.ask("   ", "hero");
    expect(launcher.sheetOpen()).toBe(false);
    expect(launcher.takeFocus()).toBe(false);
    expect(launcher.takeQuestion()).toBeNull();
  });

  describe("the panel's width (plan 4 U8)", () => {
    let onChange: (event: { matches: boolean }) => void = () => undefined;
    beforeEach(() => {
      // jsdom has no matchMedia: below 1024px, until the window turns.
      window.matchMedia = ((query: string) => ({
        matches: query === "(width < 64rem)",
        addEventListener: (_: string, listener: typeof onChange) => (onChange = listener),
      })) as unknown as typeof window.matchMedia;
    });
    afterEach(() => Reflect.deleteProperty(window, "matchMedia"));

    it("steps aside for the page only where it covers the page, below 1024px", () => {
      const launcher = TestBed.inject(AskLauncherService);
      expect(launcher.narrow()).toBe(true);
      launcher.openSheet("button");
      launcher.closeIfSheet();
      expect(launcher.sheetOpen()).toBe(false);

      // Turned to 1024px or wider: beside the page, it stays.
      onChange({ matches: false });
      launcher.openSheet("button");
      launcher.closeIfSheet();
      expect(launcher.sheetOpen()).toBe(true);
    });

    it("puts a visible Turnstile check in the panel while it is open, elsewhere nowhere given", () => {
      const launcher = TestBed.inject(AskLauncherService);
      const host = document.createElement("div");
      expect(launcher.checkHost()).toBeUndefined();
      launcher.turnstileHost = host;
      expect(launcher.checkHost()).toBeUndefined();
      launcher.openSheet("button");
      expect(launcher.checkHost()).toBe(host);
      launcher.closeSheet();
      expect(launcher.checkHost()).toBeUndefined();
    });
  });
});
