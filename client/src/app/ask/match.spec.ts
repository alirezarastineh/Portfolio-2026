import { describe, expect, it } from "vitest";

import type { AppContent } from "../content/schema";
import { ASK_COPY } from "./ask-copy";
import type { AskMessage } from "./ask-types";
import { linkPolicyFor } from "./link-policy";
import { counterLine, isMatchKind, markOf, matchData, matchStep, stepLine } from "./match";

describe("markOf (plan 4 U30)", () => {
  it("is the row's status, unless the server's line says to ask him", () => {
    expect(markOf({ status: "evidence", summary: "Built it." })).toBe("evidence");
    expect(markOf({ status: "partial", summary: "Some of it." })).toBe("partial");
    expect(markOf({ status: "not-published", summary: "nothing on his site shows this." })).toBe(
      "not-published",
    );
    expect(markOf({ status: "not-published", summary: "ask him directly." })).toBe("ask");
    expect(markOf({ status: "not-published", summary: "frag ihn direkt." })).toBe("ask");
  });
});

describe("matchData (plan 3 W2)", () => {
  const policy = linkPolicyFor({
    identity: { siteUrl: "https://alirezarastineh.me/", contactEmail: "hello@alirezarastineh.me" },
    socials: [],
  } as unknown as Pick<AppContent, "socials" | "identity">);
  const row = {
    n: 1,
    text: "Python in production",
    priorityLabel: "must",
    status: "evidence",
    statusLabel: "evidence",
    summary: "Builds the backend in Python.",
    cites: [{ id: "skills@en", title: "Skills", url: "/en#skills" }],
  };
  const answer = (data: unknown) =>
    ({
      parts: [
        { type: "text", text: "…" },
        { type: "data-match", data },
      ],
    }) as unknown as Pick<AskMessage, "parts">;

  it("reads the server's rows, in its words", () => {
    expect(matchData(answer({ v: 1, kind: "role", items: [row] }), policy)).toEqual({
      kind: "role",
      items: [row],
    });
    expect(matchData({ parts: [] }, policy)).toBeNull();
    expect(matchData(undefined, policy)).toBeNull();
  });

  it("drops a cite to another site, a malformed row, an unknown status, and any other version", () => {
    const bs = "\\";
    const foreign = ["https://evil.example/x", "//evil.example", `/${bs}evil.example`, ""].map(
      (url) => ({ id: "x@en", title: "X", url }),
    );
    const read = matchData(
      answer({ v: 1, kind: "role", items: [{ ...row, cites: [...row.cites, ...foreign] }] }),
      policy,
    );
    expect(read?.items[0]?.cites).toEqual(row.cites);
    for (const bad of [null, "x", { ...row, n: 0 }, { ...row, n: 1.5 }, { ...row, text: 3 }]) {
      const items = [bad, row];
      expect(matchData(answer({ v: 1, kind: "role", items }), policy)?.items).toEqual([row]);
    }
    const unknown = { v: 1, kind: "role", items: [{ ...row, status: "proven" }] };
    expect(matchData(answer(unknown), policy)).toBeNull();
    expect(matchData(answer({ v: 2, kind: "role", items: [row] }), policy)).toBeNull();
    expect(matchData(answer({ v: 1, kind: "essay", items: [row] }), policy)).toBeNull();
  });
});

describe("match's progress (visitor plan V20)", () => {
  it("reads the server's steps field by field, and nothing else", () => {
    expect(matchStep({ v: 1, step: "plan" })).toEqual({ step: "plan" });
    expect(matchStep({ v: 1, step: "search", items: 7 })).toEqual({ step: "search", items: 7 });
    expect(matchStep({ v: 1, step: "write", items: 7, repair: true })).toEqual({
      step: "write",
      items: 7,
      repair: true,
    });
    expect(matchStep({ v: 1, step: "check" })).toEqual({ step: "check" });
    for (const bad of [null, "plan", {}, { step: "search" }, { step: "search", items: -1 }]) {
      expect(matchStep(bad), JSON.stringify(bad)).toBeNull();
    }
    expect(matchStep({ step: "write", items: 2.5 })).toBeNull();
    expect(matchStep({ step: "deploy" })).toBeNull();
  });

  it("words each step, in either language", () => {
    const en = ASK_COPY.en.match.steps;
    expect(stepLine({ step: "plan" }, en)).toBe("reading the brief…");
    expect(stepLine({ step: "search", items: 1 }, en)).toBe("searching his work for 1 item…");
    expect(stepLine({ step: "search", items: 7 }, en)).toBe("searching his work for 7 items…");
    expect(stepLine({ step: "write", items: 7, repair: true }, en)).toBe(
      "rewriting what the check refused…",
    );
    expect(stepLine({ step: "search", items: 3 }, ASK_COPY.de.match.steps)).toBe(
      "durchsuche seine Arbeit nach 3 Punkten…",
    );
  });

  it("counts the brief in the reader's numbers, and knows its kinds", () => {
    expect(counterLine(1234, ASK_COPY.en.match, "en")).toBe(
      `${new Intl.NumberFormat("en").format(1234)} / ${new Intl.NumberFormat("en").format(4000)} characters`,
    );
    expect(counterLine(1234, ASK_COPY.de.match, "de")).toBe(
      `${new Intl.NumberFormat("de").format(1234)} / ${new Intl.NumberFormat("de").format(4000)} Zeichen`,
    );
    expect(["role", "project", "problem"].every(isMatchKind)).toBe(true);
    expect(isMatchKind("essay")).toBe(false);
  });
});
