import { afterEach, describe, expect, it, vi } from "vitest";

import { apiBaseUrl } from "../services/api-base";
import { fetchMap, mapPages, readNext, resetMapCache, type MapPage } from "./portfolio-map";

/** The portfolio's map in the browser (visitor plan V15): read, checked and read next. */

const page = (id: string, extra: Partial<MapPage> = {}): MapPage => ({
  id,
  kind: id.startsWith("post:") ? "post" : id.startsWith("project:") ? "project" : "experience",
  title: id,
  url: id.startsWith("post:") ? `/en/writing/${id}` : `/en/work/${id}`,
  related: [],
  ...extra,
});

describe("mapPages", () => {
  it("keeps each well-formed page and leaves out what is not", () => {
    const pages = mapPages({
      v: 1,
      locale: "en",
      pages: [
        {
          id: "project:atlas@en",
          kind: "project",
          title: "Atlas",
          url: "/en/work/atlas",
          updated: "2026-10-01",
          related: ["experience:northwind@en", 7],
        },
        { id: "faq:x@en", kind: "faq", title: "Q", url: "/en#about", related: [] },
        { id: "post:x@en", kind: "post", title: "X", url: "//evil.example/x", related: [] },
        { id: "post:y@en", kind: "post", title: "Y", url: "https://evil.example", related: [] },
        { id: "post:z@en", kind: "post", title: "", url: "/en/writing/z", related: [] },
        { id: "skills@en", kind: "skills", title: "Skills", url: "/en#skills", updated: "soon" },
        "not a page",
      ],
    });
    expect(pages).toEqual([
      {
        id: "project:atlas@en",
        kind: "project",
        title: "Atlas",
        url: "/en/work/atlas",
        updated: "2026-10-01",
        related: ["experience:northwind@en"],
      },
      { id: "skills@en", kind: "skills", title: "Skills", url: "/en#skills", related: [] },
    ]);
    expect(mapPages(null)).toEqual([]);
    expect(mapPages({ pages: "none" })).toEqual([]);
  });
});

describe("readNext", () => {
  const pages = [
    page("project:atlas@en", { related: ["experience:northwind@en", "project:borealis@en"] }),
    page("experience:northwind@en", { related: ["project:atlas@en"] }),
    page("project:borealis@en"),
    page("post:evals-first@en", { related: ["project:atlas@en"] }),
    page("post:rag@en", { related: ["project:atlas@en"] }),
  ];

  it("takes the page's own related pages first, then the pages that name it, each once", () => {
    expect(readNext(pages, "project:atlas@en").map((p) => p.id)).toEqual([
      "experience:northwind@en",
      "project:borealis@en",
      "post:evals-first@en",
    ]);
    expect(readNext(pages, "project:atlas@en", 5).map((p) => p.id)).toEqual([
      "experience:northwind@en",
      "project:borealis@en",
      "post:evals-first@en",
      "post:rag@en",
    ]);
  });

  it("never names the page itself or a page the map lacks, and is empty for an unknown page", () => {
    const odd = [
      page("project:a@en", { related: ["project:a@en", "project:gone@en"] }),
      page("project:b@en", { related: ["project:a@en"] }),
    ];
    expect(readNext(odd, "project:a@en").map((p) => p.id)).toEqual(["project:b@en"]);
    expect(readNext(odd, "project:none@en")).toEqual([]);
  });
});

describe("fetchMap", () => {
  afterEach(() => resetMapCache());

  it("asks once per language and keeps the answer for the page view", async () => {
    const get = vi.fn(
      async () =>
        new Response(JSON.stringify({ pages: [page("project:atlas@en")] }), { status: 200 }),
    );
    const [a, b] = await Promise.all([fetchMap("en", get), fetchMap("en", get)]);
    expect(a).toEqual([page("project:atlas@en")]);
    expect(b).toBe(a);
    expect(get).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledWith(`${apiBaseUrl()}/v1/ask/map?locale=en`);
    await fetchMap("de", get);
    expect(get).toHaveBeenLastCalledWith(`${apiBaseUrl()}/v1/ask/map?locale=de`);
  });

  it("keeps no failure: the next read asks again", async () => {
    const get = vi
      .fn<(url: string) => Promise<Response>>()
      .mockRejectedValueOnce(new TypeError("offline"))
      .mockResolvedValueOnce(new Response("{}", { status: 429 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ pages: [] }), { status: 200 }));
    expect(await fetchMap("en", get)).toBeNull();
    expect(await fetchMap("en", get)).toBeNull();
    expect(await fetchMap("en", get)).toEqual([]);
    expect(get).toHaveBeenCalledTimes(3);
  });
});
