import { PLATFORM_ID } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";

import { ConfirmService } from "./components/confirm-dialog.component";
import { UnsavedChangesService, unsavedChangesGuard } from "./unsaved-changes.service";

class StubConfirm {
  answer = false;
  asked = 0;
  async ask(): Promise<boolean> {
    this.asked++;
    return this.answer;
  }
}

function setup() {
  TestBed.resetTestingModule();
  const confirm = new StubConfirm();
  TestBed.configureTestingModule({
    providers: [
      { provide: PLATFORM_ID, useValue: "browser" },
      { provide: ConfirmService, useValue: confirm },
    ],
  });
  return { service: TestBed.inject(UnsavedChangesService), confirm };
}

const runGuard = () =>
  TestBed.runInInjectionContext(() =>
    unsavedChangesGuard({} as never, {} as never, {} as never, {} as never),
  ) as Promise<boolean>;

describe("UnsavedChangesService", () => {
  it("tracks dirty editors independently", () => {
    const { service } = setup();

    service.set("seo", true);
    service.set("hero", true);
    expect(service.hasAny()).toBe(true);

    service.clear("seo");
    expect(service.isDirty("seo")).toBe(false);
    expect(service.hasAny()).toBe(true);

    service.clear("hero");
    expect(service.hasAny()).toBe(false);
  });

  it("does not churn when told the same state twice", () => {
    const { service } = setup();
    service.set("seo", true);
    const before = service.hasAny();
    service.set("seo", true);
    expect(service.hasAny()).toBe(before);
  });
});

describe("beforeunload", () => {
  let add: MockInstance<typeof globalThis.addEventListener>;
  let remove: MockInstance<typeof globalThis.removeEventListener>;

  beforeEach(() => {
    add = vi.spyOn(globalThis, "addEventListener");
    remove = vi.spyOn(globalThis, "removeEventListener");
  });

  afterEach(() => {
    add.mockRestore();
    remove.mockRestore();
  });

  /**
   * The in-app guard cannot stop a tab close or reload — the browser prompt
   * covers that. It must only be registered while something is dirty: an
   * always-on handler disables the back/forward cache for the whole panel.
   */
  it("registers only while something is dirty", () => {
    const { service } = setup();
    const registrations = () =>
      add.mock.calls.filter(([type]: [string, ...unknown[]]) => type === "beforeunload").length;

    expect(registrations()).toBe(0);

    service.set("seo", true);
    expect(registrations()).toBe(1);

    // A second dirty editor must not stack another listener.
    service.set("hero", true);
    expect(registrations()).toBe(1);

    service.clearAll();
    expect(
      remove.mock.calls.some(([type]: [string, ...unknown[]]) => type === "beforeunload"),
    ).toBe(true);
  });
});

describe("unsavedChangesGuard", () => {
  it("lets navigation through without asking when nothing is dirty", async () => {
    const { confirm } = setup();
    expect(await runGuard()).toBe(true);
    expect(confirm.asked).toBe(0);
  });

  it("asks, and stays put when the user chooses to stay", async () => {
    const { service, confirm } = setup();
    service.set("seo", true);
    confirm.answer = false;

    expect(await runGuard()).toBe(false);
    expect(confirm.asked).toBe(1);
    // Staying must keep the warning armed for the next attempt.
    expect(service.hasAny()).toBe(true);
  });

  it("clears the dirty state when the user chooses to leave", async () => {
    const { service, confirm } = setup();
    service.set("seo", true);
    confirm.answer = true;

    expect(await runGuard()).toBe(true);
    // Otherwise the next page would warn about edits that were just discarded.
    expect(service.hasAny()).toBe(false);
  });
});
