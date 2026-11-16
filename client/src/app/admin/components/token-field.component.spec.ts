import { Component, signal } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { describe, expect, it } from "vitest";

import { TokenFieldComponent } from "./token-field.component";

@Component({
  imports: [TokenFieldComponent],
  // Bound, not a static `id`: that stays on the host and doubles the field's id.
  template: `<app-token-field
    [id]="'stack'"
    label="Tech stack"
    singular="technology"
    [max]="5"
    [(value)]="items"
  />`,
})
class HostComponent {
  readonly items = signal(["TypeScript", "Python", "Postgres"]);
}

async function setUp() {
  const fixture = TestBed.createComponent(HostComponent);
  fixture.detectChanges();
  await fixture.whenStable();
  const root = fixture.nativeElement as HTMLElement;
  const field = root.querySelector<HTMLInputElement>("#stack")!;
  const tokens = () =>
    Array.from(root.querySelectorAll<HTMLButtonElement>("button.token")).map((b) =>
      b.textContent!.trim(),
    );
  const token = (name: string) =>
    Array.from(root.querySelectorAll<HTMLButtonElement>("button.token")).find(
      (b) => b.textContent!.trim() === name,
    )!;
  const said = () => root.querySelector("#stack-said")!.textContent!.trim();
  const press = async (target: HTMLElement, key: string, init: KeyboardEventInit = {}) => {
    const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
    target.dispatchEvent(event);
    fixture.detectChanges();
    await fixture.whenStable();
    return event;
  };
  const type = async (text: string, key = "Enter") => {
    field.value = text;
    return press(field, key);
  };
  return { fixture, root, field, tokens, token, said, press, type };
}

describe("TokenFieldComponent", () => {
  it("adds on Enter and on a comma, each part of a paste, and keeps what it refused", async () => {
    const { fixture, root, field, tokens, said, type } = await setUp();

    const comma = await type("Rust", ",");
    expect(comma.defaultPrevented).toBe(true);
    expect(tokens()).toEqual(["TypeScript", "Python", "Postgres", "Rust"]);
    expect(said()).toBe("Rust added, 4 of 4.");
    expect(field.value).toBe("");

    await type("python, Go , ,");
    expect(tokens()).toEqual(["TypeScript", "Python", "Postgres", "Rust", "Go"]);
    expect(field.value).toBe("python");
    expect(said()).toBe("Python is already in the list.");
    // Seen too, under the field, until the next keystroke.
    const refused = () => root.querySelector("#stack-refused")?.textContent?.trim() ?? null;
    expect(refused()).toBe("Python is already in the list.");
    expect(field.getAttribute("aria-describedby")).toContain("stack-refused");
    field.dispatchEvent(new Event("input"));
    fixture.detectChanges();
    expect(refused()).toBeNull();

    await type("Deno");
    expect(tokens()).toHaveLength(5);
    expect(said()).toBe("At most 5 technologies.");
    expect(fixture.componentInstance.items()).toEqual([
      "TypeScript",
      "Python",
      "Postgres",
      "Rust",
      "Go",
    ]);
  });

  it("Backspace in the empty field goes to the last token and removes nothing", async () => {
    const { root, field, tokens, token, press } = await setUp();
    field.value = "";
    const event = await press(field, "Backspace");
    expect(event.defaultPrevented).toBe(true);
    await new Promise((resolve) => setTimeout(resolve));
    expect(tokens()).toHaveLength(3);
    expect(root.ownerDocument.activeElement).toBe(token("Postgres"));
  });

  it("Delete or Backspace removes a token, its neighbour takes the focus, the last one leaves it to the field", async () => {
    const { fixture, root, field, tokens, token, said, press } = await setUp();
    await press(token("Python"), "Delete");
    await new Promise((resolve) => setTimeout(resolve));
    expect(tokens()).toEqual(["TypeScript", "Postgres"]);
    expect(said()).toBe("Python removed.");
    expect(root.ownerDocument.activeElement).toBe(token("Postgres"));

    await press(token("Postgres"), "Backspace");
    await press(token("TypeScript"), "Backspace");
    await new Promise((resolve) => setTimeout(resolve));
    expect(tokens()).toEqual([]);
    expect(root.ownerDocument.activeElement).toBe(field);
    expect(fixture.componentInstance.items()).toEqual([]);
  });

  it("Alt with an arrow moves a token and keeps its focus; at the end it stays", async () => {
    const { fixture, root, tokens, token, said, press } = await setUp();
    await press(token("TypeScript"), "ArrowRight", { altKey: true });
    await new Promise((resolve) => setTimeout(resolve));
    expect(tokens()).toEqual(["Python", "TypeScript", "Postgres"]);
    expect(said()).toBe("TypeScript moved to 2 of 3.");
    expect(root.ownerDocument.activeElement).toBe(token("TypeScript"));

    await press(token("TypeScript"), "ArrowDown", { altKey: true });
    await press(token("TypeScript"), "ArrowDown", { altKey: true });
    expect(tokens()).toEqual(["Python", "Postgres", "TypeScript"]);
    await press(token("Python"), "ArrowUp", { altKey: true });
    expect(tokens()).toEqual(["Python", "Postgres", "TypeScript"]);
    expect(fixture.componentInstance.items()).toEqual(["Python", "Postgres", "TypeScript"]);
  });

  it("a value set from outside replaces the tokens; its own emissions do not rebuild them", async () => {
    const { fixture, root, tokens, type } = await setUp();
    const before = root.querySelector("button.token");
    await type("Rust");
    expect(root.querySelector("button.token")).toBe(before);

    fixture.componentInstance.items.set(["Angular"]);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(tokens()).toEqual(["Angular"]);
  });

  it("names its parts: the field by its label and hint, each × by its token, the list by the label", async () => {
    const { root, field } = await setUp();
    expect(root.querySelector(`label[for="stack"]`)?.textContent?.trim()).toBe("Tech stack");
    expect(field.getAttribute("aria-describedby")).toContain("stack-hint");
    expect(root.querySelector("ul")?.getAttribute("aria-label")).toBe("Tech stack");
    const remove = root.querySelector<HTMLButtonElement>(`button[aria-label="Remove Python"]`)!;
    expect(remove.tabIndex).toBe(-1);
    expect(root.querySelector("#stack-said")?.getAttribute("aria-live")).toBe("polite");
  });
});
