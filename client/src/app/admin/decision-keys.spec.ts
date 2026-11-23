import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { decisionKey, focusOnLeaving } from "./decision-keys";

/** Two lists of one page: lessons (one waiting) and entries (two waiting), with done lines. */
const PAGE = `
  <main>
    <h1 id="title" tabindex="-1">Assistant</h1>
    <section id="root">
      <section data-queue>
        <p id="lessons-done" tabindex="-1" data-queue-done>No lesson waits for you.</p>
        <article data-decide data-waiting>
          <h3 id="l1" data-decide-heading tabindex="-1">Lesson one</h3>
          <input id="l1-ref" data-decide-field />
          <button id="l1-a" data-key="a">Apply</button>
          <button id="l1-x" data-key="x">Retire</button>
        </article>
      </section>
      <section data-queue>
        <p id="entries-done" tabindex="-1" data-queue-done>No journal entry waits.</p>
        <article data-decide data-waiting>
          <h3 id="e1" data-decide-heading tabindex="-1">Entry one</h3>
          <textarea id="e1-cause" data-decide-field></textarea>
          <input id="e1-doc" />
          <button id="e1-a" data-key="a">Accept</button>
        </article>
        <article data-decide>
          <h3 id="e2" data-decide-heading tabindex="-1">Entry two</h3>
        </article>
        <article data-decide data-waiting>
          <h3 id="e3" data-decide-heading tabindex="-1">Entry three</h3>
          <button id="e3-x" data-key="x">Retire</button>
        </article>
      </section>
    </section>
  </main>
`;

const byId = (id: string): HTMLElement => {
  const el = document.getElementById(id);
  if (!el) {
    throw new Error(`no #${id}`);
  }
  return el;
};

/** The item of heading `id` waits for a decision, or no longer does. */
const waits = (id: string, on: boolean) =>
  byId(id).closest("article")?.toggleAttribute("data-waiting", on);

/** A key pressed where the focus is: whether the queue took it. */
function press(key: string, init: KeyboardEventInit = {}): boolean {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
  const target = document.activeElement ?? document.body;
  let taken = false;
  const listen = (e: Event) => {
    if (e instanceof KeyboardEvent) {
      taken = decisionKey(e, byId("root"));
    }
  };
  document.addEventListener("keydown", listen);
  target.dispatchEvent(event);
  document.removeEventListener("keydown", listen);
  return taken;
}

describe("decision keys", () => {
  beforeEach(() => {
    document.body.innerHTML = PAGE;
  });
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("walks the items' headings with J and K, from outside them the first", () => {
    byId("title").focus();
    expect(press("j")).toBe(true);
    expect(document.activeElement?.id).toBe("l1");
    press("j");
    press("j");
    expect(document.activeElement?.id).toBe("e2");
    press("k");
    expect(document.activeElement?.id).toBe("e1");
    byId("e3").focus();
    press("j");
    expect(document.activeElement?.id).toBe("e3");
  });

  it("goes from a done line to the first item after it, or back to the last before it", () => {
    byId("entries-done").focus();
    press("j");
    expect(document.activeElement?.id).toBe("e1");
    byId("entries-done").focus();
    press("k");
    expect(document.activeElement?.id).toBe("l1");
  });

  it("presses the item's own A and X buttons, and leaves a key with no button there", () => {
    const apply = vi.fn();
    const retire = vi.fn();
    byId("l1-a").addEventListener("click", apply);
    byId("l1-x").addEventListener("click", retire);
    byId("l1").focus();
    expect(press("a")).toBe(true);
    expect(press("x")).toBe(true);
    expect(apply).toHaveBeenCalledTimes(1);
    expect(retire).toHaveBeenCalledTimes(1);
    byId("e2").focus();
    expect(press("a")).toBe(false);
    byId("title").focus();
    expect(press("x")).toBe(false);
  });

  it("types in a field, where Ctrl Enter presses A only in the item's own fields", () => {
    const accept = vi.fn();
    byId("e1-a").addEventListener("click", accept);
    byId("e1-cause").focus();
    expect(press("a")).toBe(false);
    expect(press("Enter", { ctrlKey: true })).toBe(true);
    expect(press("Enter", { metaKey: true })).toBe(true);
    byId("e1-doc").focus();
    expect(press("Enter", { ctrlKey: true })).toBe(false);
    byId("e1").focus();
    expect(press("Enter", { ctrlKey: true })).toBe(true);
    expect(accept).toHaveBeenCalledTimes(3);
  });

  it("gives the focus to the next item that waits, else the one before, else the done line", () => {
    const afterFirst = focusOnLeaving("e1");
    waits("e1", false);
    afterFirst();
    expect(document.activeElement?.id).toBe("e3");

    waits("e1", true);
    const afterLast = focusOnLeaving("e3");
    waits("e3", false);
    afterLast();
    expect(document.activeElement?.id).toBe("e1");

    const afterAll = focusOnLeaving("e1");
    waits("e1", false);
    afterAll();
    expect(document.activeElement?.id).toBe("entries-done");
  });
});
