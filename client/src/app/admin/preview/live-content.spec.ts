import { describe, expect, it } from "vitest";

import fallbackEn from "../../content/fallback.en.json";
import { appContentSchema, type AppContent } from "../../content/schema";
import type { ExperienceInput, MediaAsset, ProjectRow, SkillRow } from "../admin-api.service";
import {
  imageFromAsset,
  withExperiences,
  withIdentity,
  withProject,
  withSkills,
  withUi,
  type IdentityDraft,
} from "./live-content";

const base: AppContent = appContentSchema.parse(fallbackEn);

const asset: MediaAsset = {
  id: "a1",
  filename: "a1.png",
  originalName: "portrait.png",
  mime: "image/png",
  kind: "image",
  byteSize: 1000,
  width: 800,
  height: 600,
  blurDataUri: "data:image/webp;base64,xx",
  altEn: "",
  altDe: "Ein Porträt",
  createdAt: "2026-01-01T00:00:00.000Z",
  url: "https://api.example.com/media/a1.png",
  path: "/media/a1.png",
  variants: [
    { format: "webp", width: 480, height: 360, path: "/media/a1-480w.webp" },
    { format: "avif", width: 480, height: 360, path: "/media/a1-480w.avif" },
    { format: "webp", width: 800, height: 600, path: "/media/a1-800w.webp" },
  ],
};
const media = (id: string | null) => (id === asset.id ? asset : undefined);
const none = () => undefined;

describe("imageFromAsset", () => {
  it("builds the image as the server does: AVIF first, the other language's alt as a fallback", () => {
    expect(imageFromAsset(asset, "en", "Alireza")).toEqual({
      src: "/media/a1.png",
      srcset: "/media/a1-480w.webp 480w, /media/a1-800w.webp 800w",
      sources: [
        { type: "image/avif", srcset: "/media/a1-480w.avif 480w" },
        { type: "image/webp", srcset: "/media/a1-480w.webp 480w, /media/a1-800w.webp 800w" },
      ],
      width: 800,
      height: 600,
      alt: "Ein Porträt",
      blur: "data:image/webp;base64,xx",
    });
    expect(imageFromAsset({ ...asset, altDe: null }, "en", "Alireza")?.alt).toBe("Alireza");
    expect(imageFromAsset({ ...asset, kind: "document" }, "en", "x")).toBeNull();
  });
});

describe("withUi", () => {
  it("draws a group's fields over the draft's, in the language shown", () => {
    const next = withUi(base, "en", {
      about: { en: { heading: "Who", bio: "Hi." }, de: { heading: "Wer" } },
    });
    expect(next.ui.about.heading).toBe("Who");
    expect(next.ui.about.bio).toBe("Hi.");
    expect(next.ui.about.philosophy).toBe(base.ui.about.philosophy);
    expect(next.ui.hero).toBe(base.ui.hero);
  });
});

describe("withIdentity", () => {
  const draft: IdentityDraft = {
    name: "Ada",
    handle: "ada",
    contactEmail: "ada@example.com",
    primaryCtaHref: "#projects",
    secondaryCtaHref: "#contact",
    siteUrl: "",
    availability: "limited",
    locationCity: "Berlin",
    locationCountry: " de ",
    timezone: "Europe/Berlin",
    avatarId: "a1",
  };

  it("takes the fields as typed, the country code upper-cased", () => {
    const { identity } = withIdentity(base, "en", draft, null, media);
    expect(identity).toMatchObject({
      name: "Ada",
      availability: "limited",
      location: { city: "Berlin", country: "DE" },
      siteUrl: base.identity.siteUrl,
    });
    expect(identity.avatar?.src).toBe("/media/a1.png");
    expect(identity.resume).toEqual(base.identity.resume);
  });

  it("keeps the draft's photo until the library has loaded, and drops a removed one", () => {
    const saved = {
      ...base,
      identity: { ...base.identity, avatar: imageFromAsset(asset, "en", "") },
    };
    expect(withIdentity(saved, "en", draft, "a1", none).identity.avatar?.src).toBe("/media/a1.png");
    expect(
      withIdentity(saved, "en", { ...draft, avatarId: null }, "a1", media).identity.avatar,
    ).toBeNull();
  });
});

