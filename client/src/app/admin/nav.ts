/**
 * The admin's pages as the shell names them (plan 5, U8). The rail's groups and order, the
 * breadcrumb, the tab's title and Find's pages all read this one table.
 */

export interface NavItem {
  path: string;
  label: string;
  /** A Lucide icon the layout provides. */
  icon: string;
  /** Under another entry: the breadcrumb leads with it, and the rail indents it. */
  parent?: string;
  /** Where the top bar's Preview opens on this page: its section of the home draft (`#about`). */
  preview?: string;
  /** The content this page edits, as the review names it (`ui.about`): its rail dot follows it. */
  content?: string;
}

export interface NavGroup {
  /** A heading over the group, or none. */
  label?: string;
  items: NavItem[];
}

export const RAIL: NavGroup[] = [
  {
    items: [
      { path: "/admin", label: "Today", icon: "lucideHouse" },
      { path: "/admin/inbox", label: "Inbox", icon: "lucideInbox" },
    ],
  },
  {
    label: "Content",
    items: [
      { path: "/admin/hero", label: "Profile", icon: "lucideSquareUser" },
      // Until Profile takes the links (U11).
      { path: "/admin/socials", label: "Socials", icon: "lucideLink" },
      // The redesigned editor's pages (plan 5, U10) name their section and content; the rest in their Parts.
      {
        path: "/admin/about",
        label: "About",
        icon: "lucideFileText",
        preview: "#about",
        content: "ui.about",
      },
      { path: "/admin/projects", label: "Work", icon: "lucideBriefcase" },
      { path: "/admin/experience", label: "Experience", icon: "lucideSignpost" },
      { path: "/admin/skills", label: "Skills", icon: "lucideLayers" },
      { path: "/admin/writing", label: "Writing", icon: "lucideNewspaper" },
      // Both until Words holds their fields (U12).
      { path: "/admin/contact", label: "Contact copy", icon: "lucideSend" },
      { path: "/admin/copy", label: "Page copy", icon: "lucidePenLine" },
      { path: "/admin/legal", label: "Legal", icon: "lucideScale" },
      { path: "/admin/seo", label: "SEO & sharing", icon: "lucideShare2" },
      { path: "/admin/media", label: "Media", icon: "lucideImages" },
    ],
  },
  {
    items: [
      { path: "/admin/assistant", label: "Assistant", icon: "lucideBot" },
      {
        path: "/admin/agent",
        label: "Content agent",
        icon: "lucideListChecks",
        parent: "/admin/assistant",
      },
      { path: "/admin/publications", label: "History", icon: "lucideHistory" },
    ],
  },
];

export const ACCOUNT: NavItem = { path: "/admin/account", label: "Account", icon: "lucideUser" };

/** Every page: the rail's, then the two outside it (the draft's page is in the top bar too). */
export const PAGES: NavItem[] = [
  ...RAIL.flatMap((group) => group.items),
  { path: "/admin/preview", label: "Preview draft", icon: "lucideEye" },
  ACCOUNT,
];

const BY_LENGTH = [...PAGES].sort((a, b) => b.path.length - a.path.length);

/** The most specific page for a path (no query or fragment). */
export function navItemFor(path: string): NavItem | null {
  return (
    BY_LENGTH.find((item) =>
      item.path === "/admin"
        ? path === "/admin"
        : path === item.path || path.startsWith(`${item.path}/`),
    ) ?? null
  );
}

export interface Crumb {
  label: string;
  path: string;
  /** A slug, set as a value (B612, never translated). */
  value?: boolean;
}

/** Where a path is, from the top: the last crumb is the page itself. */
export function crumbsFor(path: string): Crumb[] {
  const item = navItemFor(path);
  if (!item) return [];
  const parent = item.parent ? navItemFor(item.parent) : null;
  const slug = /^\/admin\/(?:projects|writing)\/([^/]+)$/.exec(path)?.[1];
  return [
    ...(parent ? [{ label: parent.label, path: parent.path }] : []),
    { label: item.label, path: item.path },
    ...(slug ? [{ label: decodeURIComponent(slug), path, value: true }] : []),
  ];
}

/** The tab's title, the page first: "project-one · Work · Admin". */
export function titleFor(path: string): string {
  return [
    ...crumbsFor(path)
      .map((crumb) => crumb.label)
      .reverse(),
    "Admin",
  ].join(" · ");
}

/** Newest first, each once, at most `max`. */
export function remember<T extends { key: string }>(list: readonly T[], entry: T, max = 6): T[] {
  return [entry, ...list.filter((item) => item.key !== entry.key)].slice(0, max);
}
