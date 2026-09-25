import { LOCALES } from "../content/locale";
import type { AppContent, Locale } from "../content/schema";
import { editorLinkFor } from "./editor-links";

/**
 * What still makes the site look unfinished to a visitor, read from the
 * draft: placeholder copy, stand-in covers, sections that stay hidden for
 * lack of content. Advice, not validation — publishing never waits for it;
 * the draft's real problems are the publish review's job.
 */

/** How much it hurts: shown as "fix before sharing", "worth fixing", "nice to have". */
export type ReadinessSeverity = "blocker" | "warn" | "tip";

/** One place a check found, merged across the languages it was found in. */
export interface ReadinessHit {
  /** `projects[atlas].descriptor`: list items named, as the publish review names them. */
  label: string;
  /** What is there (the placeholder text, the project's name); empty for an absence. */
  detail: string;
  /** The editor that fixes it. */
  link: string | null;
  locales: Locale[];
}

export interface ReadinessCheck {
  id: string;
  severity: ReadinessSeverity;
  title: string;
  /** Why it matters to a visitor. */
  why: string;
  /** Where it is fixed, for the check as a whole. */
  link: string;
  /** False for an absence (no posts at all), where one place says everything. */
  listsPlaces: boolean;
  hits: ReadinessHit[];
  passed: boolean;
}

export interface ReadinessReport {
  /** Failing first, the worst first; passing last. */
  checks: ReadinessCheck[];
  passed: number;
  total: number;
  /** The languages checked: a draft that does not build cannot be. */
  locales: Locale[];
}

/** `TODO` as a word, the way the seed content marks what is still to write. */
const PLACEHOLDER = /\bTODO\b/;

/** The seed's covers: the SVG stubs in `public/projects/`. Uploads live under `/media/`. */
const STAND_IN_COVER_PREFIX = "/projects/";

const SEVERITY_ORDER: Record<ReadinessSeverity, number> = { blocker: 0, warn: 1, tip: 2 };

/** How much of a placeholder's text a hit shows. */
const DETAIL_CHARS = 90;

interface Finding {
  /** The payload path, which `editorLinkFor` reads. */
  path: (string | number)[];
  label: string;
  detail: string;
}

interface CheckDef extends Omit<ReadinessCheck, "hits" | "passed"> {
  find: (content: AppContent) => Finding[];
}

const CHECKS: CheckDef[] = [
  {
    id: "placeholders",
    severity: "blocker",
    title: "Placeholder text",
    why: "Visitors read “TODO” copy.",
    link: "/admin/projects",
    listsPlaces: true,
    find: (content) => {
      const found: Finding[] = [];
      walk(content, [], "", found);
      return found;
    },
  },
  {
    id: "covers",
    severity: "warn",
    title: "Stand-in project covers",
    why: "The cards show a generated stub instead of the product.",
    link: "/admin/projects",
    listsPlaces: true,
    find: (content) =>
      content.projects.flatMap((project, i) =>
        !project.cover || project.cover.src.startsWith(STAND_IN_COVER_PREFIX)
          ? [
              {
                path: ["projects", i, "cover"],
                label: `projects[${project.slug}].cover`,
                detail: project.name,
              },
            ]
          : [],
      ),
  },
  {
    id: "case-studies",
    severity: "warn",
    title: "Projects without a case study",
    why: "The card leads nowhere: no page shows how it was built.",
    link: "/admin/projects",
    listsPlaces: true,
    find: (content) =>
      content.projects.flatMap((project, i) =>
        project.hasCaseStudy
          ? []
          : [{ path: ["projects", i], label: `projects[${project.slug}]`, detail: project.name }],
      ),
  },
  {
    id: "alt-text",
    severity: "warn",
    title: "Covers without alt text",
    why: "Screen readers announce nothing for them.",
    link: "/admin/media",
    listsPlaces: true,
    find: (content) => [
      ...content.projects.flatMap((project, i) =>
        project.cover && !project.cover.alt.trim()
          ? [
              {
                path: ["projects", i, "cover", "alt"],
                label: `projects[${project.slug}].cover.alt`,
                detail: project.name,
              },
            ]
          : [],
      ),
      ...content.posts.flatMap((post, i) =>
        post.cover && !post.cover.alt.trim()
          ? [
              {
                path: ["posts", i, "cover", "alt"],
                label: `posts[${post.slug}].cover.alt`,
                detail: post.title,
              },
            ]
          : [],
      ),
    ],
  },
  {
    id: "experience",
    severity: "warn",
    title: "No experience",
    why: "The timeline stays hidden, and it is what recruiters look for first.",
    link: "/admin/experience",
    listsPlaces: false,
    find: (content) => (content.experiences.length === 0 ? missing(["experiences"]) : []),
  },
  {
    id: "resume",
    severity: "warn",
    title: "No CV",
    why: "Every “Download CV” button stays hidden.",
    link: "/admin/hero",
    listsPlaces: false,
    find: (content) => (content.identity.resume === null ? missing(["identity", "resume"]) : []),
  },
  {
    id: "metrics",
    severity: "tip",
    title: "Projects without metrics",
    why: "A number is the quickest proof a card can give.",
    link: "/admin/projects",
    listsPlaces: true,
    find: (content) =>
      content.projects.flatMap((project, i) =>
        project.metrics.length
          ? []
          : [
              {
                path: ["projects", i, "metrics"],
                label: `projects[${project.slug}].metrics`,
                detail: project.name,
              },
            ],
      ),
  },
  {
    id: "featured",
    severity: "tip",
    title: "No featured project",
    why: "The strongest project should lead: a featured one spans the whole row.",
    link: "/admin/projects",
    listsPlaces: false,
    find: (content) =>
      content.projects.length > 1 && !content.projects.some((p) => p.featured)
        ? missing(["projects"])
        : [],
  },
  {
    id: "location",
    severity: "tip",
    title: "No city or time zone",
    why: "The hero's status line shows availability alone; remote teams look for your time zone.",
    link: "/admin/hero",
    listsPlaces: false,
    find: ({ identity }) =>
      !identity.location.city.trim() || !identity.timezone.trim()
        ? missing(["identity", "location"])
        : [],
  },
  {
    id: "avatar",
    severity: "tip",
    title: "No photo",
    why: "A face makes the hero and the About section personal.",
    link: "/admin/hero",
    listsPlaces: false,
    find: (content) => (content.identity.avatar === null ? missing(["identity", "avatar"]) : []),
  },
  {
    id: "posts",
    severity: "tip",
    title: "No posts",
    why: "The writing section stays hidden.",
    link: "/admin/writing",
    listsPlaces: false,
    find: (content) => (content.posts.length === 0 ? missing(["posts"]) : []),
  },
];

