import { signal } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { beforeEach, describe, expect, it } from "vitest";

import { LanguageService } from "../services/language.service";
import { AskLauncherService } from "./ask-launcher.service";

function launcherOn(page: string): AskLauncherService {
  TestBed.configureTestingModule({
    providers: [{ provide: LanguageService, useValue: { page: signal(page) } }],
  });
  return TestBed.inject(AskLauncherService);
}

describe("AskLauncherService", () => {
  beforeEach(() => TestBed.resetTestingModule());

  it("on home, asks the About terminal: focus, then the question once", () => {
    const launcher = launcherOn("/");
    launcher.ask("  What did he build?  ", "hero");
    expect(launcher.focusPending()).toBe(true);
    expect(launcher.sheetOpen()).toBe(false);
    expect(launcher.takeFocus()).toBe(true);
    expect(launcher.takeQuestion()).toBe("What did he build?");
    expect(launcher.takeQuestion()).toBeNull();
    expect(launcher.takeSource()).toBe("hero");
    expect(launcher.takeSource()).toBe("terminal");
  });

  it("elsewhere, opens the sheet with the question", () => {
    const launcher = launcherOn("/work/project-one");
    launcher.ask("Which stack?", "starter");
    expect(launcher.sheetOpen()).toBe(true);
    expect(launcher.sheetRequested()).toBe(true);
    expect(launcher.pendingQuestion()).toBe("Which stack?");
    expect(launcher.takeSource()).toBe("starter");
  });

  it("ignores an empty question", () => {
    const launcher = launcherOn("/");
    launcher.ask("   ", "hero");
    expect(launcher.focusPending()).toBe(false);
    expect(launcher.pendingQuestion()).toBeNull();
  });
});
