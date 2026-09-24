import type { Locale } from "../content/locale";
import { formatPeriod } from "../content/period";
import { regionName } from "../content/place";
import type { AppContent } from "../content/schema";
import { fmt } from "../i18n/interpolate";
import { splitCommentMark } from "../i18n/comment-mark";
import type { AskCopy } from "./ask-copy";

/**
 * The shell's own commands: parsing, completion, and the answers that need no
 * model — from the published content the page already has. Pure, so they are
 * tested without a browser; the store runs the side effects.
 */

export type LocalCommand =
  | "help"
  | "whoami"
  | "ls-projects"
  | "ls-skills"
  | "cat"
  | "open"
  | "cv"
  | "contact"
  | "lang"
  | "stats"
  | "history"
  | "clear"
  | "reset"
  | "sudo"
  | "deep-usage"
  | "open-usage";

export type Parsed =
  | { kind: "empty" }
  | { kind: "local"; name: LocalCommand; arg: string }
  | { kind: "ask"; text: string; deep: boolean };

/** Commands for Tab completion, in the order `help` lists them. */
export const COMMANDS = [
  "help",
  "whoami",
  "ls projects",
  "ls skills",
  "cat ",
  "open ",
  "cv",
  "contact",
  "lang ",
  "deep ",
  "stats",
  "history",
  "clear",
  "reset",
];

const EXACT: Record<string, LocalCommand> = {
  help: "help",
  "?": "help",
  whoami: "whoami",
  ls: "ls-projects",
  "ls projects": "ls-projects",
  "ls work": "ls-projects",
  "ls skills": "ls-skills",
  cv: "cv",
  resume: "cv",
  contact: "contact",
  stats: "stats",
  history: "history",
  clear: "clear",
  reset: "reset",
  deep: "deep-usage",
  open: "open-usage",
  cd: "open-usage",
};

/**
 * A command only when the input is one: "help" runs `help`, "help me find his
 * projects" is a question.
 */
export function parseInput(raw: string): Parsed {
  const text = raw.trim();
  if (!text) return { kind: "empty" };
  const normal = text.toLowerCase().replace(/\s+/g, " ");

  const exact = EXACT[normal];
  if (exact) return { kind: "local", name: exact, arg: "" };
  if (/^sudo hire( alireza)?\b/.test(normal)) return { kind: "local", name: "sudo", arg: "" };

  const [head, ...rest] = text.split(/\s+/);
  const arg = rest.join(" ");
  switch (head!.toLowerCase()) {
    case "cat":
      if (rest.length === 1) return { kind: "local", name: "cat", arg };
      break;
    case "open":
    case "cd":
      if (rest.length >= 1 && rest.length <= 3) return { kind: "local", name: "open", arg };
      break;
    case "lang":
      if (rest.length <= 1) return { kind: "local", name: "lang", arg: arg.toLowerCase() };
      break;
    case "ask":
      if (arg) return { kind: "ask", text: arg, deep: false };
      break;
    case "deep":
      if (arg) return { kind: "ask", text: arg, deep: true };
      break;
  }
  return { kind: "ask", text, deep: false };
}

/** Completes a command or a project name; null when nothing (or too much) matches. */
export function complete(input: string, content: AppContent): string | null {
  const lower = input.toLowerCase();
  if (!lower) return null;
  const argFor = /^(cat|open|cd) (.*)$/.exec(lower);
  if (argFor) {
    const candidates = [
      ...content.projects.map((p) => p.slug),
      ...(argFor[1] === "cat"
        ? []
        : ["projects", "experience", "skills", "writing", "about", "contact"]),
      ...(argFor[1] === "cat" ? [] : content.posts.map((p) => p.slug)),
    ].filter((c) => c.startsWith(argFor[2]!));
    return candidates.length === 1 ? `${argFor[1]} ${candidates[0]}` : null;
  }
  const matches = COMMANDS.filter((c) => c.startsWith(lower) && c !== lower);
  return matches.length === 1 ? matches[0]! : null;
}

export interface OutLine {
  text: string;
  /** A left column (a command name, a project slug). */
  label?: string;
  tone?: "dim" | "accent" | "error";
  href?: string;
  /** A site path the router can open, rather than a file or another site. */
  internal?: boolean;
}

export function helpLines(copy: AskCopy, disclosure: string): OutLine[] {
  return [
    { text: copy.help.title, tone: "dim" },
    ...copy.help.rows.map(([label, text]) => ({ label, text })),
    { text: copy.help.footer },
    { text: disclosure, tone: "dim" },
  ];
}

function projectBySlug(content: AppContent, name: string) {
  const wanted = name.toLowerCase().replace(/\.md$/, "");
  return content.projects.find(
    (p) => p.slug.toLowerCase() === wanted || p.name.toLowerCase() === wanted,
  );
}

export function whoamiLines(content: AppContent, locale: Locale, copy: AskCopy): OutLine[] {
  const { identity, ui } = content;
  const place = [
    identity.location.city,
    identity.location.country ? regionName(identity.location.country, locale) : "",
  ]
    .filter(Boolean)
    .join(", ");
  const availability = {
    open: ui.hero.availabilityOpen,
    limited: ui.hero.availabilityLimited,
    closed: ui.hero.availabilityClosed,
  }[identity.availability];
  return [
    { text: `${identity.name} — ${ui.profile.role}`, tone: "accent" },
    { text: ui.profile.heroHeadline },
    { label: copy.cmd.location, text: place || ui.profile.location },
    { label: copy.cmd.availability, text: availability },
  ];
}

