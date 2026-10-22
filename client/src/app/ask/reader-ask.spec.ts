import { Component, PLATFORM_ID, signal } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { frameCodeBlocks } from "../components/prose-body.component";
import { LanguageService } from "../services/language.service";
import { AskLauncherService } from "./ask-launcher.service";
import {
  buttonQuestion,
  decorateCode,
  decorateSections,
  injectReaderAsk,
  READER_ASK_COPY,
  selectedText,
  selectionQuestion,
  SELECTION_CHARS,
} from "./reader-ask";

const EN = READER_ASK_COPY.en;

/** A case study's narrative as the page renders it: fixed sections, then the body. */
const NARRATIVE = `
  <section><h2 class="case-h" id="problem">Problem</h2><div class="prose-body"><p>Agents searched wikis.</p></div></section>
  <app-prose-body><div class="prose-body">
    <p>Intro.</p>
    <h2 id="the-gate">The <em>gate</em></h2>
    <pre class="code-block code-lang-ts"><code><span class="line">if (a) fail();</span>
<span class="line">done();</span></code></pre>
    <h3 id="detail">Detail</h3>
    <h2>No id</h2>
    <pre class="code-block"><code>

second()</code></pre>
  </div></app-prose-body>`;

function narrative(): HTMLElement {
  const root = document.createElement("div");
  root.className = "case-flow";
  root.innerHTML = NARRATIVE;
  return root;
}

describe("decorateSections (visitor plan V9)", () => {
  it("gives each narrative heading with an id one button, and leaves the heading's text alone", () => {
    const root = narrative();
    decorateSections(root, EN);
    decorateSections(root, EN);

    const buttons = [...root.querySelectorAll("button.reader-ask")];
    expect(buttons.map((b) => b.parentElement?.id)).toEqual(["problem", "the-gate"]);
    expect(buttons.map((b) => b.getAttribute("aria-label"))).toEqual([
      "Ask about this section: Problem",
      "Ask about this section: The gate",
    ]);
    expect(buttons.every((b) => b.getAttribute("data-label") === ">_ ask")).toBe(true);
    expect(buttons.every((b) => b.textContent === "" && b.getAttribute("type") === "button")).toBe(
      true,
    );
    const gate = root.querySelector("#the-gate")!;
    expect(gate.textContent).toBe("The gate");
    expect(gate.getAttribute("aria-label")).toBe("The gate");
    expect(gate.classList.contains("reader-asks")).toBe(true);
    // An h3, and an h2 the build gave no id, get none.
    expect(root.querySelector("#detail button")).toBeNull();
  });

  it("follows the heading's text and the language when they change in place", () => {
    const root = narrative();
    decorateSections(root, EN);
    root.querySelector("#problem")!.firstChild!.textContent = "Das Problem";
    decorateSections(root, READER_ASK_COPY.de);
    const heading = root.querySelector("#problem")!;
    expect(heading.getAttribute("aria-label")).toBe("Das Problem");
    expect(heading.querySelector("button")!.getAttribute("aria-label")).toBe(
      "Zu diesem Abschnitt fragen: Das Problem",
    );
    expect(heading.querySelector("button")!.getAttribute("data-label")).toBe(">_ fragen");
    expect(heading.querySelectorAll("button")).toHaveLength(1);
  });
});

describe("decorateCode", () => {
  it("puts Explain before Copy in each framed block, numbered in page order, once", () => {
    const root = narrative();
    // Not framed yet: nothing to add to.
    decorateCode(root, EN);
    expect(root.querySelector("button.code-explain")).toBeNull();

    frameCodeBlocks(root, "Copy");
    decorateCode(root, EN);
    decorateCode(root, EN);
    const tools = [...root.querySelectorAll(".code-tools")];
    expect(tools.map((t) => [...t.children].map((c) => c.textContent))).toEqual([
      ["ts", "Explain", "Copy"],
      ["Explain", "Copy"],
    ]);
    expect(
      [...root.querySelectorAll("button.code-explain")].map((b) => b.getAttribute("aria-label")),
    ).toEqual(["Explain code block 1", "Explain code block 2"]);
  });
});

