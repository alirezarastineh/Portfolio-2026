import { describe, expect, it } from "vitest";

import type { DocChange } from "./admin-api.service";
import { changeRows, contentDiff } from "./publish-summary";
import { excerptOf, nameChange, wordChanges } from "./review-words";

const image = (name: string, alt: string) => ({
  src: `/media/${name}.webp`,
  srcset: `/media/${name}-640.webp 640w`,
  sources: [{ type: "image/webp", srcset: `/media/${name}-640.webp 640w` }],
  width: 640,
  height: 360 + name.length,
  alt,
  blur: null,
});

/** Live German, and a draft that changes something of every kind the review meets. */
const live = {
  ui: {
    about: { bio: "<p>Ich baue Systeme.</p>", heading: "Über mich" },
    contact: { submit: "Nachricht senden" },
    profile: { heroHeadline: "Hallo" },
    a: "1",
  },
  identity: { name: "Alireza", avatar: null },
  socials: [{ label: "GitHub", href: "https://github.com/a" }],
  projects: [
    { slug: "atlas", name: "Atlas", hook: "Alt", cover: image("a", "Alt"), stack: ["Go"] },
    { slug: "old", name: "Old one", hook: "Weg" },
  ],
  experiences: [{ id: "e1", title: "Staff engineer", summary: "Alt" }],
  skills: [{ id: "devops", title: "DevOps", items: ["Docker"] }],
  legal: [{ doc: "privacy", title: "Datenschutzerklärung" }],
  seo: { description: "Alt" },
  extras: { x: 1 },
};
const draft = {
  ui: {
    about: {
      bio: "<p>Ich baue <strong>verlässliche</strong>\n Systeme.</p>",
      heading: "Über mich",
    },
    contact: { submit: "Senden" },
    profile: { heroHeadline: "Hallo" },
    a: "2",
  },
  identity: { name: "Alireza R.", avatar: null },
  socials: [{ label: "GitHub", href: "https://github.com/b" }],
  projects: [
    {
      slug: "atlas",
      name: "Atlas",
      hook: "Neu",
      cover: image("bb", "Neu"),
      stack: ["Go", "Rust"],
      featured: true,
    },
    { slug: "nova", name: "Nova", hook: "Hallo" },
  ],
  experiences: [{ id: "e1", title: "Principal engineer", summary: "Alt" }],
  skills: [{ id: "devops", title: "DevOps", items: ["Docker", "Kubernetes"] }],
  legal: [{ doc: "privacy", title: "Datenschutzerklärung" }],
  seo: { description: "Neu" },
  extras: { x: 2 },
};
const docs: DocChange[] = [
  {
    key: "project:atlas",
    change: "changed",
    live: { body: "<p>Alt</p>" } as never,
    draft: { body: "<h2>Ziel</h2><p>Ein neuer Text.</p>" } as never,
  },
  { key: "legal:privacy", change: "changed", live: null, draft: null },
  { key: "post:hello", change: "added", live: null, draft: { body: "<p>Hallo</p>" } as never },
];

const side = { locale: "de" as const, before: live, after: draft };
const rows = changeRows(live, draft, docs);
const groups = wordChanges([{ ...side, rows }]);
const said = (page: string) =>
  groups
    .find((group) => group.page === page)
    ?.changes.map((c) => {
      const label = c.named ? c.what : `[${c.what}]`;
      return `${label} ${c.kind}`;
    });
const openOf = (path: string) => nameChange(path, side).open;
const excerptAt = (path: string): string | null => {
  const row = rows.find((entry) => entry.path === path);
  if (!row) {
    throw new Error(`Missing row ${path}`);
  }
  return excerptOf(row);
};

