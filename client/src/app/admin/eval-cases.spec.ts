import { describe, expect, it } from "vitest";

import { freezeRequest, listInput, sortCases, type EvalCaseRow } from "./eval-cases";

const row = (id: string, createdAt: string, stale: EvalCaseRow["stale"]): EvalCaseRow => ({
  id,
  question: "q",
  locale: "en",
  snapshotKey: "en:1|a:x",
  mustCite: [],
  mustInclude: [],
  status: "active",
  fromMessageId: null,
  createdAt,
  stale,
});

describe("eval cases in the admin", () => {
  it("reads a list typed with commas or lines", () => {
    expect(listInput(" project:atlas@en, profile@en\nproject:atlas@en \n\n")).toEqual([
      "project:atlas@en",
      "profile@en",
    ]);
    expect(listInput("")).toEqual([]);
  });

  it("sends a frozen case's question only when rewritten, and never unconfirmed", () => {
    const original = "Does Acme GmbH know Alireza?";
    const form = {
      question: ` ${original} `,
      mustCite: "profile@en, profile@en",
      mustInclude: "",
      personalChecked: true,
    };
    expect(freezeRequest(original, form)).toEqual({
      ok: true,
      body: { mustCite: ["profile@en"], mustInclude: [], personalChecked: true },
    });
    expect(freezeRequest(original, { ...form, question: "Who has he worked for?" })).toMatchObject({
      ok: true,
      body: { question: "Who has he worked for?" },
    });
    expect(freezeRequest(original, { ...form, question: " ab " })).toMatchObject({ ok: false });
    expect(freezeRequest(original, { ...form, personalChecked: false })).toEqual({
      ok: false,
      error: "Confirm that nothing personal is left in the question",
    });
  });

  it("lists the stale cases first, then the newest", () => {
    const rows = [
      row("old", "2026-09-01T00:00:00Z", null),
      row("new", "2026-09-20T00:00:00Z", null),
      row("gone", "2026-08-01T00:00:00Z", "gone"),
    ];
    expect(sortCases(rows).map((r) => r.id)).toEqual(["gone", "new", "old"]);
  });
});
