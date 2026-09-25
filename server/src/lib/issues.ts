import type { z } from "zod";

type ZodIssue = z.ZodError["issues"][number];

/** A validation problem as the admin shows it: where, and what to do about it. */
export interface Issue {
  /** Where in the submitted (or built) value: `["translations", "de", "name"]`. */
  path: (string | number)[];
  /** One short sentence for a person, not a type error. */
  message: string;
  code: string;
}

function sentence(text: string): string {
  return text ? text[0]!.toUpperCase() + text.slice(1) : text;
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * Zod's messages are written for developers ("Too small: expected string to
 * have >=1 characters"); the admin sees these instead. Messages a schema set
 * itself ("a date as YYYY-MM-DD", "must contain {n}") are kept as they are.
 */
export function issueMessage(issue: ZodIssue): string {
  switch (issue.code) {
    case "too_small": {
      const min = Number(issue.minimum);
      if (issue.origin === "string") {
        return min <= 1 ? "Required" : `At least ${plural(min, "character", "characters")}`;
      }
      if (issue.origin === "array" || issue.origin === "set") {
        return `At least ${plural(min, "item", "items")}`;
      }
      return `At least ${min}`;
    }
    case "too_big": {
      const max = Number(issue.maximum);
      if (issue.origin === "string") return `At most ${plural(max, "character", "characters")}`;
      if (issue.origin === "array" || issue.origin === "set") {
        return `At most ${plural(max, "item", "items")}`;
      }
      return `At most ${max}`;
    }
    case "invalid_type":
      return issue.message.includes("received undefined") ? "Required" : sentence(issue.message);
    default:
      return sentence(issue.message);
  }
}

export function toIssues(issues: readonly ZodIssue[], prefix: (string | number)[] = []): Issue[] {
  return issues.map((issue) => ({
    path: [...prefix, ...issue.path.map((s) => (typeof s === "number" ? s : String(s)))],
    message: issueMessage(issue),
    code: issue.code,
  }));
}
