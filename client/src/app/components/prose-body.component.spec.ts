import { TestBed } from "@angular/core/testing";
import { describe, expect, it } from "vitest";

import type { TocEntry } from "../content/schema";
import { ProseBodyComponent, restoreHeadingIds } from "./prose-body.component";

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

describe("ProseBodyComponent", () => {
  it("renders through Angular's sanitizer and still carries the anchors", async () => {
    const fixture = TestBed.createComponent(ProseBodyComponent);
    fixture.componentRef.setInput(
      "html",
      '<h2 id="why">Why it matters</h2><img src="/x.png" onerror="alert(1)" alt="x"><h3 id="setup">Setup</h3>',
    );
    fixture.componentRef.setInput("toc", TOC.slice(0, 2));
    fixture.detectChanges();
    await fixture.whenStable();

    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector("h2")?.id).toBe("why");
    expect(root.querySelector("h3")?.id).toBe("setup");
    expect(root.querySelector("img")?.hasAttribute("onerror")).toBe(false);
  });
});
