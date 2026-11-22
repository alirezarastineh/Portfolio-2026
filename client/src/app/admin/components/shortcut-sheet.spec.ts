import { describe, expect, it } from "vitest";

import { isRailKey, isSaveNextKey, isShortcutTarget } from "./shortcut-sheet.component";

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

  it("leaves the letters to an open menu, which types ahead with them", () => {
    const menu = document.createElement("div");
    menu.setAttribute("role", "menu");
    const item = menu.appendChild(document.createElement("button"));
    item.setAttribute("role", "menuitem");
    expect(isShortcutTarget(press(item, { key: "j" }))).toBe(false);
  });

  it("takes Ctrl or Cmd Enter outside a field and in its own field, never in a dialog", () => {
    const note = document.createElement("textarea");
    expect(isSaveNextKey(press(page, { key: "Enter", ctrlKey: true }), note)).toBe(true);
    expect(isSaveNextKey(press(page, { key: "Enter", metaKey: true }), note)).toBe(true);
    expect(isSaveNextKey(press(note, { key: "Enter", ctrlKey: true }), note)).toBe(true);
    expect(isSaveNextKey(press(field, { key: "Enter", ctrlKey: true }), note)).toBe(false);
    expect(isSaveNextKey(press(page, { key: "Enter" }), note)).toBe(false);
    expect(isSaveNextKey(press(page, { key: "Enter", ctrlKey: true, shiftKey: true }), note)).toBe(
      false,
    );
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    const confirm = dialog.appendChild(document.createElement("button"));
    expect(isSaveNextKey(press(confirm, { key: "Enter", ctrlKey: true }), note)).toBe(false);
  });

  it("takes # as a German layout types it, a key of its own", () => {
    expect(isShortcutTarget(press(page, { key: "#", code: "Backslash" }))).toBe(true);
    expect(isShortcutTarget(press(page, { key: "#", code: "Digit3", shiftKey: true }))).toBe(true);
  });
});