describe("the review in words", () => {
  it("groups every change by the page that edits it, in the rail's order, the unknown last", () => {
    expect(groups.map((group) => group.page)).toEqual([
      "Profile",
      "About",
      "Work",
      "Experience",
      "Skills",
      "Writing",
      "Words",
      "Legal",
      "SEO & sharing",
      "Media",
      "Other",
    ]);
  });

  it("names each field as its editor does, and an item by its name", () => {
    expect(said("Profile")).toEqual(["Name changed", "Links changed"]);
    expect(said("About")).toEqual(["Bio changed"]);
    // An item's changes together, its page last of them.
    expect(said("Work")).toEqual([
      "Order changed",
      "Atlas › Hook changed",
      "Atlas › Cover image changed",
      "Atlas › Tech stack changed",
      "Atlas › Featured added",
      "Atlas › Case study page changed",
      "Old one removed",
      "Nova added",
    ]);
    expect(said("Experience")).toEqual(["Principal engineer › Title changed"]);
    expect(said("Skills")).toEqual(["DevOps › Skills changed"]);
    expect(said("Writing")).toEqual(["hello › Post page added"]);
    expect(said("Words")).toEqual(["Contact › Send button changed", "[ui.a] changed"]);
    expect(said("Legal")).toEqual(["Datenschutzerklärung changed"]);
    expect(said("SEO & sharing")).toEqual(["Meta description changed"]);
    // Alt text is written in Media, whichever page shows the picture.
    expect(said("Media")).toEqual(["Atlas › Cover image, alt text changed"]);
  });

  it("shows a path nothing names as itself, and drops none", () => {
    expect(said("Other")).toEqual(["[extras.x] changed"]);
    expect(groups.flatMap((group) => group.changes)).toHaveLength(rows.length);
    expect(rows.flatMap((row) => row.entries)).toHaveLength(contentDiff(live, draft).length);
    expect(nameChange("ui.about.newKey", side)).toEqual({
      page: "About",
      what: "ui.about.newKey",
      named: false,
      open: { path: "/admin/about" },
    });
  });

  it("opens each where it is changed: Words' row, the entry, the document, the editor", () => {
    expect(openOf("ui.contact.submit")).toEqual({
      path: "/admin/words",
      query: { row: "contact.submit" },
    });
    expect(openOf("ui.about.bio")).toEqual({ path: "/admin/about" });
    expect(openOf("projects[atlas].hook")).toEqual({ path: "/admin/projects/atlas" });
    expect(openOf("projects[old]")).toEqual({ path: "/admin/projects" });
    expect(openOf("projects (order)")).toEqual({ path: "/admin/projects" });
    expect(openOf("projects[atlas].cover.alt")).toEqual({ path: "/admin/media" });
    expect(openOf("experiences[e1].title")).toEqual({
      path: "/admin/experience",
      query: { edit: "e1" },
    });
    expect(openOf("legal:privacy")).toEqual({ path: "/admin/legal", query: { doc: "privacy" } });
    expect(openOf("legal:imprint")).toEqual({ path: "/admin/legal" });
    expect(openOf("post:hello")).toEqual({ path: "/admin/writing/hello" });
    expect(openOf("socials")).toEqual({ path: "/admin/hero" });
    expect(openOf("extras.x")).toBeNull();
  });

  it("keeps both languages of a field together, English first", () => {
    const en = { ...side, locale: "en" as const };
    const both = wordChanges([
      { ...en, rows: changeRows(live, draft) },
      { ...side, rows: changeRows(live, draft) },
    ]).find((group) => group.page === "About")?.changes;
    expect(both?.map((c) => `${c.what} ${c.locale}`)).toEqual(["Bio en", "Bio de"]);
  });
});

describe("the excerpt", () => {
  it("is the new text, plain: no tags, one space between words", () => {
    expect(excerptAt("ui.about.bio")).toBe("Ich baue verlässliche Systeme.");
    expect(excerptAt("ui.contact.submit")).toBe("Senden");
  });

  it("is a page's body for a doc, a list's items, yes or no for a switch", () => {
    expect(excerptAt("project:atlas")).toBe("Ziel Ein neuer Text.");
    expect(excerptAt("projects[atlas].stack")).toBe("Go, Rust");
    expect(excerptAt("projects[atlas].featured")).toBe("Yes");
  });

  it("is none for a picture, an order, a whole item or what was removed", () => {
    expect(excerptAt("projects[atlas].cover")).toBeNull();
    expect(excerptAt("projects (order)")).toBeNull();
    expect(excerptAt("projects[nova]")).toBeNull();
    expect(excerptAt("projects[old]")).toBeNull();
  });
});
