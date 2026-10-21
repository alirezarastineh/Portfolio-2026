import { describe, expect, it } from "vitest";

import type { AppContent } from "../content/schema";
import { linkPolicyFor } from "./link-policy";

const SITE = "https://alirezarastineh.me";
const SOCIALS = [
  "https://github.com/alirezarastineh",
  "https://www.linkedin.com/in/alirezarastineh",
];
const content = {
  identity: { siteUrl: `${SITE}/`, contactEmail: "hello@alirezarastineh.me" },
  socials: SOCIALS.map((href) => ({ href })),
} as unknown as Pick<AppContent, "socials" | "identity">;
const bs = "\\";

describe("linkPolicyFor", () => {
  it("keeps the site's pages and the owner's addresses", () => {
    const policy = linkPolicyFor(content);
    for (const to of ["/en/work/atlas", "/de", `${SITE}/en/writing`]) {
      expect(policy(to), to).toBe("internal");
    }
    for (const to of [...SOCIALS, "mailto:hello@alirezarastineh.me"]) {
      expect(policy(to), to).toBe("external");
    }
  });

  it("keeps nothing a browser opens on another site, a new tab included", () => {
    const policy = linkPolicyFor(content);
    // A browser reads "\" as "/" in a web address: "/\evil.example" is //evil.example.
    for (const to of [
      `/${bs}evil.example`,
      `/${bs}/evil.example`,
      `${bs}${bs}evil.example`,
      "//evil.example",
      `${SITE}.evil.example/`,
      "https://evil.example/",
      "javascript:alert(1)",
      "mailto:someone@evil.example",
    ]) {
      expect(policy(to), to).toBeNull();
    }
  });

  it("checks paths as paths while the site has no address yet", () => {
    const early = linkPolicyFor({ ...content, identity: { ...content.identity, siteUrl: "" } });
    expect(early("/en/work/atlas")).toBe("internal");
    expect(early(`/${bs}evil.example`)).toBeNull();
    expect(early(`${SITE}/en`)).toBeNull();
  });
});
