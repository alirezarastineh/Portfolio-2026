import { describe, expect, it } from "vitest";

import { CAREFUL_BLOCKS, hashedPromptText, SYSTEM_PROMPT, windowNote } from "./prompt.js";
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
  });
});
