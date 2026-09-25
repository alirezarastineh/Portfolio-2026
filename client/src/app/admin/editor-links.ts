import type { ApiIssue, I18nItem } from "./admin-api.service";

/** Where each group of the `ui` document is edited. */
const UI_GROUP_PAGES: Record<string, string> = {
  profile: "/admin/hero",
  hero: "/admin/hero",
  nav: "/admin/hero",
  about: "/admin/about",
  skills: "/admin/skills",
  contact: "/admin/contact",
  projects: "/admin/projects",
  experience: "/admin/experience",
  writing: "/admin/writing",
  legal: "/admin/legal",
  caseStudy: "/admin/copy",
  projectCard: "/admin/copy",
  notFound: "/admin/copy",
  ask: "/admin/copy",
};

const SECTION_PAGES: Record<string, string> = {
  identity: "/admin/hero",
  socials: "/admin/socials",
  skills: "/admin/skills",
  experiences: "/admin/experience",
  legal: "/admin/legal",
  seo: "/admin/seo",
};

/** The list in the payload, and the editor of one of its items. */
const LIST_PAGES: Record<string, { list: string; item: (slug: string) => string }> = {
  projects: { list: "/admin/projects", item: (slug) => `/admin/projects/${encoded(slug)}` },
  posts: { list: "/admin/writing", item: (slug) => `/admin/writing/${encoded(slug)}` },
};

/** `project:atlas` (a doc key) → the editor of that project. */
const DOC_PAGES: Record<string, (slug: string) => string> = {
  project: (slug) => LIST_PAGES["projects"]!.item(slug),
  post: (slug) => LIST_PAGES["posts"]!.item(slug),
  legal: () => "/admin/legal",
};

/** `projects[atlas].name` → `atlas`: the build names list items by slug in the label. */
function slugIn(label: string | undefined, list: string): string | null {
  const match = label ? new RegExp(String.raw`^${list}\[([a-z0-9-]+)\]`).exec(label) : null;
  return match?.[1] ?? null;
}

function encoded(slug: string): string {
  return encodeURIComponent(slug);
}

function docLink(key: string): string | null {
  const [kind = "", slug = ""] = key.split(":");
  return DOC_PAGES[kind]?.(slug) ?? null;
}

/**
 * The admin page where a problem in the built payload is fixed. The path is
 * the payload's (`["projects", 2, "name"]`, `["docs", "post:hello", "title"]`);
 * the label carries the slug an index cannot.
 */
export function editorLinkFor(issue: Pick<ApiIssue, "path" | "label">): string | null {
  const [root, second] = issue.path;
  if (typeof root !== "string") return null;
  if (root === "ui") return UI_GROUP_PAGES[String(second)] ?? "/admin/copy";
  if (root === "docs") return docLink(String(second));

  const pages = LIST_PAGES[root];
  if (pages) {
    const slug = slugIn(issue.label, root);
    return slug ? pages.item(slug) : pages.list;
  }
  return SECTION_PAGES[root] ?? null;
}

/** Where an item of the translation report is edited. */
export function editorLinkForI18n(
  item: Pick<I18nItem, "kind" | "id"> & Partial<Pick<I18nItem, "missingDe" | "missingEn">>,
): string {
  switch (item.kind) {
    case "project":
      return `/admin/projects/${encoded(item.id)}`;
    case "post":
      return `/admin/writing/${encoded(item.id)}`;
    case "experience":
      return "/admin/experience";
    case "skill":
      return "/admin/skills";
    case "faq":
      return "/admin/assistant";
    case "section": {
      if (item.id === "seo") return "/admin/seo";
      if (item.id === "imprint" || item.id === "privacy") return "/admin/legal";
      // `ui` fields are `group.key`: the first one's group decides the page.
      const field = [...(item.missingDe ?? []), ...(item.missingEn ?? [])][0];
      return UI_GROUP_PAGES[field?.split(".")[0] ?? ""] ?? "/admin/copy";
    }
  }
}
