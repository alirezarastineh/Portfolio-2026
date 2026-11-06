/**
 * How a project card sits in the home page's two-column grid:
 *
 * - `featured`: spans the row, image 7 columns and text 5 on wide screens;
 * - `half`: one of two cards side by side;
 * - `wide`: spans the row as a compact horizontal card (image 5, text 7).
 */
export type CardLayout = "featured" | "half" | "wide";

/**
 * Each project's layout, in the admin's order. Featured projects span the row
 * and the rest go two across. A run of non-featured projects with an odd count
 * would leave its last card alone on its row, so that one spans the row too.
 * Nothing is reordered: the visual order stays the reading order.
 */
export function cardLayouts(projects: readonly { featured: boolean }[]): CardLayout[] {
  const layouts: CardLayout[] = projects.map((p) => (p.featured ? "featured" : "half"));
  let run = 0;
  for (let i = 0; i <= layouts.length; i++) {
    if (layouts[i] === "half") {
      run++;
      continue;
    }
    if (run % 2 === 1) layouts[i - 1] = "wide";
    run = 0;
  }
  return layouts;
}
