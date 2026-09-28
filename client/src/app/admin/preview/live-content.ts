import type {
  ExperienceInput,
  MediaAsset,
  ProfileInput,
  ProjectRow,
  SkillRow,
} from "../admin-api.service";
import type {
  AppContent,
  AppTranslations,
  Experience,
  Image,
  Locale,
  Metric,
  Project,
  Skill,
} from "../../content/schema";

/**
 * The live preview's content: the saved draft (what `/admin/content/preview`
 * builds), with the editor's unsaved state drawn over it. Each function here
 * maps one editor's state the way the server's `buildLocale` maps the stored
 * rows, so what the preview shows is what saving and publishing would.
 */

/** An editor's contribution: its unsaved state over the draft, for one language. */
export type LiveCompose = (base: AppContent, locale: Locale, media: MediaLookup) => AppContent;

/** An uploaded asset by its id, from the media library (undefined until it has loaded). */
export type MediaLookup = (id: string | null) => MediaAsset | undefined;

/** An image asset as the payload's image, as the server's `MediaIndex.image` builds it. */
export function imageFromAsset(
  asset: MediaAsset | undefined,
  locale: Locale,
  fallbackAlt: string,
): Image | null {
  if (asset?.kind !== "image") return null;
  const set = (format: "webp" | "avif") =>
    asset.variants
      .filter((v) => v.format === format)
      .map((v) => `${v.path} ${v.width}w`)
      .join(", ");
  const avif = set("avif");
  const webp = set("webp");
  const own = locale === "de" ? asset.altDe : asset.altEn;
  const other = locale === "de" ? asset.altEn : asset.altDe;
  return {
    src: asset.path,
    srcset: webp,
    sources: [
      ...(avif ? [{ type: "image/avif" as const, srcset: avif }] : []),
      ...(webp ? [{ type: "image/webp" as const, srcset: webp }] : []),
    ],
    width: asset.width,
    height: asset.height,
    alt: own?.trim() || other?.trim() || fallbackAlt,
    blur: asset.blurDataUri && asset.blurDataUri.length <= 2048 ? asset.blurDataUri : null,
  };
}

/**
 * The image for a media id: from the library, or the draft's own copy while the
 * library has not loaded (only when the id is the one the draft was built with).
 */
function imageFor(
  id: string | null,
  media: MediaLookup,
  locale: Locale,
  alt: string,
  saved: { id: string | null; image: Image | null },
): Image | null {
  if (!id) return null;
  return imageFromAsset(media(id), locale, alt) ?? (id === saved.id ? saved.image : null);
}

/** Some groups of the `ui` tree, each over the draft's (a field the editor lacks keeps its value). */
export function withUi(
  base: AppContent,
  locale: Locale,
  groups: Partial<Record<keyof AppTranslations, Partial<Record<Locale, object>>>>,
): AppContent {
  const ui = { ...base.ui } as Record<string, object>;
  for (const [group, value] of Object.entries(groups)) {
    const own = value?.[locale];
    if (own) ui[group] = { ...ui[group], ...own };
  }
  return { ...base, ui: ui as AppTranslations };
}

export type IdentityDraft = Omit<ProfileInput, "avatarId"> & { avatarId: string | null };

/** The identity from the hero editor's fields; the CV stays as saved (it saves at once). */
export function withIdentity(
  base: AppContent,
  locale: Locale,
  draft: IdentityDraft,
  savedAvatarId: string | null,
  media: MediaLookup,
): AppContent {
  const name = draft.name.trim() || base.identity.name;
  return {
    ...base,
    identity: {
      ...base.identity,
      name,
      handle: draft.handle,
      contactEmail: draft.contactEmail,
      primaryCtaHref: draft.primaryCtaHref,
      secondaryCtaHref: draft.secondaryCtaHref,
      siteUrl: draft.siteUrl.trim() || base.identity.siteUrl,
      availability: draft.availability,
      location: { city: draft.locationCity, country: draft.locationCountry.trim().toUpperCase() },
      timezone: draft.timezone,
      avatar: imageFor(draft.avatarId, media, locale, name, {
        id: savedAvatarId,
        image: base.identity.avatar,
      }),
    },
  };
}

function cleanMetrics(metrics: { value: string; label: string; context?: string }[]): Metric[] {
  return metrics
    .filter((m) => m.value?.trim() && m.label?.trim())
    .map((m) => ({
      value: m.value.trim(),
      label: m.label.trim(),
      ...(m.context?.trim() ? { context: m.context.trim() } : {}),
    }));
}