describe("the questions the buttons ask", () => {
  it("asks about a section by its heading's id, and a code block by its place", () => {
    const root = narrative();
    decorateSections(root, EN);
    frameCodeBlocks(root, "Copy");
    decorateCode(root, EN);

    const section = root.querySelector("#the-gate button.reader-ask")!;
    expect(buttonQuestion(section, root, EN)).toEqual({
      question: "Explain this section",
      source: "section",
      about: { focus: { kind: "section", id: "the-gate" }, label: "The gate" },
    });
    const code = root.querySelectorAll("button.code-explain");
    expect(buttonQuestion(code[0]!, root, EN)).toEqual({
      question: "Explain this code",
      source: "code",
      about: { focus: { kind: "code", index: 0 }, label: "if (a) fail();" },
    });
    // Its first line with words names it.
    expect(buttonQuestion(code[1]!, root, EN)?.about.label).toBe("second()");
    // Anything else, or a button outside the narrative, asks nothing.
    expect(buttonQuestion(root.querySelector("p")!, root, EN)).toBeNull();
    expect(buttonQuestion(section, document.createElement("div"), EN)).toBeNull();
  });

  it("asks about a selection with its text, cut where the server cuts it", () => {
    expect(selectionQuestion("Hybrid retrieval", EN)).toEqual({
      question: "What does this mean?",
      source: "selection",
      about: {
        focus: { kind: "selection", text: "Hybrid retrieval" },
        label: "“Hybrid retrieval”",
      },
    });
    const long = selectionQuestion("x".repeat(100), READER_ASK_COPY.de);
    expect(long.question).toBe("Was bedeutet das?");
    expect(long.about.label).toBe(`“${"x".repeat(59)}…”`);
  });
});

describe("selectedText", () => {
  afterEach(() => {
    document.getSelection()?.removeAllRanges();
    document.body.innerHTML = "";
  });

  it("is the selection in the narrative, on one line and cut at 600; nothing otherwise", () => {
    const root = narrative();
    const outside = document.createElement("p");
    outside.textContent = "Elsewhere on the page.";
    document.body.append(root, outside);
    const select = (node: Node) => {
      const range = document.createRange();
      range.selectNodeContents(node);
      const selection = document.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
      return selection;
    };

    expect(selectedText(select(root.querySelector("section p")!), root)).toBe(
      "Agents searched wikis.",
    );
    expect(selectedText(select(outside), root)).toBeNull();
    document.getSelection()!.removeAllRanges();
    expect(selectedText(document.getSelection(), root)).toBeNull();
    const long = document.createElement("p");
    long.textContent = `${"word ".repeat(200)}\n\nend`;
    root.append(long);
    expect(selectedText(select(long), root)).toHaveLength(SELECTION_CHARS);
  });
});

@Component({
  selector: "app-reader-host",
  template: `<div class="case-flow">
    <section><h2 class="case-h" id="problem">Problem</h2></section>
  </div>`,
})
class ReaderHostComponent {
  constructor() {
    injectReaderAsk(() => document.querySelector(".case-flow"));
  }
}

describe("injectReaderAsk", () => {
  const ask = vi.fn();
  const render = (platform: "browser" | "server") => {
    TestBed.configureTestingModule({
      providers: [
        { provide: PLATFORM_ID, useValue: platform },
        { provide: LanguageService, useValue: { lang: signal("en") } },
        { provide: AskLauncherService, useValue: { ask } },
      ],
    });
    const fixture = TestBed.createComponent(ReaderHostComponent);
    document.body.append(fixture.nativeElement as HTMLElement);
    fixture.detectChanges();
    return fixture;
  };

  beforeEach(() => {
    TestBed.resetTestingModule();
    ask.mockReset();
  });
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("adds nothing in a server render: its HTML stays as the page wrote it", async () => {
    const fixture = render("server");
    await fixture.whenStable();
    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector("button")).toBeNull();
    expect(host.innerHTML).not.toContain("reader-ask");
  });

  it("decorates in the browser after the render, and a button puts its question to the assistant", async () => {
    const fixture = render("browser");
    await fixture.whenStable();
    const button = (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>(
      "#problem button.reader-ask",
    );
    expect(button).not.toBeNull();
    button!.click();
    expect(ask).toHaveBeenCalledWith("Explain this section", "section", {
      focus: { kind: "section", id: "problem" },
      label: "Problem",
    });
    fixture.destroy();
  });
});
