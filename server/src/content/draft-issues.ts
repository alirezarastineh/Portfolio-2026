import type { z } from "zod";

import { toIssues, type Issue } from "../lib/issues.js";
import type { Locale } from "./schema.js";

/** A problem in the built payload, with a path a person can follow. */
export interface DraftIssue extends Issue {
  /** The path with list items named: `projects[atlas].name`, `docs[post:hello].title`. */
  label: string;
}

/** Every reason one locale's draft cannot be published. */
export class DraftInvalidError extends Error {
  constructor(
    readonly locale: Locale,
    readonly issues: DraftIssue[],
  ) {
    const details = issues.map((i) => `${i.label}: ${i.message}`).join("; ");
    super(`the ${locale} draft is invalid: ${details}`);
    this.name = "DraftInvalidError";
  }
}

function itemName(item: unknown): string | null {
  if (!item || typeof item !== "object") return null;
  for (const field of ["slug", "id", "doc", "label"]) {
    const value = (item as Record<string, unknown>)[field];
    if (typeof value === "string" && value) return value;
  }
  return null;
}

/**
 * `["projects", 2, "name"]` over the value that failed → `projects[atlas].name`:
 * the index means nothing to someone editing, the slug does. An item without
 * a name keeps its position, marked (`socials[#3]`) so it never reads as a slug.
 */
export function issueLabel(value: unknown, path: readonly (string | number)[]): string {
  let label = "";
  let node = value;
  for (const segment of path) {
    if (typeof segment === "number") {
      const item = Array.isArray(node) ? (node[segment] as unknown) : undefined;
      const name = itemName(item) ?? "#" + String(segment);
      label += `[${name}]`;
      node = item;
    } else {
      label += label ? `.${segment}` : segment;
      node =
        node !== null && typeof node === "object"
          ? (node as Record<string, unknown>)[segment]
          : undefined;
    }
  }
  return label;
}

/** Zod issues on `value`, placed under `prefix` (`["docs", "project:atlas"]`) when it is a doc. */
export function draftIssues(
  value: unknown,
  issues: z.ZodError["issues"],
  prefix: { path: string[]; label: string } | null = null,
): DraftIssue[] {
  return toIssues(issues).map((issue) => {
    const own = issueLabel(value, issue.path);
    let label = own;
    if (prefix) {
      label = own ? `${prefix.label}.${own}` : prefix.label;
    }
    return {
      ...issue,
      path: prefix ? [...prefix.path, ...issue.path] : issue.path,
      label,
    };
  });
}