describe("withProject", () => {
  const first = base.projects[0]!;
  const row = {
    id: "p1",
    slug: "renamed",
    coverId: "a1",
    coverPath: "/media/a1.png",
    stack: ["Angular", " "],
    linkLive: "https://example.com",
    linkRepo: "",
    linkCaseStudy: "",
    isVisible: true,
    featured: true,
    periodStart: "2025-01-01",
    periodEnd: null,
    category: "ai",
    tags: [],
    gallery: [],
    position: 0,
    createdAt: "",
    updatedAt: "2026-01-01T00:00:00.000Z",
    translations: {
      en: {
        name: "Atlas",
        descriptor: "AI SEARCH",
        hook: "Finds things.",
        problem: "<p>Slow.</p>",
        aiArchitecture: "",
        fullStackInfra: "",
        outcomes: [],
        role: "Lead",
        categoryLabel: "",
        metrics: [
          { value: "40%", label: "faster" },
          { value: " ", label: "" },
        ],
        body: "<p>The story.</p>",
        seoDescription: "",
      },
      de: {} as never,
    },
  } as unknown as ProjectRow;

  it("replaces the project it was saved as, mapped as the server maps it", () => {
    const next = withProject(base, "en", row, { slug: first.slug, coverId: null }, media);
    expect(next.projects).toHaveLength(base.projects.length);
    expect(next.projects[0]).toMatchObject({
      slug: "renamed",
      name: "Atlas",
      stack: ["Angular"],
      featured: true,
      period: { start: "2025-01-01", end: null },
      category: { key: "ai", label: "ai" },
      metrics: [{ value: "40%", label: "faster" }],
      hasCaseStudy: true,
      links: { live: "https://example.com", repo: "", caseStudy: "" },
    });
    expect(next.projects[0]?.cover?.src).toBe("/media/a1.png");
  });

  it("puts a project the draft does not list (hidden, or new) at the end", () => {
    const next = withProject(base, "en", row, { slug: "not-there", coverId: null }, media);
    expect(next.projects).toHaveLength(base.projects.length + 1);
    expect(next.projects.at(-1)?.name).toBe("Atlas");
  });
});

describe("withExperiences", () => {
  const entry = (id: string, title: string, isVisible = true): ExperienceInput & { id: string } =>
    ({
      id,
      kind: "work",
      orgName: `Org ${id}`,
      orgUrl: "",
      logoId: null,
      location: "",
      employmentType: "",
      startDate: "2024-01-01",
      endDate: null,
      datePrecision: "month",
      credentialId: "",
      credentialUrl: "",
      skills: [],
      isVisible,
      translations: {
        en: { title, summary: "", highlights: ["Did it", " "] },
        de: { title: `${title} DE`, summary: "", highlights: [] },
      },
    }) as ExperienceInput & { id: string };

  it("follows the list's order and visibility, with the open entry in its place", () => {
    const rows = [entry("a", "First"), entry("b", "Hidden", false), entry("c", "Third")];
    const open = { ...entry("c", "Third, edited"), id: "c" };
    const next = withExperiences(base, "en", rows, open, none);
    expect(next.experiences.map((e) => e.title)).toEqual(["First", "Third, edited"]);
    expect(next.experiences[0]?.highlights).toEqual(["Did it"]);
  });

  it("shows a new entry at the end, and a hidden one while it is open", () => {
    const rows = [entry("a", "First"), entry("b", "Hidden", false)];
    const created = { ...entry("x", "New role"), id: null };
    expect(withExperiences(base, "en", rows, created, none).experiences.at(-1)?.title).toBe(
      "New role",
    );
    const hidden = { ...entry("b", "Hidden"), id: "b" };
    expect(withExperiences(base, "de", rows, hidden, none).experiences.map((e) => e.title)).toEqual(
      ["First DE", "Hidden DE"],
    );
  });
});

describe("withSkills", () => {
  it("lists the visible cards in the list's order, in the language shown", () => {
    const card = (id: string, isVisible: boolean) =>
      ({
        id,
        icon: "cpu",
        span: "sm",
        items: ["TS", ""],
        isVisible,
        position: 0,
        translations: {
          en: { title: `${id} EN`, caption: "", narrative: "" },
          de: { title: `${id} DE`, caption: "", narrative: "" },
        },
      }) as SkillRow;
    const next = withSkills(base, "de", [card("b", true), card("a", false), card("c", true)]);
    expect(next.skills.map((s) => s.title)).toEqual(["b DE", "c DE"]);
    expect(next.skills[0]?.items).toEqual(["TS"]);
  });
});
