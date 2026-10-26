import { describe, expect, it } from "vitest";

import { ASK_COPY } from "./ask-copy";
import {
  NEWS_STORAGE_KEY,
  newsCount,
  newsDay,
  newsLines,
  today,
  turnNewsOff,
  turnNewsOn,
  visitNews,
} from "./news";
import type { MapPage } from "./portfolio-map";

/** What's new in this browser (visitor plan V15): off until a yes, then the last visit's day. */

function storage(entries: Record<string, string> = {}) {
  const data = new Map(Object.entries(entries));
  const writes: string[] = [];
  return {
    data,
    writes,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      writes.push(key);
      data.set(key, value);
    },
    removeItem: (key: string) => void data.delete(key),
  };
}

const kept = (s: ReturnType<typeof storage>) =>
  JSON.parse(s.data.get(NEWS_STORAGE_KEY) ?? "null") as unknown;

describe("what's new in this browser (visitor plan V15)", () => {
  it("stays off, writing nothing, until the visitor turns it on", () => {
    const s = storage({ theme: "dark" });
    expect(visitNews("2026-10-23", s)).toBeNull();
    expect(visitNews("2026-10-24", s)).toBeNull();
    // A first visit shows nothing, and nothing was written.
    expect(s.writes).toEqual([]);
    expect([...s.data.keys()]).toEqual(["theme"]);
  });

  it("keeps today's date on the yes, so a first look that day finds nothing new", () => {
    const s = storage();
    turnNewsOn("2026-09-12", s);
    expect(kept(s)).toEqual({ since: "2026-09-12", last: "2026-09-12" });
    expect(visitNews("2026-09-12", s)).toBe("2026-09-12");
  });

  it("starts each later day's visit from the last one, and keeps it all that day", () => {
    const s = storage();
    turnNewsOn("2026-09-12", s);
    expect(visitNews("2026-10-23", s)).toBe("2026-09-12");
    expect(kept(s)).toEqual({ since: "2026-09-12", last: "2026-10-23" });
    // A reload, another tab, the palette: the same day reads the same start.
    expect(visitNews("2026-10-23", s)).toBe("2026-09-12");
    expect(visitNews("2026-10-24", s)).toBe("2026-10-23");
    // A clock set back moves nothing.
    expect(visitNews("2026-10-01", s)).toBe("2026-10-23");
    expect(kept(s)).toEqual({ since: "2026-10-23", last: "2026-10-24" });
  });

  it("forgets the day on `news off`, and reads anything malformed as off", () => {
    const s = storage();
    turnNewsOn("2026-09-12", s);
    turnNewsOff(s);
    expect(s.data.has(NEWS_STORAGE_KEY)).toBe(false);
    for (const raw of ["not json", "null", '{"since":"yesterday","last":"2026-10-23"}', "[]"]) {
      expect(visitNews("2026-10-23", storage({ [NEWS_STORAGE_KEY]: raw }))).toBeNull();
    }
  });

  it("survives blocked storage, and no storage at all", () => {
    const blocked = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    };
    expect(visitNews("2026-10-23", blocked)).toBeNull();
    expect(() => turnNewsOn("2026-10-23", blocked)).not.toThrow();
    expect(() => turnNewsOff(blocked)).not.toThrow();
    expect(visitNews("2026-10-23", null)).toBeNull();
  });

  it("dates in UTC, as the map does", () => {
    expect(today(new Date("2026-10-23T23:30:00-05:00"))).toBe("2026-10-24");
  });
});

describe("what's new, in words", () => {
  const fmtDay = (day: string, locale: string) =>
    new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", timeZone: "UTC" }).format(
      new Date(`${day}T00:00:00Z`),
    );

  it("counts the updates since a day, in either language", () => {
    expect(newsDay("2026-09-12", "en")).toBe(fmtDay("2026-09-12", "en"));
    expect(newsCount(3, "2026-09-12", "en")).toBe(`3 updates since ${fmtDay("2026-09-12", "en")}`);
    expect(newsCount(1, "2026-09-12", "en")).toBe(`1 update since ${fmtDay("2026-09-12", "en")}`);
    expect(newsCount(2, "2026-09-12", "de")).toBe(
      `2 Neuerungen seit ${fmtDay("2026-09-12", "de")}`,
    );
  });

  it("lists each page with its day, kind and link, then asks for one summary of them", () => {
    const updates: MapPage[] = [
      {
        id: "post:rag@en",
        kind: "post",
        title: "Shipping RAG",
        url: "/en/writing/rag",
        updated: "2026-10-20",
        related: [],
      },
      {
        id: "project:atlas@en",
        kind: "project",
        title: "Atlas",
        url: "/en/work/atlas",
        updated: "2026-10-02",
        related: [],
      },
      {
        id: "project:tool@en",
        kind: "project",
        title: "A tool",
        url: "/en#projects",
        updated: "2026-10-01",
        related: [],
      },
    ];
    const lines = newsLines(updates, "2026-09-12", ASK_COPY.en, "en");
    expect(lines[0]).toEqual({
      text: `3 updates since ${fmtDay("2026-09-12", "en")}`,
      tone: "accent",
    });
    expect(lines.slice(1, 4)).toEqual([
      {
        label: fmtDay("2026-10-20", "en"),
        text: "Shipping RAG · post",
        href: "/en/writing/rag",
        internal: true,
      },
      {
        label: fmtDay("2026-10-02", "en"),
        text: "Atlas · case study",
        href: "/en/work/atlas",
        internal: true,
      },
      {
        label: fmtDay("2026-10-01", "en"),
        text: "A tool · project",
        href: "/en#projects",
        internal: true,
      },
    ]);
    expect(lines[4]).toEqual({
      text: "summarize them ›",
      ask: "Summarize what is new on these pages: Shipping RAG, Atlas, A tool.",
    });
    expect(newsLines([], "2026-09-12", ASK_COPY.de, "de")).toEqual([
      { text: `Nichts Neues seit ${fmtDay("2026-09-12", "de")}.`, tone: "dim" },
    ]);
  });
});
