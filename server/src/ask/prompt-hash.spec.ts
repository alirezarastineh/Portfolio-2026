import { describe, expect, it } from "vitest";

import {
  CAREFUL_BLOCKS,
  closingLine,
  CONTACT_BLOCK,
  FOCUS_SAMPLES,
  focusInstruction,
  hashedPromptText,
  LEVEL_INSTRUCTIONS,
  levelInstruction,
  PAGE_SAMPLE,
  pageInstruction,
  REPAIR_LINE,
  SYSTEM_PROMPT,
  windowNote,
  withSelection,
} from "./prompt.js";
import { NOTES, TOOL_DEFS } from "./tool-defs.js";

/**
 * What `PROMPT_HASH` covers: a changed word in any of it moves the hash, and
 * the eval guard (evals/baseline.spec.ts) stays red until a run is recorded
 * or the new prompt is waived.
 */

describe("the prompt's hash", () => {
  it("covers every fixed text the model reads, the tools' descriptions, inputs and notes included", () => {
    const text = hashedPromptText();
    expect(text).toContain(SYSTEM_PROMPT);
    for (const block of CAREFUL_BLOCKS) expect(text).toContain(block);
    // The tools (plan phase 21): each description and note as the JSON holds it.
    for (const def of Object.values(TOOL_DEFS))
      expect(text).toContain(JSON.stringify(def.description));
    for (const note of Object.values(NOTES)) expect(text).toContain(JSON.stringify(note));
    // Their inputs: a field's description and a limit.
    expect(text).toContain("Keywords, e.g. 'RAG evaluation' or 'Kubernetes'");
    expect(text).toContain('"maxLength":800');
    // The window note in both its forms (plan phase 22).
    expect(text).toContain(windowNote(1, []));
    expect(text).toContain(windowNote(3, ["Atlas", "availability"]));
    // The repair's turn, with its results' header, and the closing line (visitor plan V5).
    expect(text).toContain(REPAIR_LINE);
    expect(text).toContain("[What your lookups for this reply returned:]");
    expect(text).toContain(closingLine("en"));
    expect(text).toContain(closingLine("de"));
    // The request block for a visitor who wants to reach him (visitor plan V6).
    expect(text).toContain(CONTACT_BLOCK);
    // The page block with its text and without (visitor plan V8).
    expect(text).toContain(pageInstruction(PAGE_SAMPLE));
    expect(text).toContain(
      `${pageInstruction({ id: PAGE_SAMPLE.id, title: PAGE_SAMPLE.title, url: PAGE_SAMPLE.url })}\n\0`,
    );
    // The focus block in each form, and a selection the page does not hold (V9).
    expect(FOCUS_SAMPLES.map((f) => f.kind)).toEqual([
      "section",
      "code",
      "selection",
      "unverified",
      "unverified",
    ]);
    for (const focus of FOCUS_SAMPLES) expect(text).toContain(focusInstruction(focus));
    expect(text).toContain(withSelection("q", "s", "en"));
    // Both level blocks (V10); standard has none.
    expect(LEVEL_INSTRUCTIONS).toEqual([levelInstruction("plain"), levelInstruction("expert")]);
    for (const block of LEVEL_INSTRUCTIONS) expect(text).toContain(block);
  });
});