export function projectListLines(content: AppContent, locale: Locale, copy: AskCopy): OutLine[] {
  if (!content.projects.length) return [{ text: copy.cmd.noProjects, tone: "dim" }];
  return content.projects.map((p) => ({
    label: p.slug,
    text: [
      p.descriptor || p.name,
      p.period ? formatPeriod(p.period, locale, content.ui.experience.present) : "",
    ]
      .filter(Boolean)
      .join(" · "),
    ...(p.hasCaseStudy ? { href: `/${locale}/work/${p.slug}`, internal: true } : {}),
  }));
}

export function projectLines(
  content: AppContent,
  locale: Locale,
  name: string,
  copy: AskCopy,
): OutLine[] {
  const p = projectBySlug(content, name);
  if (!p) return [{ text: fmt(copy.cmd.unknownProject, { x: name }), tone: "error" }];
  return [
    { text: `${p.name} — ${p.descriptor}`, tone: "accent" },
    ...(p.hook ? [{ text: p.hook }] : []),
    ...(p.role ? [{ label: "role", text: p.role }] : []),
    ...(p.stack.length ? [{ label: copy.cmd.stack, text: p.stack.join(", ") }] : []),
    ...p.metrics.map((m) => ({ label: "·", text: `${m.value} ${m.label}` })),
    ...(p.hasCaseStudy
      ? [
          {
            label: "→",
            text: copy.cmd.caseStudy,
            href: `/${locale}/work/${p.slug}`,
            internal: true,
          },
        ]
      : []),
  ];
}

export function skillLines(content: AppContent, copy: AskCopy): OutLine[] {
  if (!content.skills.length) return [{ text: copy.cmd.noSkills, tone: "dim" }];
  return content.skills.map((s) => ({ label: s.title, text: s.items.join(", ") }));
}

const SECTIONS = ["projects", "experience", "skills", "writing", "about", "contact"] as const;

/** Where `open <arg>` goes: a section, a case study, a post, or nowhere. */
export function openTarget(content: AppContent, locale: Locale, arg: string): string | null {
  const wanted = arg.trim().toLowerCase().replace(/^#/, "").replace(/\/$/, "");
  if (!wanted) return null;
  if (["home", "~", "/", "."].includes(wanted)) return `/${locale}`;
  if (wanted === "work") return `/${locale}#projects`;
  if (wanted === "writing" && content.posts.length) return `/${locale}/writing`;
  if ((SECTIONS as readonly string[]).includes(wanted)) return `/${locale}#${wanted}`;
  const project = projectBySlug(content, wanted);
  if (project)
    return project.hasCaseStudy ? `/${locale}/work/${project.slug}` : `/${locale}#projects`;
  const post = content.posts.find((p) => p.slug === wanted || p.title.toLowerCase() === wanted);
  if (post) return `/${locale}/writing/${post.slug}`;
  // Section names as the page shows them ("Selected Work", "Werdegang").
  const byHeading: [string, string][] = [
    [content.ui.projects.heading, "projects"],
    [content.ui.experience.heading, "experience"],
    [content.ui.skills.heading, "skills"],
    [content.ui.writing.heading, "writing"],
    [content.ui.about.heading, "about"],
    [content.ui.contact.heading, "contact"],
  ];
  const heading = byHeading.find(
    ([label]) => splitCommentMark(label).text.toLowerCase() === wanted,
  );
  return heading ? `/${locale}#${heading[1]}` : null;
}

/**
 * When no model can answer (off, resting, every provider down): the common
 * questions still get something useful from the content, and a way to reach
 * Alireza. Keyword intents in both languages.
 */
export function offlineLines(
  question: string,
  content: AppContent,
  locale: Locale,
  copy: AskCopy,
): OutLine[] {
  const q = question.toLowerCase();
  const intents: [RegExp, () => OutLine[]][] = [
    [
      /\b(project|work|built|case stud|portfolio|projekt|arbeit)/,
      () => projectListLines(content, locale, copy),
    ],
    [
      /\b(skill|stack|tech|language|tool|framework|fähigkeit|technolog|sprache)/,
      () => skillLines(content, copy),
    ],
    [
      /\b(who|about|available|availability|hire|role|based|location|where|wer|verfügbar|wo |standort)/,
      () => whoamiLines(content, locale, copy),
    ],
    [
      /\b(cv|resume|résumé|lebenslauf)/,
      () =>
        content.identity.resume
          ? [{ label: "cv", text: `/${locale}/resume.pdf`, href: `/${locale}/resume.pdf` }]
          : [{ text: copy.cmd.noCv, tone: "dim" }],
    ],
  ];
  const match = intents.find(([pattern]) => pattern.test(q));
  return [
    { text: copy.offlineIntro, tone: "dim" },
    ...(match ? match[1]() : whoamiLines(content, locale, copy)),
    { text: copy.offlineContact, tone: "dim" },
  ];
}
