import { describe, expect, it } from "vitest";

import { isRailKey, isShortcutTarget } from "./shortcut-sheet.component";

/** A key pressed with focus on `target`. */
function press(target: Element, init: KeyboardEventInit): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { bubbles: true, ...init });
  Object.defineProperty(event, "target", { value: target });
  return event;
}

describe("the admin's keys", () => {
  const page = document.createElement("main");
  const field = document.createElement("input");

  it("takes [ for the rail as typed, and with AltGr as a German layout types it", () => {
    expect(isRailKey(press(page, { key: "[" }))).toBe(true);
    // AltGr+8: Windows reports Ctrl and Alt with it.
    expect(
      isRailKey(press(page, { key: "[", ctrlKey: true, altKey: true, modifierAltGraph: true })),
    ).toBe(true);
  });

  it("leaves [ alone in a field, with Ctrl or Alt alone, and with Cmd", () => {
    expect(isRailKey(press(field, { key: "[" }))).toBe(false);
    expect(isRailKey(press(page, { key: "[", ctrlKey: true }))).toBe(false);
    expect(isRailKey(press(page, { key: "[", altKey: true }))).toBe(false);
    expect(isRailKey(press(page, { key: "[", metaKey: true }))).toBe(false);
  });

  it("still takes plain letters outside a field only", () => {
    expect(isShortcutTarget(press(page, { key: "?" }))).toBe(true);
    expect(isShortcutTarget(press(field, { key: "?" }))).toBe(false);
    expect(isShortcutTarget(press(page, { key: "j", ctrlKey: true }))).toBe(false);
  });
});
