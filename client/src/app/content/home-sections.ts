import type { AppContent } from "./schema";

/** The home page's sections, in page order: the work, then the person, then the record. */
export const HOME_SECTIONS = [
  "hero",
  "projects",
  "about",
  "experience",
  "skills",
  "writing",
  "contact",
] as const;
export type HomeSection = (typeof HOME_SECTIONS)[number];

/**
 * The sections this content renders: experience and writing hide when they
 * have nothing to show. The header's links follow it.
 */
export function homeSections(content: Pick<AppContent, "experiences" | "posts">): HomeSection[] {
  return HOME_SECTIONS.filter(
    (id) =>
      (id !== "experience" || content.experiences.length > 0) &&
      (id !== "writing" || content.posts.length > 0),
  );
}
