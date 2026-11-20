import { describe, expect, it } from "vitest";

import {
  actionWords,
  actorWords,
  approverWords,
  auditAction,
  auditReason,
  auditTarget,
  outcomeWords,
} from "./trust-words";

describe("trust's rules in words (plan 5, U19)", () => {
  it("says who may do what, an outside agent by how it reaches the site", () => {
    expect(actionWords("navigate")).toBe("Opens a page of this site");
    expect(actionWords("mcp.search_portfolio")).toBe("Searches the published portfolio");
    expect(actionWords("webmcp.contact")).toBe("Fills the contact form; the visitor sends it");
    // One the server adds later keeps its name until it gets words.
    expect(actionWords("brand.new")).toBe("brand.new");
    expect(actorWords({ action: "mcp.get_resume", actor: "external" })).toBe(
      "An outside agent, over MCP",
    );
    expect(actorWords({ action: "webmcp.open_page", actor: "external" })).toBe(
      "The visitor's browser agent",
    );
    expect(actorWords({ action: "publish", actor: "admin" })).toBe("You");
    expect(approverWords("none")).toBe("Nobody");
  });

  it("says the audit log's rows: what, on what, and how it ended", () => {
    expect(auditAction({ action: "settings.update", decision: "allowed" })).toBe(
      "Changed the settings",
    );
    expect(auditAction({ action: "demote", decision: "denied" })).toBe(
      "Kept in the visitors' service",
    );
    expect(auditTarget("settings")).toBeNull();
    expect(auditTarget("route:deep")).toEqual({ text: "the deep route", id: false });
    expect(auditTarget("run_8f2a")).toEqual({ text: "run_8f2a", id: true });
    expect(outcomeWords("denied")).toBe("Refused");
  });

  it("reads the server's two fixed reasons into words, and leaves its sentences", () => {
    expect(
      auditReason({
        action: "settings.update",
        reason: "enabled true → false; featureCaps.eval null → 0.5; publicReserve 0.5 → 0.6",
      }),
    ).toBe(
      "Answer visitors: off (was on); Daily cap for Eval runs: $0.50 (was none); Kept for visitors: 60 % (was 50 %)",
    );
    expect(
      auditReason({
        action: "run.spend",
        reason: "eval run stopped before case-12: reserve_reached",
      }),
    ).toBe(
      "Eval runs stopped before case-12. Today's spend reached the reserve line: the rest is kept for visitors.",
    );
    // A part it cannot read stays as the server wrote it.
    expect(auditReason({ action: "settings.update", reason: "newKey 1 → 2; odd" })).toBe(
      "newKey 1 → 2; odd",
    );
    expect(auditReason({ action: "trust.check", reason: "4 checked, 1 demoted, 0 refused" })).toBe(
      "4 checked, 1 demoted, 0 refused",
    );
  });
});
