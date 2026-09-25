import { describe, expect, it } from "vitest";
import { z } from "zod";

import { issueLabel } from "../content/draft-issues.js";
import { toIssues } from "./issues.js";

function issuesOf(schema: z.ZodType, value: unknown) {
  const parsed = schema.safeParse(value);
  if (parsed.success) throw new Error("expected a failure");
  return toIssues(parsed.error.issues);
}

describe("toIssues", () => {
  it("says what to do instead of describing the type error", () => {
    const schema = z.object({
      name: z.string().min(1),
      slug: z.string().min(3),
      bio: z.string().max(5),
      tags: z.array(z.string()).max(1),
      email: z.string(),
    });
    const messages = Object.fromEntries(
      issuesOf(schema, { name: "", slug: "ab", bio: "too long", tags: ["a", "b"] }).map((i) => [
        i.path.join("."),
        i.message,
      ]),
    );
    expect(messages).toEqual({
      name: "Required",
      slug: "At least 3 characters",
      bio: "At most 5 characters",
      tags: "At most 1 item",
      email: "Required",
    });
  });

  it("keeps a schema's own message, capitalised", () => {
    const schema = z.object({
      date: z.string().regex(/^\d{4}$/, "a year like 2026"),
      text: z.string().refine((s) => s.includes("{n}"), "must contain {n}"),
    });
    expect(issuesOf(schema, { date: "x", text: "no" }).map((i) => i.message)).toEqual([
      "A year like 2026",
      "Must contain {n}",
    ]);
  });

  it("prefixes paths", () => {
    const [issue] = toIssues(z.object({ a: z.string() }).safeParse({ a: 1 }).error!.issues, [
      "ui",
      "hero",
      "en",
    ]);
    expect(issue?.path).toEqual(["ui", "hero", "en", "a"]);
  });
});

describe("issueLabel", () => {
  it("names list items by slug or id instead of their index", () => {
    const value = { projects: [{ slug: "atlas" }, { slug: "beacon" }], skills: [{ id: "core" }] };
    expect(issueLabel(value, ["projects", 1, "name"])).toBe("projects[beacon].name");
    expect(issueLabel(value, ["skills", 0, "title"])).toBe("skills[core].title");
    expect(issueLabel(value, ["socials", 3, "href"])).toBe("socials[#3].href");
  });
});
