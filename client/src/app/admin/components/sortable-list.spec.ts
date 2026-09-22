import { TestBed } from "@angular/core/testing";
import { beforeEach, describe, expect, it } from "vitest";

import { SortableListComponent } from "./sortable-list.component";

interface Row {
  id: string;
  name: string;
}

const ROWS: Row[] = [
  { id: "a", name: "Alpha" },
  { id: "b", name: "Bravo" },
  { id: "c", name: "Charlie" },
];

/** Reaches the protected handler the template binds to. */
interface Internals {
  onHandleKey(event: KeyboardEvent, index: number): void;
  onDrop(event: { previousIndex: number; currentIndex: number }): void;
}

function setup() {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({});

  const fixture = TestBed.createComponent<SortableListComponent<Row>>(SortableListComponent);
  fixture.componentRef.setInput("items", [...ROWS]);
  fixture.componentRef.setInput("trackBy", (row: Row) => row.id);
  fixture.componentRef.setInput("label", "row");

  const emitted: Row[][] = [];
  fixture.componentInstance.reordered.subscribe((next) => emitted.push(next));
  fixture.detectChanges();

  return {
    fixture,
    emitted,
    internals: fixture.componentInstance as unknown as Internals,
  };
}

const key = (k: string, altKey: boolean) => new KeyboardEvent("keydown", { key: k, altKey });
const ids = (rows: Row[]) => rows.map((r) => r.id);

describe("SortableListComponent keyboard reordering", () => {
  let ctx: ReturnType<typeof setup>;

  beforeEach(() => {
    ctx = setup();
  });

  /**
   * `cdkDrag` is mouse-only. Without Alt+arrows, reordering the list that
   * controls published page order would be impossible with a keyboard — a real
   * accessibility failure, not a nicety.
   */
  it("moves an item down with Alt+ArrowDown", () => {
    ctx.internals.onHandleKey(key("ArrowDown", true), 0);
    expect(ids(ctx.emitted[0])).toEqual(["b", "a", "c"]);
  });

  it("moves an item up with Alt+ArrowUp", () => {
    ctx.internals.onHandleKey(key("ArrowUp", true), 2);
    expect(ids(ctx.emitted[0])).toEqual(["a", "c", "b"]);
  });

  it("does not move past the start of the list", () => {
    ctx.internals.onHandleKey(key("ArrowUp", true), 0);
    expect(ctx.emitted).toEqual([]);
  });

  it("does not move past the end of the list", () => {
    ctx.internals.onHandleKey(key("ArrowDown", true), 2);
    expect(ctx.emitted).toEqual([]);
  });

  /** Plain arrows must still scroll the page as the user expects. */
  it("ignores arrow keys without Alt", () => {
    ctx.internals.onHandleKey(key("ArrowDown", false), 0);
    expect(ctx.emitted).toEqual([]);
  });

  it("ignores other keys", () => {
    ctx.internals.onHandleKey(key("Enter", true), 0);
    expect(ctx.emitted).toEqual([]);
  });

  it("does not mutate the input array in place", () => {
    ctx.internals.onHandleKey(key("ArrowDown", true), 0);
    expect(ids(ctx.fixture.componentInstance.items())).toEqual(["a", "b", "c"]);
  });
});

describe("SortableListComponent drag reordering", () => {
  it("emits the reordered array on drop", () => {
    const ctx = setup();
    ctx.internals.onDrop({ previousIndex: 2, currentIndex: 0 });
    expect(ids(ctx.emitted[0])).toEqual(["c", "a", "b"]);
  });

  /** A drop back onto the same slot is not a change; emitting would save needlessly. */
  it("stays quiet when the position did not change", () => {
    const ctx = setup();
    ctx.internals.onDrop({ previousIndex: 1, currentIndex: 1 });
    expect(ctx.emitted).toEqual([]);
  });
});
