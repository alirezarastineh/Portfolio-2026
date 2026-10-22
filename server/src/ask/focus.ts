import { z } from "zod";

import type { CorpusDocument } from "./corpus/build.js";
import type { PageDocument } from "./page.js";
import type { FocusBlock } from "./prompt.js";

/**
 * What the visitor points at (visitor plan V9; the book's Guardrail Sandwich,
 * input side: validate a proposal against a trusted source). A section or a
 * code block is taken from the page's document by its id or its place, never
 * from the browser's text, so it is the owner's own. A selection is trusted
 * only when the page's document holds it; otherwise it is the visitor's text,
 * and joins their message inside its fence.
 */

/** The longest selection a request may send. */
export const SELECTION_CHARS = 600;

/** Where a section, code block or selection is cut in its block. */
export const EXCERPT_CHARS = 2_000;

export const focusSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("section"), id: z.string().min(1).max(100) }),
  z.object({ kind: z.literal("code"), index: z.number().int().min(0).max(500) }),
  z.object({ kind: z.literal("selection"), text: z.string().min(1).max(SELECTION_CHARS) }),
]);

export type FocusRequest = z.infer<typeof focusSchema>;

/** What the answer does with what the visitor pointed at. */
export interface Focus {
  /** Its block after the corpus; null when it pointed at nothing the page has. */
  block: FocusBlock | null;
  /** A selection the page does not hold: it joins the visitor's message, fenced. */
  fenced: string | null;
  /** For the trace: what was pointed at, and whether the page's document holds it. */
  trace: { kind: FocusRequest["kind"]; verified: boolean };
}

/** Text as compared and quoted: one form of each character, runs of space as one. */
function squash(text: string): string {
  return text.normalize("NFKC").replace(/\s+/g, " ").trim();
}

/** Whether `document` holds `selection`: in its text, a section's or a code block's. */
function holds(document: CorpusDocument, selection: string): boolean {
  const wanted = squash(selection).toLowerCase();
  if (!wanted) return false;
  const texts = [
    document.text,
    ...(document.sections ?? []).map((s) => s.text),
    ...(document.code ?? []),
  ];
  return texts.some((text) => squash(text).toLowerCase().includes(wanted));
}

/** `text` cut where its block cuts it, with "…" where it was. */
function excerpt(text: string): string {
  return text.length > EXCERPT_CHARS ? `${text.slice(0, EXCERPT_CHARS)}…` : text;
}

/** What `request` points at on `page`: from the page's document, or the visitor's own words. */
export function focusOf(request: FocusRequest, page: PageDocument | null): Focus {
  const document = page?.document;
  const ref = document && { id: document.id, title: document.title, url: document.url };
  const ignored = (): Focus => ({
    block: null,
    fenced: null,
    trace: { kind: request.kind, verified: false },
  });

  if (request.kind === "section") {
    const section = document?.sections?.find((s) => s.id === request.id);
    if (!ref || !section) return ignored();
    return {
      block: { kind: "section", page: ref, title: section.title, text: excerpt(section.text) },
      fenced: null,
      trace: { kind: "section", verified: true },
    };
  }
  if (request.kind === "code") {
    const code = document?.code?.[request.index];
    if (!ref || code === undefined) return ignored();
    return {
      block: { kind: "code", page: ref, index: request.index, text: excerpt(code) },
      fenced: null,
      trace: { kind: "code", verified: true },
    };
  }
  const selection = squash(request.text);
  if (!selection) return ignored();
  if (ref && document && holds(document, selection)) {
    return {
      block: { kind: "selection", page: ref, text: excerpt(selection) },
      fenced: null,
      trace: { kind: "selection", verified: true },
    };
  }
  return {
    block: { kind: "unverified", ...(ref ? { page: ref } : {}) },
    fenced: selection,
    trace: { kind: "selection", verified: false },
  };
}
