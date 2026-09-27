import { signal } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import type { ActivatedRouteSnapshot, ViewTransitionInfo } from "@angular/router";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LanguageService } from "../services/language.service";
import {
  animatePageChangesOnly,
  projectTitleTransitionName,
  projectTransitionName,
  studyDirection,
} from "./view-transitions";

/** A root snapshot whose chain of first children spells `path`. */
function snapshot(path: string): ActivatedRouteSnapshot {
  const segments = path.split("/").filter(Boolean);
  let node: { url: { path: string }[]; firstChild: unknown } | null = null;
  for (const segment of segments.reverse()) node = { url: [{ path: segment }], firstChild: node };
  return { url: [], firstChild: node } as unknown as ActivatedRouteSnapshot;
}

function transitionBetween(from: string, to: string) {
  const skipTransition = vi.fn();
  animatePageChangesOnly({
    transition: { skipTransition } as unknown as ViewTransition,
    from: snapshot(from),
    to: snapshot(to),
  } as ViewTransitionInfo);
  return skipTransition;
}

/** The types a browser with view-transition types would be given, run as the router runs the hook. */
function typesBetween(from: string, to: string): string[] {
  const types = new Set<string>();
  const projects = ["atlas", "beacon", "draft", "comet"].map((slug) => ({
    slug,
    hasCaseStudy: slug !== "draft",
  }));
  TestBed.resetTestingModule().configureTestingModule({
    providers: [{ provide: LanguageService, useValue: { content: signal({ projects }) } }],
  });
  TestBed.runInInjectionContext(() =>
    animatePageChangesOnly({
      transition: { skipTransition: vi.fn(), types } as unknown as ViewTransition,
      from: snapshot(from),
      to: snapshot(to),
    } as ViewTransitionInfo),
  );
  return [...types];
}

describe("animatePageChangesOnly", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    TestBed.resetTestingModule();
  });

  it("animates a move to another page", () => {
    expect(transitionBetween("/en", "/en/work/atlas")).not.toHaveBeenCalled();
  });

  it("does not animate a language switch or a move within the page", () => {
    expect(transitionBetween("/en/work/atlas", "/de/work/atlas")).toHaveBeenCalledOnce();
    expect(transitionBetween("/en", "/en")).toHaveBeenCalledOnce();
  });

  it("animates nothing for a visitor who asked for reduced motion", () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    expect(transitionBetween("/en", "/en/work/atlas")).toHaveBeenCalledOnce();
  });

  it("never reads the site's content on a move that is not between case studies", () => {
    // As the real service does outside a locale route (the admin): it throws.
    const content = () => {
      throw new Error('[i18n] "en" content read before the locale route loaded it');
    };
    TestBed.resetTestingModule().configureTestingModule({
      providers: [{ provide: LanguageService, useValue: { content } }],
    });
    const types = new Set<string>();
    const move = (from: string, to: string) =>
      TestBed.runInInjectionContext(() =>
        animatePageChangesOnly({
          transition: { skipTransition: vi.fn(), types } as unknown as ViewTransition,
          from: snapshot(from),
          to: snapshot(to),
        } as ViewTransitionInfo),
      );

    expect(() => move("/admin/login", "/admin")).not.toThrow();
    expect(() => move("/admin", "/admin/about")).not.toThrow();
    expect(() => move("/admin", "/en")).not.toThrow();
    expect([...types]).toEqual([]);
  });

  it("gives a move between case studies its direction in the home page's order", () => {
    expect(typesBetween("/en/work/atlas", "/en/work/comet")).toEqual(["forward"]);
    expect(typesBetween("/en/work/comet", "/en/work/beacon")).toEqual(["back"]);
    expect(typesBetween("/en", "/en/work/atlas")).toEqual([]);
    expect(typesBetween("/en/work/atlas", "/en/writing")).toEqual([]);
  });
});

describe("studyDirection", () => {
  const order = ["atlas", "beacon", "comet"];

  it("compares the two studies' places, whatever the language", () => {
    expect(studyDirection("/en/work/atlas", "/en/work/beacon", order)).toBe("forward");
    expect(studyDirection("/de/work/comet", "/de/work/atlas", order)).toBe("back");
  });

  it("is null unless both ends are known case studies", () => {
    expect(studyDirection("/en/work/atlas", "/en/work/atlas", order)).toBeNull();
    expect(studyDirection("/en/work/atlas", "/en/work/gone", order)).toBeNull();
    expect(studyDirection("/en", "/en/work/atlas", order)).toBeNull();
    expect(studyDirection("/en/work/atlas", "/en/writing/atlas", order)).toBeNull();
  });
});

describe("transition names", () => {
  it("are valid CSS identifiers for any slug", () => {
    expect(projectTransitionName("2024-launch")).toBe("project-2024-launch");
    expect(projectTitleTransitionName("2024-launch")).toBe("project-title-2024-launch");
  });
});
