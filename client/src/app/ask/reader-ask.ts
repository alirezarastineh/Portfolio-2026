import { DOCUMENT, isPlatformBrowser } from "@angular/common";
import { afterEveryRender, DestroyRef, inject, PLATFORM_ID } from "@angular/core";

import type { Locale } from "../content/locale";
import { fmt } from "../i18n/interpolate";
import { LanguageService } from "../services/language.service";
import { AskLauncherService, type AskAbout, type AskSource } from "./ask-launcher.service";

/**
 * Asking about what a reader points at on a case study or a post (visitor
 * plan V9). Added in the browser only, after the page has rendered, so the
 * server's HTML stays as it was:
 * - each top-level heading gets "ask about this section", the keyboard's way
 *   in, shown on hover and focus (and always where nothing hovers);
 * - each code block gets "Explain" beside "Copy";
 * - a text selection gets a small "ask about this" button, a pointer
 *   convenience.
 * Each puts a fixed question to the assistant, in the sheet, with what it
 * points at. The server takes a section or a code block from the page's own
 * document and trusts a selection only if that document holds it. The words
 * live here, not in `i18n/chrome.ts`, so only the reader pages load them.
 */

export interface ReaderAskCopy {
  /** `label` is what the button shows; `name` its accessible name. */
  section: { label: string; name: string; question: string };
  code: { label: string; name: string; question: string };
  selection: { label: string; name: string; question: string };
}

export const READER_ASK_COPY: Record<Locale, ReaderAskCopy> = {
  en: {
    section: {
      label: ">_ ask",
      name: "Ask about this section: {title}",
      question: "Explain this section",
    },
    code: { label: "Explain", name: "Explain code block {n}", question: "Explain this code" },
    selection: {
      label: ">_ ask about this",
      name: "Ask about the selected text",
      question: "What does this mean?",
    },
  },
  de: {
    section: {
      label: ">_ fragen",
      name: "Zu diesem Abschnitt fragen: {title}",
      question: "Erklär diesen Abschnitt",
    },
    code: { label: "Erklären", name: "Codeblock {n} erklären", question: "Erklär diesen Code" },
    selection: {
      label: ">_ dazu fragen",
      name: "Zum markierten Text fragen",
      question: "Was bedeutet das?",
    },
  },
};

/** The most of a selection a question sends (the server takes 600). */
export const SELECTION_CHARS = 600;
/** How much of a code block's first line, or of a selection, names it in the terminal. */
const LABEL_CHARS = 60;

/** The headings a reader can ask about: a case study's fixed ones, and a body's own `h2`s. */
const SECTION_HEADINGS = "h2.case-h[id], app-prose-body > .prose-body > h2[id]";
/** The body's code blocks, in the order the server counts them (its document's `code`). */
const CODE_BLOCKS = "app-prose-body pre.code-block";

const oneLine = (text: string) => text.replace(/\s+/g, " ").trim();

