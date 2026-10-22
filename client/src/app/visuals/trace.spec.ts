import { describe, expect, it } from "vitest";

import { ASK_ENTRY_COPY } from "../ask/ask-entry-copy";
import { duration, traceView } from "./trace";

const en = ASK_ENTRY_COPY.en;

describe("duration", () => {
  it("prints milliseconds under a second, seconds with one decimal above", () => {
    expect(duration(12, "en")).toBe("12 ms");
    expect(duration(1420, "en")).toBe("1.4 s");
    expect(duration(1420, "de")).toBe("1,4 s");
  });
});

describe("traceView", () => {
  it("shows the example, labelled as one, until there is a real answer", () => {
    const view = traceView(en, "en", null);
    expect(view.live).toBe(false);
    expect(view.caption).toBe("example trace");
    expect(view.rows.map((r) => r.step)).toEqual([
      "query",
      "route",
      "retrieve",
      "generate",
      "cite",
      "answer",
    ]);
    expect(view.rows[0]!.detail).toBe(en.starters[0]);
    // The example reads as a real answer does (visitor plan V12).
    expect(view.rows[2]!.detail).toBe("search_portfolio · 1 lookup");
    expect(view.rows.at(-1)).toMatchObject({ time: "1.4 s", bar: { left: 0, width: 100 } });
  });

  it("names a move to the deep model, counts every lookup and the references removed (visitor plan V12)", () => {
    const view = traceView(ASK_ENTRY_COPY.de, "de", {
      id: 4,
      question: "Atlas oder Borealis?",
      route: "deep",
      escalation: "projects-fetched",
      model: "m-2",
      fallback: false,
      ttftMs: 400,
      totalMs: 1_000,
      tools: ["get_document"],
      lookups: 1,
      sources: 2,
      removed: 1,
      cachedPct: null,
    });
    const [, route, retrieve, , cite] = view.rows;
    expect(route!.detail).toBe("lite → deep · zwei Projekte gelesen");
    expect(retrieve!.detail).toBe("get_document · 1 Abfrage");
    expect(cite!.detail).toBe("2 geprüft · 1 entfernt");
  });

  it("replays a real answer with only what its metadata says", () => {
    const view = traceView(en, "en", {
      id: 3,
      question: "What did he build?",
      route: "deep",
      escalation: null,
      model: "m-1",
      fallback: true,
      ttftMs: 500,
      totalMs: 2000,
      tools: ["search_portfolio", "get_document"],
      lookups: 2,
      sources: 2,
      removed: 0,
      cachedPct: 88,
    });
    expect(view).toMatchObject({ id: 3, live: true, caption: "your last question · 2.0 s" });
    expect(view.summary).toBe("Your last question was answered by m-1 in 2.0 s.");
    const [query, route, retrieve, generate, cite, answer] = view.rows;
    expect(query).toMatchObject({ detail: "What did he build?", bar: null });
    expect(route).toMatchObject({ detail: "deep", bar: null });
    expect(retrieve).toMatchObject({
      detail: "search_portfolio, get_document · 2 lookups",
      bar: null,
    });
    expect(generate).toMatchObject({
      detail: "m-1 · fallback",
      time: "1.5 s",
      bar: { left: 25, width: 75 },
    });
    expect(cite).toMatchObject({ detail: "2 verified" });
    expect(answer).toMatchObject({ detail: "88% cached", time: "2.0 s" });
  });

  it("draws no timeline for an answer without timings", () => {
    const view = traceView(en, "en", {
      id: 1,
      question: "hi",
      route: null,
      escalation: null,
      model: null,
      fallback: false,
      ttftMs: null,
      totalMs: null,
      tools: [],
      lookups: 0,
      sources: 0,
      removed: 0,
      cachedPct: null,
    });
    expect(view.caption).toBe("your last question · –");
    expect(view.rows.every((r) => r.bar === null)).toBe(true);
    expect(view.rows[2]!.detail).toBe("context only");
    expect(view.rows[4]!.detail).toBe("none");
  });
});
