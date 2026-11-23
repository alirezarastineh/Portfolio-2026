import { isSaveNextKey, isShortcutTarget } from "./components/shortcut-sheet.component";
import { stepFrom } from "./inbox";

/**
 * The decision queues' keys (plan 5, U21): the content agent's proposals, FAQ proposals, journal
 * entries and lessons share one pattern, marked in their templates:
 * - each list `data-queue`, its done line `data-queue-done` (`tabindex="-1"`);
 * - each item `data-decide`, plus `data-waiting` while it waits for a decision;
 * - the item's heading `data-decide-heading` (with an id and `tabindex="-1"`);
 * - the buttons A and X press `data-key="a"` and `data-key="x"`;
 * - the fields where Ctrl/⌘ Enter means A `data-decide-field`.
 * A key presses the button that shows it, so a key and a click never differ: a stop says why, a busy
 * button does nothing, an item without that button ignores the key.
 */

const headingOf = (item: Element): HTMLElement | null =>
  item.querySelector<HTMLElement>("[data-decide-heading]");

/** J, K, A, X and Ctrl/⌘ Enter on `root`'s items: true when the key was taken. */
export function decisionKey(event: KeyboardEvent, root: HTMLElement): boolean {
  const target = event.target instanceof Element ? event.target : null;
  const found = target?.closest<HTMLElement>("[data-decide]");
  const item = found && root.contains(found) ? found : null;
  const field = item && target?.matches("[data-decide-field]") ? target : undefined;
  if (isSaveNextKey(event, field)) {
    return press(event, item, "a");
  }
  if (!isShortcutTarget(event)) {
    return false;
  }
  const key = event.key.toLowerCase();
  if (key === "a" || key === "x") {
    return press(event, item, key);
  }
  if (key !== "j" && key !== "k") {
    return false;
  }
  const next = stepTo(root, item, key === "j" ? 1 : -1);
  if (!next) {
    return false;
  }
  event.preventDefault();
  next.focus();
  return true;
}

function press(event: KeyboardEvent, item: HTMLElement | null, key: "a" | "x"): boolean {
  const button = item?.querySelector<HTMLButtonElement>(`[data-key="${key}"]`);
  if (!button) {
    return false;
  }
  event.preventDefault();
  button.click();
  return true;
}

/**
 * The heading J (1) or K (-1) moves to: the next or previous item from the one in focus; from
 * between the lists (a done line, a filter), the first item after the focus or the last before it;
 * from outside them all, the first item.
 */
function stepTo(root: HTMLElement, item: HTMLElement | null, by: 1 | -1): HTMLElement | null {
  const headings = [...root.querySelectorAll("[data-decide]")].flatMap((el) => headingOf(el) ?? []);
  if (item) {
    return stepFrom(headings, headingOf(item)?.id ?? null, by);
  }
  // `querySelectorAll` lists in document order, so the focus falls among the items where it sits.
  const marks = [...root.querySelectorAll<HTMLElement>("[data-decide], :focus")];
  const at = marks.findIndex((el) => !("decide" in el.dataset));
  if (at < 0) {
    return stepFrom(headings, null, by);
  }
  const near = by === 1 ? marks.at(at + 1) : marks.slice(0, at).at(-1);
  return near ? headingOf(near) : null;
}

/**
 * Taken before a decision on the item whose heading is `id`, run after the render that shows it,
 * once the item has left its queue: the next item there that still waits takes the focus (after
 * it, else before it), else the queue's done line, else the item's own heading.
 */
export function focusOnLeaving(id: string): () => void {
  const item = document.getElementById(id)?.closest("[data-decide]");
  const queue = item?.closest("[data-queue]");
  const waiting = queue ? [...queue.querySelectorAll("[data-decide][data-waiting]")] : [];
  const at = item ? waiting.indexOf(item) : -1;
  const order = [...waiting.slice(at + 1), ...waiting.slice(0, Math.max(at, 0)).reverse()];
  const ids = order.flatMap((el) => headingOf(el)?.id ?? []);
  return () => {
    const next = ids
      .map((n) => document.getElementById(n))
      .find((el) => el?.closest<HTMLElement>("[data-decide]")?.dataset["waiting"] !== undefined);
    const done = queue?.querySelector<HTMLElement>("[data-queue-done]");
    (next ?? done ?? document.getElementById(id))?.focus();
  };
}