/**
 * The project as the editor has it, in place of the draft's (found by the slug
 * it was saved under). A hidden or brand-new project goes at the end, so the
 * preview can still show it.
 */
export function withProject(
  base: AppContent,
  locale: Locale,
  row: ProjectRow,
  saved: { slug: string; coverId: string | null },
  media: MediaLookup,
): AppContent {
  const t = row.translations[locale];
  const at = base.projects.findIndex((p) => p.slug === saved.slug);
  const before = base.projects[at];
  const project: Project = {
    slug: row.slug,
    name: t.name,
    descriptor: t.descriptor,
    hook: t.hook,
    problem: t.problem,
    aiArchitecture: t.aiArchitecture,
    fullStackInfra: t.fullStackInfra,
    outcomes: t.outcomes,
    stack: row.stack.filter((s) => s.trim() !== ""),
    links: { live: row.linkLive, repo: row.linkRepo, caseStudy: row.linkCaseStudy },
    cover: imageFor(row.coverId, media, locale, t.name, {
      id: saved.coverId,
      image: before?.cover ?? null,
    }),
    featured: row.featured,
    period: row.periodStart ? { start: row.periodStart, end: row.periodEnd } : null,
    role: t.role,
    category: row.category.trim()
      ? { key: row.category.trim(), label: t.categoryLabel || row.category.trim() }
      : null,
    tags: row.tags.filter((tag) => tag.trim() !== ""),
    metrics: cleanMetrics(t.metrics),
    hasCaseStudy: t.body.trim() !== "",
    updatedAt: before?.updatedAt ?? row.updatedAt,
  };
  const projects = [...base.projects];
  if (at >= 0) projects[at] = project;
  else projects.push(project);
  return { ...base, projects };
}

/** An experience row (saved, or the one open in the editor), as the timeline shows it. */
type ExperienceDraft = ExperienceInput & { id: string | null };

function toExperience(
  row: ExperienceDraft,
  locale: Locale,
  media: MediaLookup,
  saved: { id: string | null; image: Image | null },
): Experience | null {
  const t = row.translations[locale];
  if (!t) return null;
  return {
    id: row.id ?? "draft",
    kind: row.kind,
    org: {
      name: row.orgName,
      url: row.orgUrl ?? "",
      logo: imageFor(row.logoId, media, locale, row.orgName, saved),
    },
    title: t.title,
    summary: t.summary,
    highlights: t.highlights.filter((h) => h.trim() !== ""),
    location: row.location,
    employmentType: row.employmentType,
    period: { start: row.startDate, end: row.endDate, precision: row.datePrecision },
    credential:
      row.credentialId || row.credentialUrl
        ? { id: row.credentialId ?? "", url: row.credentialUrl ?? "" }
        : null,
    skills: row.skills.filter((s) => s.trim() !== ""),
  };
}

/**
 * The timeline from the editor's list (its order and visibility, which save at
 * once), with the entry open in the editor in its place, or at the end when
 * it is new. The open entry shows even while hidden, so it can be checked.
 */
export function withExperiences(
  base: AppContent,
  locale: Locale,
  rows: readonly (ExperienceInput & { id: string })[],
  open: ExperienceDraft | null,
  media: MediaLookup,
): AppContent {
  const drawn = new Map(base.experiences.map((e) => [e.id, e.org.logo]));
  const list: Experience[] = [];
  let placed = false;
  for (const row of rows) {
    const editing = open?.id === row.id;
    if (!editing && !row.isVisible) continue;
    const source = editing && open ? open : row;
    // The list holds the saved row: its logo is the one the draft was built with.
    const saved = { id: row.logoId, image: drawn.get(row.id) ?? null };
    const entry = toExperience(source, locale, media, saved);
    if (entry) list.push(entry);
    placed ||= editing;
  }
  if (open && !placed) {
    const entry = toExperience(open, locale, media, { id: null, image: null });
    if (entry) list.push(entry);
  }
  return { ...base, experiences: list };
}

/** The skill cards from the editor's list: visible ones, in its order, in this language. */
export function withSkills(
  base: AppContent,
  locale: Locale,
  rows: readonly SkillRow[],
): AppContent {
  const skills: Skill[] = rows
    .filter((row) => row.isVisible)
    .map((row) => {
      const t = row.translations[locale];
      return {
        id: row.id,
        icon: row.icon,
        span: row.span,
        items: row.items.filter((item) => item.trim() !== ""),
        title: t.title,
        caption: t.caption,
        narrative: t.narrative,
      };
    });
  return { ...base, skills };
}
