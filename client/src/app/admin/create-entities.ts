import type { AdminApiService } from "./admin-api.service";

export type Created = { ok: true; slug: string } | { ok: false; error: string };

/**
 * A new, visible project with a placeholder name and a unique slug, in both
 * languages: what "Add project" on the list and "New project" in the palette
 * both start from.
 */
export async function createBlankProject(api: AdminApiService): Promise<Created> {
  const slug = `project-${Date.now().toString(36)}`;
  const blank = {
    name: "New project",
    descriptor: "",
    hook: "",
    problem: "",
    aiArchitecture: "",
    fullStackInfra: "",
    outcomes: [] as string[],
    role: "",
    categoryLabel: "",
    metrics: [],
    body: "",
    seoDescription: "",
  };
  const result = await api.createProject({
    slug,
    coverId: null,
    stack: [],
    linkLive: "",
    linkRepo: "",
    linkCaseStudy: "",
    isVisible: true,
    featured: false,
    periodStart: null,
    periodEnd: null,
    category: "",
    tags: [],
    gallery: [],
    translations: { en: { ...blank }, de: { ...blank } },
  });
  return result.ok ? { ok: true, slug } : { ok: false, error: result.error };
}

/** A new draft post in English only, not on the site until it is published. */
export async function createBlankPost(api: AdminApiService): Promise<Created> {
  const slug = `post-${Date.now().toString(36)}`;
  const result = await api.createPost({
    slug,
    status: "draft",
    publishedAt: null,
    coverId: null,
    tags: [],
    canonicalUrl: "",
    translations: {
      en: { title: "New post", excerpt: "", body: "", seoTitle: "", seoDescription: "" },
      de: null,
    },
  });
  return result.ok ? { ok: true, slug } : { ok: false, error: result.error };
}
