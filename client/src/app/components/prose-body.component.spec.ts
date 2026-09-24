import { TestBed } from "@angular/core/testing";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { TocEntry } from "../content/schema";
import { ProseBodyComponent, restoreHeadingIds, withoutHeadingIds } from "./prose-body.component";

const TOC: TocEntry[] = [
  { id: "why", text: "Why it matters", level: 2 },
  { id: "setup", text: "Setup", level: 3 },
  { id: "setup-2", text: "Setup", level: 3 },
];

describe("restoreHeadingIds", () => {
  it("matches headings by level and text, in order for duplicates", () => {
    const root = document.createElement("div");
    root.innerHTML =
      "<h2>Why <em>it</em> matters</h2><p>x</p><h3>Setup</h3><h2></h2><h3>Setup</h3><h4>Setup</h4>";
    restoreHeadingIds(root, TOC);

    expect([...root.querySelectorAll("h2, h3, h4")].map((h) => h.id)).toEqual([
      "why",
      "setup",
      "",
      "setup-2",
      "",
    ]);
  });
});

describe("withoutHeadingIds", () => {
  it("drops only the heading ids the sanitizer would strip", () => {
    expect(withoutHeadingIds('<h2 id="why">Why</h2><h3 id="a-b">A</h3><p id="x">p</p>')).toBe(
      '<h2>Why</h2><h3>A</h3><p id="x">p</p>',
    );
  });
});

describe("ProseBodyComponent", () => {
  afterEach(() => vi.restoreAllMocks());

  function render(html: string, toc: TocEntry[]) {
    const fixture = TestBed.createComponent(ProseBodyComponent);
    fixture.componentRef.setInput("html", html);
    fixture.componentRef.setInput("toc", toc);
    fixture.detectChanges();
    return fixture;
  }

  it("renders through Angular's sanitizer and still carries the anchors", async () => {
    // Angular says so when it strips something: here, the proof it ran.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const fixture = render(
      '<h2 id="why">Why it matters</h2><img src="/x.png" onerror="alert(1)" alt="x"><h3 id="setup">Setup</h3>',
      TOC.slice(0, 2),
    );
    await fixture.whenStable();

    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector("h2")?.id).toBe("why");
    expect(root.querySelector("h3")?.id).toBe("setup");
    expect(root.querySelector("img")?.hasAttribute("onerror")).toBe(false);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("sanitizing HTML stripped"));
  });

  it("leaves the sanitizer nothing to strip from a published body", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const fixture = render(
      '<h2 id="why">Why it matters</h2><p><a href="/en">home</a></p><pre class="code-block"><code><span class="line">x</span></code></pre>',
      TOC.slice(0, 1),
    );
    await fixture.whenStable();

    expect((fixture.nativeElement as HTMLElement).querySelector("h2")?.id).toBe("why");
    expect(warn).not.toHaveBeenCalled();
  });
});
