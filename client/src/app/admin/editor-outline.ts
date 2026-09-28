import type { PostRow, ProjectRow } from "./admin-api.service";
import { isPlaceholder, isStandInCover } from "./readiness";
import type { Locale } from "../content/schema";

/** Filled in; still missing something a visitor will notice; fine to leave empty. */
export type OutlineState = "done" | "todo" | "optional";

/** One section of a long editor, as its outline rail lists it. */
export interface OutlineItem {
  /** The section element's id. */
  id: string;
  label: string;
  state: OutlineState;
  /** Fields in it the last save flagged, still unfixed. */
  problems: number;
}

const LOCALES: Locale[] = ["en", "de"];

/** Text a visitor would read: tags stripped, and not the seed's TODO placeholder. */
export function hasText(value: string | null | undefined): boolean {
  const text = (value ?? "").replace(/<[^<>]{0,1000}>/g, " ").trim();
  return text !== "" && !isPlaceholder(text);
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
}

function prefixPattern(prefix: string): RegExp {
  const segments = prefix
    .split(".")
    .map((segment) => (segment === "*" ? "[^.]+" : escapeRegex(segment)))
    .join(String.raw`\.`);
  return new RegExp(String.raw`^${segments}(?:\.|$)`);
}

/**
 * How many problem paths fall under any of `prefixes`. A `*` segment matches
 * one segment: `translations.*.name` is the name in either language.
 */
export function problemsUnder(paths: readonly string[], prefixes: readonly string[]): number {
  const patterns = prefixes.map(prefixPattern);
  return paths.filter((path) => patterns.some((pattern) => pattern.test(path))).length;
}

function state(done: boolean, missing: OutlineState = "todo"): OutlineState {
  return done ? "done" : missing;
}

const translated = (fields: string[]) => fields.map((field) => `translations.*.${field}`);

/** The project editor's sections, in page order. */
export function projectOutline(p: ProjectRow, problems: readonly string[]): OutlineItem[] {
  const t = LOCALES.map((locale) => p.translations[locale]);
  const every = (read: (tr: (typeof t)[number]) => boolean) => t.every(read);
  const item = (
    id: string,
    label: string,
    done: boolean,
    prefixes: string[],
    missing: OutlineState = "todo",
  ): OutlineItem => ({
    id,
    label,
    state: state(done, missing),
    problems: problemsUnder(problems, prefixes),
  });

  return [
    item("details", "Details", !!p.slug.trim() && !!p.category.trim() && !!p.periodStart, [
      "slug",
      "category",
      "periodStart",
      "periodEnd",
      "linkLive",
      "linkRepo",
      "linkCaseStudy",
      "featured",
    ]),
    item("cover", "Cover", !!p.coverPath && !isStandInCover(p.coverPath), ["coverId"]),
    item(
      "stack",
      "Stack and tags",
      p.stack.some((s) => s.trim()),
      ["stack", "tags"],
    ),
    item(
      "card",
      "On the card",
      every(
        (tr) => hasText(tr.name) && hasText(tr.descriptor) && hasText(tr.hook) && hasText(tr.role),
      ),
      translated(["name", "descriptor", "hook", "role", "categoryLabel"]),
    ),
    item(
      "story",
      "Problem and approach",
      every(
        (tr) => hasText(tr.problem) && hasText(tr.aiArchitecture) && hasText(tr.fullStackInfra),
      ),
      translated(["problem", "aiArchitecture", "fullStackInfra"]),
    ),
    item(
      "outcomes",
      "Outcomes",
      every((tr) => tr.outcomes.some(hasText)),
      translated(["outcomes"]),
    ),
    item(
      "metrics",
      "Metrics",
      every((tr) => tr.metrics.some((m) => hasText(m.value) && hasText(m.label))),
      translated(["metrics"]),
      "optional",
    ),
    item(
      "case-study",
      "Case study",
      every((tr) => hasText(tr.body)),
      translated(["body"]),
      "optional",
    ),
    item(
      "search",
      "Search",
      every((tr) => hasText(tr.seoDescription)),
      translated(["seoDescription"]),
      "optional",
    ),
    item("gallery", "Gallery", p.gallery.length > 0, ["gallery"], "optional"),
  ];
}

/** The post editor's sections, in page order. A language left out is fine. */
export function postOutline(p: PostRow, problems: readonly string[]): OutlineItem[] {
  const version = (locale: Locale, label: string): OutlineItem => {
    const t = p.translations[locale];
    return {
      id: `post-${locale}`,
      label,
      state: t === null ? "optional" : state(hasText(t.title) && hasText(t.body)),
      problems: problemsUnder(problems, [`translations.${locale}`]),
    };
  };
  return [
    {
      id: "post-details",
      label: "Details",
      state: state(!!p.slug.trim() && (p.status === "draft" || !!p.publishedAt)),
      // "translations" itself (no language written) shows under the details.
      problems:
        problemsUnder(problems, ["slug", "publishedAt", "status", "canonicalUrl"]) +
        problems.filter((path) => path === "translations").length,
    },
    {
      id: "post-cover",
      label: "Cover",
      state: state(!!p.coverPath, "optional"),
      problems: problemsUnder(problems, ["coverId"]),
    },
    {
      id: "post-tags",
      label: "Tags",
      state: state(
        p.tags.some((tag) => tag.trim()),
        "optional",
      ),
      problems: problemsUnder(problems, ["tags"]),
    },
    version("en", "English version"),
    version("de", "German version"),
  ];
}
