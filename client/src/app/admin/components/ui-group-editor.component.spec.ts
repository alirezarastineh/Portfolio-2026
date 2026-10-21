import { TestBed } from "@angular/core/testing";
import { describe, expect, it, vi } from "vitest";

import { UiSectionService } from "../ui-section.service";
import { UiGroupEditorComponent, type UiFieldDef } from "./ui-group-editor.component";

const FIELDS: UiFieldDef[] = [{ key: "updated", label: "“Last updated” label" }];

function setup() {
  // An answer that arrives at once, as a quick server's can before the page's first check.
  const loadGroup = vi.fn(async () => ({
    value: { en: { updated: "Last updated" }, de: { updated: "Zuletzt aktualisiert" } },
    updatedAt: "2026-10-21T10:00:00.000Z",
  }));
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [{ provide: UiSectionService, useValue: { loadGroup } }],
  });
  // The class alone: when it loads is what this tests, not its fields' editors.
  TestBed.overrideComponent(UiGroupEditorComponent, { set: { template: "", imports: [] } });
  return { loadGroup, fixture: TestBed.createComponent(UiGroupEditorComponent) };
}

const settle = () => new Promise((resolve) => setTimeout(resolve));

/** The microtasks queued so far, and the ones they queue: all that runs before a first check. */
async function microtasks(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

describe("UiGroupEditorComponent", () => {
  it("loads once its inputs are bound, never before (NG0950 in production)", async () => {
    const { loadGroup, fixture } = setup();
    // As a page the router creates: its static attribute is set, and its bound inputs come with
    // the first check, on a later frame. Microtasks run before that frame, timers no sooner.
    fixture.componentRef.setInput("group", "legal");
    await microtasks();
    expect(loadGroup).not.toHaveBeenCalled();

    fixture.componentRef.setInput("title", "Legal labels");
    fixture.componentRef.setInput("fields", FIELDS);
    fixture.detectChanges();
    await settle();
    expect(loadGroup).toHaveBeenCalledExactlyOnceWith("legal");
    expect(fixture.componentInstance.value()).toEqual({
      en: { updated: "Last updated" },
      de: { updated: "Zuletzt aktualisiert" },
    });
  });
});
