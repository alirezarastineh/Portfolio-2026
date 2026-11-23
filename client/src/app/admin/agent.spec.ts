import { describe, expect, it } from "vitest";

import {
  agentWords,
  applyStop,
  filterProposals,
  filterStatuses,
  goalsWords,
  groupProposals,
  isContentRun,
  isOpen,
  itemsLine,
  plainText,
  resumeWords,
  runCost,
  runLine,
  runSummary,
  runWords,
  splitLabel,
  startQuestion,
  startWords,
  statusName,
  summaryLine,
  textWords,
  type Proposal,
} from "./agent";
import type { RunRow } from "./assistant-types";

function proposal(label: string, status: Proposal["status"] = "proposed"): Proposal {
  return {
    id: label,
    createdAt: "2026-10-09T10:00:00.000Z",
    updatedAt: "2026-10-09T10:00:00.000Z",
    runId: "r1",
    goal: "translations",
    kind: "project",
    entityId: "p1",
    field: "hook",
    locale: "de",
    label,
    before: "",
    after: "Ein Haken.",
    skill: "translate",
    version: "v",
    useId: null,
    flags: [],
    notes: [],
    status,
    decidedAt: null,
    appliedAt: null,
    revertedAt: null,
  };
}

describe("the Agent page's helpers (plan phase 30)", () => {
  it("groups proposals by what they change, in the order they come", () => {
    const groups = groupProposals([
      proposal("Atlas · Hook (DE)"),
      proposal("Site copy · profile.heroHeadline (DE)"),
      proposal("Atlas · Name (DE)"),
    ]);
    expect(
      groups.map((g) => [g.entity, g.proposals.map((p) => splitLabel(p.label).field)]),
    ).toEqual([
      ["Atlas", ["Hook (DE)", "Name (DE)"]],
      ["Site copy", ["profile.heroHeadline (DE)"]],
    ]);
    // A name with its own " · " keeps it: only the last one splits off the field.
    expect(splitLabel("Engineer · Acme · Title (EN)")).toEqual({
      entity: "Engineer · Acme",
      field: "Title (EN)",
    });
  });

  it("filters open proposals (drafted or needing the admin) from decided ones", () => {
    const all = [
      proposal("A · X", "proposed"),
      proposal("B · X", "needs_you"),
      proposal("C · X", "applied"),
      proposal("D · X", "stale"),
    ];
    expect(filterProposals(all, "open").map((p) => p.label)).toEqual(["A · X", "B · X"]);
    expect(filterProposals(all, "applied").map((p) => p.label)).toEqual(["C · X"]);
    expect(filterProposals(all, "all")).toHaveLength(4);
    expect(isOpen({ status: "needs_you" })).toBe(true);
    expect(statusName("needs_you")).toBe("Needs you");
    // What each filter asks the server for: all of them, for all.
    expect(filterStatuses("open")).toEqual(["proposed", "needs_you"]);
    expect(filterStatuses("stale")).toEqual(["stale"]);
    expect(filterStatuses("all")).toEqual([]);
  });

  it("reads a content run and its summary among the runs", () => {
    expect(isContentRun({ kind: "agent", params: { task: "content" } })).toBe(true);
    expect(isContentRun({ kind: "agent", params: { task: "replay", entry: "e" } })).toBe(false);
    expect(isContentRun({ kind: "eval", params: {} })).toBe(false);
    const summary = runSummary({ summary: { proposed: 3, needsYou: 1, stale: 2 } });
    expect(summary).toEqual({ proposed: 3, needsYou: 1, stale: 2 });
    if (!summary) {
      throw new Error("expected summary");
    }
    expect(summaryLine(summary)).toBe("3 proposed, 1 need you, 2 stale");
    expect(runSummary({ summary: null })).toBeNull();
  });

  it("says the server's refusals in words, and shows a field's text without its markup", () => {
    expect(agentWords("feature_off")).toBe(
      "Admin agents are switched off: Settings, under Spending.",
    );
    expect(agentWords("stale")).toMatch(/nothing was overwritten/);
    expect(agentWords("not_found")).toBe("That proposal is gone.");
    // An unknown code: a plain sentence, never the code (plan 5, U19).
    expect(agentWords("something_new")).toBe(
      "The server refused this. Try again; if it happens again, its log says why.",
    );
    // The request's own failures, never a raw code.
    expect(agentWords("http_404")).toMatch(/deploy the API first/);
    expect(agentWords("http_502")).toBe("The API failed (HTTP 502): try again; its log says why.");
    expect(agentWords("network_error")).toMatch(/did not answer/);
    expect(agentWords("request_failed")).toBe("The request failed: try again.");
    expect(agentWords("failed")).toMatch(/nothing was written/);
    // A run refused for its limits says them; its other refusals read as everywhere.
    expect(startWords("invalid_input")).toBe(
      "The run's limits are out of range: 1–100 items, $0.01–$1.",
    );
    expect(startWords("feature_off")).toBe(agentWords("feature_off"));
    expect(plainText("<p>Search &amp; <strong>answers</strong>&nbsp;fast</p>")).toBe(
      "Search & answers fast",
    );
  });

  it("says a run's cancel and resume refusals in words, never a raw code or a proposal's", () => {
    expect(runWords("not_cancellable")).toBe("That run has ended: there is nothing to cancel.");
    expect(runWords("not_resumable")).toMatch(/only a failed, interrupted or cancelled one/);
    expect(runWords("not_found")).toBe("That run is gone.");
    // The fences read as everywhere.
    expect(runWords("cap_reached")).toBe(agentWords("cap_reached"));
    expect(runWords("http_503")).toBe(agentWords("http_503"));
  });

  it("says why a field refused a text: what it must keep, or its length", () => {
    expect(textWords([{ code: "custom", message: "must contain {i}" }])).toBe(
      "The text does not fit the field: must contain {i}.",
    );
    expect(
      textWords([{ code: "too_big", maximum: 200, message: "Too big: expected string…" }]),
    ).toBe("The text does not fit the field: at most 200 characters.");
    expect(textWords([{ code: "too_small", minimum: 1, message: "Too small" }])).toBe(
      "The text does not fit the field: at least 1 character.",
    );
    expect(textWords([])).toBe("The text does not fit the field.");
    expect(textWords(undefined)).toBe("The text does not fit the field.");
  });

  it("says a run in the runs' one vocabulary, with its items, cost and what it drafted", () => {
    const now = Date.parse("2026-11-23T12:00:00.000Z");
    const stopped = {
      status: "failed",
      params: { task: "content", goals: ["alt", "seo", "unknown"], maxUsd: 0.05 },
      startedAt: "2026-11-21T12:00:00.000Z",
      createdAt: "2026-11-21T11:59:00.000Z",
      progress: { total: 20, done: 12, failed: 0, unavailable: 0 },
      usd: 0.0412,
      summary: { proposed: 12, needsYou: 0, stale: 0 },
    } satisfies Pick<
      RunRow,
      "status" | "params" | "startedAt" | "createdAt" | "progress" | "usd"
    > & {
      summary: unknown;
    };
    expect(runLine(stopped, now)).toBe(
      "Stopped: alt text and search descriptions, started 2 days ago.",
    );
    expect(itemsLine(stopped)).toBe("12 of 20 items, $0.0412: 12 proposed, 0 need you.");
    expect(runLine({ ...stopped, status: "queued", startedAt: null, params: {} }, now)).toBe(
      "Waiting to start, asked 2 days ago.",
    );
    expect(
      itemsLine({ ...stopped, progress: { ...stopped.progress, total: 1 }, summary: null }),
    ).toBe("12 of 1 item, $0.0412.");
    expect(resumeWords(stopped)).toBe(
      "Its 8 items left are drafted. It stops at its limit, $0.05, of which $0.0412 is spent, and spends under Admin agents' cap.",
    );
    expect(runCost(1.5)).toBe("$1.50");
  });

  it("asks before a run with its goals and limit, and stops Apply on a changed or empty draft", () => {
    expect(goalsWords(["translations", "alt", "seo"])).toBe(
      "translations, alt text and search descriptions",
    );
    expect(startQuestion(["translations"], 1, 0.05)).toEqual({
      title: "Draft up to 1 item?",
      description:
        "Translations for the content's gaps, as proposals you decide. The run stops at its limit, $0.05, and spends under Admin agents' switch and cap (Settings, under Spending).",
    });
    expect(applyStop({ changed: true, after: "Text" })).toMatch(
      /^Its field changed since the draft/,
    );
    expect(applyStop({ after: null })).toBe(agentWords("no_text"));
    expect(applyStop({ changed: false, after: "Text" })).toBeNull();
  });
});
