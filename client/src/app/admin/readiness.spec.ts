import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { appContentSchema, type AppContent, type Image } from "../content/schema";
import { checkReadiness, findPlaceholders, type ReadinessReport } from "./readiness";

const here = dirname(fileURLToPath(import.meta.url));
const load = (file: string): AppContent =>
  appContentSchema.parse(JSON.parse(readFileSync(resolve(here, `../content/${file}`), "utf8")));

/** The seed content: TODO copy, stub covers, no experience, no posts, no CV. */
const en = load("fallback.en.json");
const de = load("fallback.de.json");

const image = (alt: string): Image => ({
  src: "/media/cover.webp",
  srcset: "",
  sources: [],
  width: 1600,
  height: 1000,
  alt,
  blur: null,
});

/** Every string with its TODO written, and every section filled in. */
function finished(content: AppContent): AppContent {
  const written = JSON.parse(JSON.stringify(content).replaceAll("TODO", "Done")) as AppContent;
  return {
    ...written,
    identity: {
      ...written.identity,
      location: { city: "Berlin", country: "DE" },
      timezone: "Europe/Berlin",
      avatar: image("Portrait"),
      resume: { href: "/media/cv.pdf", bytes: 120_000 },
    },
    projects: written.projects.map((project, i) => ({
      ...project,
      cover: image(`${project.name} dashboard`),
      hasCaseStudy: true,
      featured: i === 0,
      metrics: [{ value: "40%", label: "less latency" }],
    })),
    experiences: [
      {
        id: "acme",
        kind: "work",
        org: { name: "Acme", url: "", logo: null },
        title: "Senior AI Engineer",
        summary: "",
        highlights: [],
        location: "Berlin",
        employmentType: "full-time",
        period: { start: "2024-03-01", end: null, precision: "month" },
        credential: null,
        skills: [],
      },
    ],
    posts: [
      {
        slug: "evals",
        title: "Notes on evals",
        excerpt: "",
        publishedAt: "2026-07-01T00:00:00.000Z",
        updatedAt: "2026-07-01T00:00:00.000Z",
        tags: [],
        cover: image("A chart of eval scores"),
        readingMinutes: 4,
        alternates: { en: "evals", de: null },
      },
    ],
  };
}

const check = (report: ReadinessReport, id: string) => {
  const found = report.checks.find((c) => c.id === id);
  if (!found) throw new Error(`no check ${id}`);
  return found;
};

describe("checkReadiness", () => {
  it("finds the seed content's placeholders, in both languages, with the editor that fixes each", () => {
    const report = checkReadiness({ en, de });
    const placeholders = check(report, "placeholders");

    expect(placeholders.passed).toBe(false);
    const descriptor = placeholders.hits.find(
      (hit) => hit.label === "projects[project-one].descriptor",
    );
    expect(descriptor).toMatchObject({
      link: "/admin/projects/project-one",
      locales: ["en", "de"],
    });
    expect(descriptor?.detail).toMatch(/^TODO/);
  });

  it("shows rich text's placeholders without their markup", () => {
    const problem = check(checkReadiness({ en }), "placeholders").hits.find(
      (hit) => hit.label === "projects[project-one].problem",
    );
    expect(problem?.detail).toMatch(/^TODO: /);
    expect(problem?.detail).not.toContain("<");
  });

  it("names list items by their slug, and plain lists by their index", () => {
    const labels = check(checkReadiness({ en }), "placeholders").hits.map((hit) => hit.label);
    expect(labels).toContain("projects[project-two].outcomes[0]");
  });

  it("reports what the seed content lacks", () => {
    const report = checkReadiness({ en, de });
    for (const id of ["covers", "case-studies", "experience", "resume", "posts", "location"]) {
      expect(check(report, id).passed, id).toBe(false);
    }
    expect(check(report, "covers").hits.map((hit) => hit.label)).toEqual([
      "projects[project-one].cover",
      "projects[project-two].cover",
      "projects[project-three].cover",
    ]);
    expect(check(report, "experience").hits).toEqual([
      { label: "experiences", detail: "", link: "/admin/experience", locales: ["en", "de"] },
    ]);
  });

  it("lists failing checks first, the worst first, and counts what passes", () => {
    const report = checkReadiness({ en, de });
    const order = report.checks.map((c) => `${c.passed ? "pass" : "fail"}:${c.severity}`);
    const failing = order.filter((entry) => entry.startsWith("fail"));

    expect(order.slice(0, failing.length)).toEqual(failing);
    expect(failing[0]).toBe("fail:blocker");
    expect(failing.indexOf("fail:tip")).toBeGreaterThan(failing.lastIndexOf("fail:warn"));
    expect(report.passed).toBe(report.checks.filter((c) => c.passed).length);
    expect(report.total).toBe(report.checks.length);
  });

  it("passes everything once the content is finished", () => {
    const report = checkReadiness({ en: finished(en), de: finished(de) });
    expect(report.checks.filter((c) => !c.passed).map((c) => c.id)).toEqual([]);
    expect(report.passed).toBe(report.total);
  });

  it("says which language a problem is in", () => {
    const report = checkReadiness({ en: finished(en), de: { ...finished(de), posts: [] } });
    expect(check(report, "posts").hits).toEqual([
      { label: "posts", detail: "", link: "/admin/writing", locales: ["de"] },
    ]);
  });

  it("asks for alt text on real covers only once they have none", () => {
    const ready = finished(en);
    const report = checkReadiness({
      en: { ...ready, projects: [{ ...ready.projects[0]!, cover: image(" ") }] },
    });
    expect(check(report, "alt-text").hits.map((hit) => hit.label)).toEqual([
      "projects[project-one].cover.alt",
    ]);
  });

  it("checks only the languages it was given (a draft that does not build is left out)", () => {
    const report = checkReadiness({ de });
    expect(report.locales).toEqual(["de"]);
    expect(check(report, "placeholders").hits.every((hit) => hit.locales.join() === "de")).toBe(
      true,
    );
  });
});

describe("findPlaceholders", () => {
  it("lists one language's placeholders for the publish review", () => {
    const hits = findPlaceholders(de);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((hit) => hit.locales.join() === "de")).toBe(true);
  });

  it("clips long text around the placeholder", () => {
    const long = `${"Intro words. ".repeat(10)}TODO: say what it does. ${"More. ".repeat(40)}`;
    const [hit] = findPlaceholders({
      ...finished(en),
      projects: [{ ...finished(en).projects[0]!, hook: long }],
    });
    expect(hit?.detail).toMatch(/^….*TODO: say what it does.*…$/);
    expect(hit?.detail.length).toBeLessThanOrEqual(92);
  });

  it("finds nothing in finished content", () => {
    expect(findPlaceholders(finished(en))).toEqual([]);
  });
});
