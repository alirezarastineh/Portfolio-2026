import type { I18nItem } from "./admin-api.service";

/**
 * Text that nothing on the site reads any more (plan 5, coverage "Hidden"). The keys and
 * their values stay, and every save sends them (the server still requires some); they are
 * kept out of sight only: out of the editors, the translation rows and the content agent's
 * proposals. A skill's icon and size and a social's icon are no text: their editors leave
 * them out, and Add sends defaults. Found without a reader beyond the plan's list (2026-11-09):
 * `nav.skills` and `nav.contact`.
 */
const HIDDEN: ReadonlySet<string> = new Set([
  "ui.about.subtitle",
  "ui.about.terminalTitle",
  "ui.about.terminalPrompt",
  "ui.about.terminalOutputWhoami",
  "ui.about.terminalOutputLs",
  "ui.projects.subtitle",
  "ui.skills.subtitle",
  "ui.experience.subtitle",
  "ui.profile.secondaryCta",
  "ui.projectCard.caseLabel",
  "ui.nav.skills",
  "ui.nav.contact",
  "seo.ogUrl",
  "identity.secondaryCtaHref",
  "skill.caption",
]);

/**
 * A field as the translation rows and the agent's proposals name it: a section by its
 * document (`section`, `ui`, `about.subtitle`), anything else by its kind (`skill`, …, `caption`).
 */
export function isHidden(kind: string, id: string, field: string): boolean {
  return HIDDEN.has(kind === "section" ? `${id}.${field}` : `${kind}.${field}`);
}

/** The translation rows without hidden fields; a row only they put out of step goes. */
export function visibleI18n(items: readonly I18nItem[]): I18nItem[] {
  return items.flatMap((item) => {
    const shown = (fields: string[]) => fields.filter((f) => !isHidden(item.kind, item.id, f));
    const row = { ...item, missingDe: shown(item.missingDe), missingEn: shown(item.missingEn) };
    const left = row.missingDe.length > 0 || row.missingEn.length > 0 || row.stale || row.absent;
    return left ? [row] : [];
  });
}