/** Every check against each language's draft; a language missing from `drafts` is skipped. */
export function checkReadiness(drafts: Partial<Record<Locale, AppContent>>): ReadinessReport {
  const locales = LOCALES.filter((locale) => drafts[locale]);

  const checks = CHECKS.map(({ find, ...def }): ReadinessCheck => {
    const hits = new Map<string, ReadinessHit>();
    for (const locale of locales) {
      for (const finding of find(drafts[locale]!)) {
        const known = hits.get(finding.label);
        if (known) {
          known.locales.push(locale);
          continue;
        }
        hits.set(finding.label, {
          label: finding.label,
          detail: finding.detail,
          link: editorLinkFor(finding),
          locales: [locale],
        });
      }
    }
    return { ...def, hits: [...hits.values()], passed: hits.size === 0 };
  }).sort(
    (a, b) =>
      Number(a.passed) - Number(b.passed) ||
      SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity],
  );

  const passed = checks.filter((check) => check.passed).length;
  return { checks, passed, total: checks.length, locales };
}

/** The placeholders in one language's content: what the publish review warns about. */
export function findPlaceholders(content: AppContent): ReadinessHit[] {
  const found: Finding[] = [];
  walk(content, [], "", found);
  return found.map((finding) => ({
    label: finding.label,
    detail: finding.detail,
    link: editorLinkFor(finding),
    locales: [content.locale],
  }));
}

/** One finding for an absence (no posts at all). */
function missing(path: string[]): Finding[] {
  return [{ path, label: path.join("."), detail: "" }];
}

/** Collects every string that still says TODO, named by where it is. */
function walk(value: unknown, path: (string | number)[], label: string, found: Finding[]): void {
  if (typeof value === "string") {
    if (PLACEHOLDER.test(value)) found.push({ path, label, detail: excerpt(value) });
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, i) => walk(item, [...path, i], `${label}[${itemName(item, i)}]`, found));
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      walk(child, [...path, key], label ? `${label}.${key}` : key, found);
    }
  }
}

/** A list item by its slug or id where it has one — what the editors call it — else its index. */
function itemName(item: unknown, index: number): string {
  if (item && typeof item === "object") {
    const { slug, id } = item as { slug?: unknown; id?: unknown };
    if (typeof slug === "string") return slug;
    if (typeof id === "string") return id;
  }
  return String(index);
}

/** The text around the placeholder, without markup (rich-text fields are HTML). */
function excerpt(value: string): string {
  const text = value
    .replaceAll(/<[^<>]*>/g, " ")
    .replaceAll(/\s+/g, " ")
    .trim();
  const start = Math.max(0, text.search(PLACEHOLDER) - 20);
  const end = start + DETAIL_CHARS;
  return `${start > 0 ? "…" : ""}${text.slice(start, end)}${end < text.length ? "…" : ""}`;
}
