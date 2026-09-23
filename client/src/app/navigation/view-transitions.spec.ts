import type { ActivatedRouteSnapshot, ViewTransitionInfo } from "@angular/router";
import { afterEach, describe, expect, it, vi } from "vitest";

import { animatePageChangesOnly, projectTransitionName } from "./view-transitions";

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

describe("animatePageChangesOnly", () => {
  afterEach(() => vi.unstubAllGlobals());

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
});

describe("projectTransitionName", () => {
  it("is a valid CSS identifier for any slug", () => {
    expect(projectTransitionName("2024-launch")).toBe("project-2024-launch");
  });
});
