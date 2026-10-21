import type { AppContent } from "../content/schema";

/** `internal` opens in the router, `external` in a new context; null keeps only the link's text. */
export type LinkKind = "internal" | "external";

/** Where a browser takes `href` from `base`; null when it is no address at all. */
function originOf(href: string, base: string): string | null {
  try {
    return new URL(href, base).origin;
  } catch {
    return null;
  }
}

/**
 * Which links an answer may keep, whatever the model writes: the site's own
 * pages, the owner's socials and email. Any other link is shown as its text.
 * A page is the site's own only where a browser opens it there, in a new tab
 * too: a browser reads "\" as "/", so "/\evil.example" is another site.
 */
export function linkPolicyFor(
  content: Pick<AppContent, "socials" | "identity">,
): (href: string) => LinkKind | null {
  const known = new Set([
    ...content.socials.map((s) => s.href),
    `mailto:${content.identity.contactEmail}`,
  ]);
  const site = content.identity.siteUrl.replace(/\/$/, "");
  // A path is checked against the site's address, or a stand-in while none is set.
  const home = originOf(site, "https://site.invalid") ?? "https://site.invalid";
  return (href) => {
    if (known.has(href)) return "external";
    const page = href.startsWith("/") || (site !== "" && href.startsWith(`${site}/`));
    return page && originOf(href, home) === home ? "internal" : null;
  };
}
