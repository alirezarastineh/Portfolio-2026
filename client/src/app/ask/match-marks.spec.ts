import { describe, expect, it } from "vitest";

import { matchMarks } from "./match-marks";

const row = (status: string, ...ids: unknown[]) => ({
  n: 1,
  status,
  cites: ids.map((id) => ({ id })),
});
const answer = (items: unknown) => ({
  role: "assistant",
  parts: [
    { type: "text", text: "Published evidence for 2 of 4 requirements." },
    { type: "data-match", data: { v: 1, kind: "role", items } },
  ],
});
const question = { role: "user", parts: [{ type: "text", text: "match role" }] };

describe("matchMarks (plan 3 W4)", () => {
  it("counts the evidence rows each page backs, by id without its locale, from the last match", () => {
    const marks = matchMarks({
      messages: [
        answer([row("evidence", "project:older@en")]),
        question,
        answer([
          row("evidence", "project:atlas@en", "experience:e1@en"),
          // Cited twice in a row, and from a German match: one more point for the same page.
          row("evidence", "project:atlas@de", "project:atlas@de"),
          row("partial", "project:pilot@en"),
          row("not-published"),
        ]),
        { role: "assistant", parts: [{ type: "text", text: "A later answer." }] },
      ],
    });
    expect([...marks]).toEqual([
      ["project:atlas", 2],
      ["experience:e1", 1],
    ]);
  });

  it("marks nothing from storage it cannot read", () => {
    for (const stored of [
      null,
      "ask:v1",
      { messages: "x" },
      { messages: [null, { parts: "x" }, { parts: [null, 3] }] },
      { messages: [answer("x")] },
      { messages: [answer([null, "x", row("evidence", 3, null), { status: "evidence" }])] },
      {
        messages: [
          { parts: [{ type: "data-match", data: { v: 2, items: [row("evidence", "a")] } }] },
        ],
      },
    ]) {
      expect(matchMarks(stored).size, JSON.stringify(stored)).toBe(0);
    }
  });

  it("marks nothing without a match", () => {
    const text = { role: "assistant", parts: [{ type: "text", text: "An answer." }] };
    expect(matchMarks({ messages: [question, text] }).size).toBe(0);
    expect(matchMarks({ messages: [] }).size).toBe(0);
  });
});
