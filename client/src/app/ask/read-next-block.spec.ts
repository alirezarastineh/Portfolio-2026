import { Component, PLATFORM_ID, signal } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { Router } from "@angular/router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { apiBaseUrl } from "../services/api-base";
import { LanguageService } from "../services/language.service";
import { AskLauncherService } from "./ask-launcher.service";
import type { MapPage } from "./portfolio-map";
import { resetMapCache } from "./portfolio-map";
import { injectReadNext } from "./read-next";
import { kindOf, readNextBlock } from "./read-next-block";

/** Read next at an article's end (visitor plan V15): built in the browser only, from the map. */

const BOREALIS: MapPage = {
  id: "project:borealis@en",
  kind: "project",
  title: "Borealis",
  url: "/en/work/borealis",
  updated: "2026-10-01",
  related: [],
};
const NORTHWIND: MapPage = {
  id: "experience:northwind@en",
  kind: "experience",
  title: "Senior AI Engineer — Northwind Labs",
  url: "/en#experience",
  updated: "2026-10-22",
  related: [],
};
const ATLAS = { id: "project:atlas@en", title: "Atlas" };

const month = (day: string) =>
  new Intl.DateTimeFormat("en", { month: "short", year: "numeric", timeZone: "UTC" }).format(
    new Date(`${day}T00:00:00Z`),
  );

describe("readNextBlock", () => {
  it("names each page's kind, dates what dates itself, and links it", () => {
    const nav = readNextBlock(document, [BOREALIS, NORTHWIND], ATLAS, "en", {
      open: vi.fn(),
      ask: vi.fn(),
    });
    expect(nav.tagName).toBe("NAV");
    expect(nav.getAttribute("aria-labelledby")).toBe("read-next-title");
    expect(nav.querySelector("h2#read-next-title")!.textContent).toBe("Read next");
    const items = [...nav.querySelectorAll("li.read-next-item")];
    expect(items.map((i) => i.querySelector(".read-next-kind")!.textContent)).toEqual([
      `case study · updated ${month("2026-10-01")}`,
      // The publish dates an experience entry: no date of its own is claimed.
      "experience",
    ]);
    expect(items.map((i) => i.querySelector("a")!.getAttribute("href"))).toEqual([
      "/en/work/borealis",
      "/en#experience",
    ]);
    // Each "How do they connect?" is described by the page it is about.
    const button = items[1]!.querySelector("button")!;
    expect(button.textContent).toBe("How do they connect?");
    expect(nav.querySelector(`#${button.getAttribute("aria-describedby")}`)!.textContent).toBe(
      NORTHWIND.title,
    );
  });

  it("opens a page through the router on a plain click only, and asks how the two connect", () => {
    const open = vi.fn();
    const ask = vi.fn();
    const nav = readNextBlock(document, [BOREALIS], ATLAS, "en", { open, ask });
    const link = nav.querySelector("a")!;
    const plain = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 });
    link.dispatchEvent(plain);
    expect(plain.defaultPrevented).toBe(true);
    expect(open).toHaveBeenCalledWith("/en/work/borealis");
    const newTab = new MouseEvent("click", { bubbles: true, cancelable: true, ctrlKey: true });
    link.dispatchEvent(newTab);
    expect(newTab.defaultPrevented).toBe(false);
    expect(open).toHaveBeenCalledTimes(1);

    nav.querySelector("button")!.click();
    expect(ask).toHaveBeenCalledWith("How do Atlas and Borealis connect?");
    const de = readNextBlock(document, [BOREALIS], ATLAS, "de", { open, ask });
    de.querySelector("button")!.click();
    expect(ask).toHaveBeenLastCalledWith("Wie hängen Atlas und Borealis zusammen?");
    expect(de.querySelector("h2")!.textContent).toBe("Weiterlesen");
  });

  it("tells a case study from a project shown on home", () => {
    expect(kindOf(BOREALIS)).toBe("case-study");
    expect(kindOf({ kind: "project", url: "/en#projects" })).toBe("project");
    expect(kindOf({ kind: "post", url: "/en/writing/x" })).toBe("post");
  });
});

@Component({
  selector: "app-article-host",
  template: `<article>
    <div class="case-flow"><p>Text.</p></div>
    <footer>end</footer>
  </article>`,
})
class ArticleHostComponent {
  constructor() {
    injectReadNext(() => {
      const article = document.querySelector("article");
      return article ? { article, ...ATLAS } : null;
    });
  }
}

describe("injectReadNext", () => {
  const ask = vi.fn();
  const navigateByUrl = vi.fn();
  const fetches: string[] = [];
  /** The observers made, so a test can bring the article's end near the screen. */
  let observed: ((entries: { isIntersecting: boolean }[]) => void)[] = [];

  const render = (platform: "browser" | "server") => {
    TestBed.configureTestingModule({
      providers: [
        { provide: PLATFORM_ID, useValue: platform },
        { provide: LanguageService, useValue: { lang: signal("en") } },
        { provide: AskLauncherService, useValue: { ask } },
        { provide: Router, useValue: { navigateByUrl } },
      ],
    });
    const fixture = TestBed.createComponent(ArticleHostComponent);
    document.body.append(fixture.nativeElement as HTMLElement);
    fixture.detectChanges();
    return fixture;
  };

  beforeEach(() => {
    TestBed.resetTestingModule();
    resetMapCache();
    ask.mockReset();
    navigateByUrl.mockReset();
    fetches.length = 0;
    observed = [];
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(callback: (entries: { isIntersecting: boolean }[]) => void) {
          observed.push(callback);
        }
        observe(): void {}
        disconnect(): void {}
      },
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        fetches.push(url);
        return new Response(
          JSON.stringify({
            v: 1,
            locale: "en",
            pages: [
              { ...ATLAS, kind: "project", url: "/en/work/atlas", related: [BOREALIS.id] },
              BOREALIS,
            ],
          }),
        );
      }),
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
  });

  it("adds nothing in a server render, and fetches nothing", async () => {
    const fixture = render("server");
    await fixture.whenStable();
    expect((fixture.nativeElement as HTMLElement).innerHTML).not.toContain("read-next");
    expect(observed).toEqual([]);
    expect(fetches).toEqual([]);
  });

  it("fetches the map only as the article's end nears the screen, then puts the block before it", async () => {
    const fixture = render("browser");
    await fixture.whenStable();
    expect(fetches).toEqual([]);
    expect(observed).toHaveLength(1);
    observed[0]!([{ isIntersecting: false }]);
    expect(fetches).toEqual([]);
    observed[0]!([{ isIntersecting: true }]);
    const host = fixture.nativeElement as HTMLElement;
    await vi.waitFor(() => expect(host.querySelector("nav.read-next")).not.toBeNull());
    expect(fetches).toEqual([`${apiBaseUrl()}/v1/ask/map?locale=en`]);
    const article = host.querySelector("article")!;
    expect(article.querySelector(":scope > nav.read-next + footer")).not.toBeNull();
    host.querySelector<HTMLButtonElement>("button.read-next-ask")!.click();
    expect(ask).toHaveBeenCalledWith("How do Atlas and Borealis connect?", "read-next");
    host.querySelector<HTMLAnchorElement>("a.read-next-link")!.click();
    expect(navigateByUrl).toHaveBeenCalledWith("/en/work/borealis");
    fixture.destroy();
  });
});
