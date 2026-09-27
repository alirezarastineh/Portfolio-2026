import type { AppContent } from "./schema";

/** The home page's sections, in page order. */
export const HOME_SECTIONS = [
  "hero",
  "projects",
  "experience",
  "skills",
  "writing",
  "about",
  "contact",
] as const;
export type HomeSection = (typeof HOME_SECTIONS)[number];

/**
 * The sections this content renders: experience and writing hide when they
 * have nothing to show. The header's links and the headings' numbers follow it.
 */
export function homeSections(content: Pick<AppContent, "experiences" | "posts">): HomeSection[] {
  return HOME_SECTIONS.filter(
    (id) =>
      (id !== "experience" || content.experiences.length > 0) &&
      (id !== "writing" || content.posts.length > 0),
  );
}

/** Each rendered section's number after the hero, `01`, `02`, …; empty for a hidden one. */
export function sectionIndexes(sections: readonly HomeSection[]): Record<HomeSection, string> {
  const indexes = Object.fromEntries(HOME_SECTIONS.map((id) => [id, ""])) as Record<
    HomeSection,
    string
  >;
  sections
    .filter((id) => id !== "hero")
    .forEach((id, i) => (indexes[id] = String(i + 1).padStart(2, "0")));
  return indexes;
}
