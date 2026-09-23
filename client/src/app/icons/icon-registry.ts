import { provideIcons } from "@ng-icons/core";
import {
  lucideAtSign,
  lucideAward,
  lucideBot,
  lucideBrainCircuit,
  lucideBriefcase,
  lucideCloud,
  lucideCode,
  lucideContainer,
  lucideCpu,
  lucideDatabase,
  lucideGitBranch,
  lucideGlobe,
  lucideGraduationCap,
  lucideLayers,
  lucideLink,
  lucideMail,
  lucideMessageCircle,
  lucideNewspaper,
  lucideRss,
  lucideServer,
  lucideShield,
  lucideSparkles,
  lucideSquareTerminal,
  lucideWorkflow,
} from "@ng-icons/lucide";

import { brandGithub, brandLinkedin, brandX } from "./brand-icons";

/**
 * The one list of icons content may name. The CMS stores a key (`github`,
 * `brain-circuit`); this maps it to an icon. Adding an icon is one line here —
 * no schema change, no migration — and a key this build does not know still
 * renders, as the fallback.
 */
const ICONS = {
  lucideAtSign,
  lucideAward,
  lucideBot,
  lucideBrainCircuit,
  lucideBriefcase,
  lucideCloud,
  lucideCode,
  lucideContainer,
  lucideCpu,
  lucideDatabase,
  lucideGitBranch,
  lucideGlobe,
  lucideGraduationCap,
  lucideLayers,
  lucideLink,
  lucideMail,
  lucideMessageCircle,
  lucideNewspaper,
  lucideRss,
  lucideServer,
  lucideShield,
  lucideSparkles,
  lucideSquareTerminal,
  lucideWorkflow,
  brandGithub,
  brandLinkedin,
  brandX,
} as const;

type IconName = keyof typeof ICONS;

export const ICON_REGISTRY: Readonly<Record<string, IconName>> = {
  // Links
  github: "brandGithub",
  linkedin: "brandLinkedin",
  x: "brandX",
  twitter: "brandX",
  mail: "lucideMail",
  website: "lucideGlobe",
  rss: "lucideRss",
  mastodon: "lucideAtSign",
  blog: "lucideNewspaper",
  chat: "lucideMessageCircle",
  // Capabilities
  cpu: "lucideCpu",
  "brain-circuit": "lucideBrainCircuit",
  container: "lucideContainer",
  database: "lucideDatabase",
  cloud: "lucideCloud",
  server: "lucideServer",
  code: "lucideCode",
  layers: "lucideLayers",
  sparkles: "lucideSparkles",
  bot: "lucideBot",
  shield: "lucideShield",
  workflow: "lucideWorkflow",
  "git-branch": "lucideGitBranch",
  terminal: "lucideSquareTerminal",
  // Experience
  work: "lucideBriefcase",
  education: "lucideGraduationCap",
  certification: "lucideAward",
};

/** Keys offered by the admin's icon pickers, in a stable order. */
export const ICON_KEYS: readonly string[] = Object.keys(ICON_REGISTRY);

/**
 * The icon name for a stored key. Unknown keys — say, one added in the CMS
 * before the client that draws it is deployed — get `fallback`.
 */
export function iconFor(key: string, fallback: IconName = "lucideLink"): IconName {
  return ICON_REGISTRY[key] ?? fallback;
}

/** Every registry icon, for a component's `viewProviders`. */
export function provideRegistryIcons() {
  return provideIcons(ICONS);
}