/** `text` cut to `max` characters, with "…" where it was. */
function cut(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function setAttribute(el: Element, name: string, value: string): void {
  if (el.getAttribute(name) !== value) el.setAttribute(name, value);
}

/**
 * Gives each heading under `root` its "ask about this section" button, once.
 * The button sits inside the heading, its label drawn by CSS, so the heading's
 * text is unchanged; the heading keeps its own name, the button names the
 * section. Both follow the heading's text, which a language switch can change
 * in place.
 */
export function decorateSections(root: Element, copy: ReaderAskCopy): void {
  for (const heading of Array.from(root.querySelectorAll(SECTION_HEADINGS))) {
    let button = heading.querySelector(":scope > button.reader-ask");
    if (!button) {
      button = heading.ownerDocument.createElement("button");
      button.setAttribute("type", "button");
      button.className = "reader-ask";
      heading.append(button);
      heading.classList.add("reader-asks");
    }
    const title = oneLine(heading.textContent ?? "");
    setAttribute(heading, "aria-label", title);
    setAttribute(button, "aria-label", fmt(copy.section.name, { title }));
    setAttribute(button, "data-label", copy.section.label);
  }
}

/** Puts "Explain" beside each framed code block's "Copy" under `root`, once. */
export function decorateCode(root: Element, copy: ReaderAskCopy): void {
  Array.from(root.querySelectorAll(CODE_BLOCKS)).forEach((pre, index) => {
    // Framed by the prose body in the browser; not yet, and it waits for the next render.
    const tools = pre.parentElement?.classList.contains("code-frame")
      ? pre.parentElement.querySelector(":scope > .code-tools")
      : null;
    if (!tools) return;
    let button = tools.querySelector(":scope > button.code-explain");
    if (!button) {
      button = tools.ownerDocument.createElement("button");
      button.setAttribute("type", "button");
      button.className = "code-explain";
      tools.insertBefore(button, tools.querySelector(":scope > .code-copy"));
    }
    if (button.textContent !== copy.code.label) button.textContent = copy.code.label;
    setAttribute(button, "data-index", String(index));
    setAttribute(button, "aria-label", fmt(copy.code.name, { n: index + 1 }));
  });
}

/** The question a section or code button asks, with what it points at; null for any other click. */
export function buttonQuestion(
  target: Element,
  root: Element,
  copy: ReaderAskCopy,
): { question: string; source: AskSource; about: AskAbout } | null {
  const section = target.closest("button.reader-ask");
  const heading = section?.parentElement;
  if (section && heading?.id && root.contains(section)) {
    return {
      question: copy.section.question,
      source: "section",
      about: {
        focus: { kind: "section", id: heading.id },
        label: oneLine(heading.textContent ?? ""),
      },
    };
  }
  const code = target.closest<HTMLElement>("button.code-explain");
  if (!code || !root.contains(code)) return null;
  const index = Number(code.dataset["index"]);
  const source = root.querySelectorAll(CODE_BLOCKS)[index]?.textContent ?? "";
  const firstLine = source.split("\n").find((line) => line.trim()) ?? "";
  return {
    question: copy.code.question,
    source: "code",
    about: { focus: { kind: "code", index }, label: cut(firstLine.trim(), LABEL_CHARS) },
  };
}

/** A selection's text as a question sends it, or null: nothing selected, or not in `root`. */
export function selectedText(selection: Selection | null, root: Element): string | null {
  if (!selection || selection.isCollapsed || !selection.rangeCount) return null;
  const range = selection.getRangeAt(0);
  if (!root.contains(range.commonAncestorContainer)) return null;
  const text = oneLine(selection.toString());
  return text ? text.slice(0, SELECTION_CHARS) : null;
}

/** The question a selection asks, with its text, which names it in the terminal. */
export function selectionQuestion(
  text: string,
  copy: ReaderAskCopy,
): { question: string; source: AskSource; about: AskAbout } {
  return {
    question: copy.selection.question,
    source: "selection",
    about: { focus: { kind: "selection", text }, label: `“${cut(text, LABEL_CHARS)}”` },
  };
}

/** How long a selection must rest before its button shows: a drag moves it otherwise. */
const SELECTION_SETTLE_MS = 250;

/**
 * Decorates the reader page whose narrative `root` returns, in the browser:
 * call it from the page's constructor. Nothing happens on the server.
 */
export function injectReaderAsk(root: () => Element | null): void {
  if (!isPlatformBrowser(inject(PLATFORM_ID))) return;
  const launcher = inject(AskLauncherService);
  const lang = inject(LanguageService);
  const doc = inject(DOCUMENT);
  const copy = () => READER_ASK_COPY[lang.lang()];

  // After every render: a new page or language replaces the headings and code blocks.
  afterEveryRender(() => {
    const el = root();
    if (!el) return;
    decorateSections(el, copy());
    decorateCode(el, copy());
  });

  const onClick = (event: MouseEvent) => {
    const el = root();
    const target = event.target;
    if (!el || !(target instanceof Element)) return;
    const asked = buttonQuestion(target, el, copy());
    if (asked) launcher.ask(asked.question, asked.source, asked.about);
  };
  doc.addEventListener("click", onClick);

  // The selection's button: one, made when first needed, outside the page's content.
  let button: HTMLButtonElement | null = null;
  let selected: string | null = null;
  /** While it is pressed: a touch may clear the selection before the click lands. */
  let pressing = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const hide = () => {
    selected = null;
    if (button) button.hidden = true;
  };
  const selectionButton = (): HTMLButtonElement => {
    if (button) return button;
    const made = doc.createElement("button");
    made.type = "button";
    made.className = "reader-ask-selection";
    made.hidden = true;
    // Pressing it must not drop the selection it asks about.
    made.addEventListener("pointerdown", (event) => {
      pressing = true;
      event.preventDefault();
    });
    made.addEventListener("pointercancel", () => (pressing = false));
    made.addEventListener("click", () => {
      pressing = false;
      if (!selected) return;
      const asked = selectionQuestion(selected, copy());
      hide();
      launcher.ask(asked.question, asked.source, asked.about);
    });
    doc.body.append(made);
    button = made;
    return made;
  };
  const show = () => {
    const el = root();
    const selection = doc.getSelection();
    const text = el ? selectedText(selection, el) : null;
    if (!text || !selection) return hide();
    const rect = selection.getRangeAt(0).getBoundingClientRect();
    const view = doc.defaultView!;
    const b = selectionButton();
    b.textContent = copy().selection.label;
    b.setAttribute("aria-label", copy().selection.name);
    b.hidden = false;
    selected = text;
    // Below the selection, where a phone's own selection menu is not.
    const left = Math.min(rect.left, view.innerWidth - b.offsetWidth - 8);
    b.style.left = `${Math.max(8, left) + view.scrollX}px`;
    b.style.top = `${rect.bottom + view.scrollY + 8}px`;
  };
  const onSelection = () => {
    clearTimeout(timer);
    if (doc.getSelection()?.isCollapsed !== false) {
      if (!pressing) hide();
      return;
    }
    timer = setTimeout(show, SELECTION_SETTLE_MS);
  };
  const onKey = (event: KeyboardEvent) => {
    if (event.key === "Escape" && selected) hide();
  };
  doc.addEventListener("selectionchange", onSelection);
  doc.addEventListener("keydown", onKey);
  doc.defaultView?.addEventListener("resize", hide);

  inject(DestroyRef).onDestroy(() => {
    clearTimeout(timer);
    doc.removeEventListener("click", onClick);
    doc.removeEventListener("selectionchange", onSelection);
    doc.removeEventListener("keydown", onKey);
    doc.defaultView?.removeEventListener("resize", hide);
    button?.remove();
  });
}
