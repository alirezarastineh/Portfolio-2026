/**
 * A case study's glossary as the project editor's field holds it: one
 * `term: definition` a line, split at the first ": " (or the first ":"); a line
 * without a colon is a term with no definition, which the save refuses. The
 * copilot's glossary gate splits its drafts the same way (server
 * `ask/skills/gates.ts` `parseGlossary`). Its own module, not the admin schema:
 * a value imported from that one bundles every admin schema with the editor.
 */

export interface GlossaryLine {
  term: string;
  definition: string;
}

export function parseGlossary(text: string): GlossaryLine[] {
  return text.split("\n").flatMap((raw) => {
    const line = raw.trim();
    if (!line) return [];
    const at = line.includes(": ") ? line.indexOf(": ") : line.indexOf(":");
    if (at < 0) return [{ term: line, definition: "" }];
    return [{ term: line.slice(0, at).trim(), definition: line.slice(at + 1).trim() }];
  });
}

/** The field's text for a saved glossary: the lines `parseGlossary` reads back. */
export function glossaryText(items: readonly GlossaryLine[]): string {
  return items.map((item) => `${item.term}: ${item.definition}`).join("\n");
}
