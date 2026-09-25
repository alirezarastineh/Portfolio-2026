import { computed, signal } from "@angular/core";
import type { AbstractControl } from "@angular/forms";

import type { ApiIssue } from "./admin-api.service";

/** `["translations", "de", "name"]` → `translations.de.name`. */
export function issueKey(path: readonly (string | number)[]): string {
  return path.join(".");
}

/**
 * A save's per-field problems, keyed by path, for editors that keep their
 * state in signals rather than form controls. The first message per field
 * wins; a field's message goes as soon as it is edited.
 */
export class FieldIssues {
  private readonly map = signal<ReadonlyMap<string, string>>(new Map());

  readonly count = computed(() => this.map().size);

  set(issues: readonly ApiIssue[], strip: readonly (string | number)[] = []): void {
    const next = new Map<string, string>();
    for (const issue of issues) {
      const path = startsWith(issue.path, strip) ? issue.path.slice(strip.length) : issue.path;
      const key = issueKey(path);
      if (!next.has(key)) next.set(key, issue.message);
    }
    this.map.set(next);
  }

  /** One field's problem, e.g. after a 409 `duplicate_slug`. */
  add(path: string, message: string): void {
    this.map.update((current) => new Map(current).set(path, message));
  }

  clear(): void {
    if (this.map().size > 0) this.map.set(new Map());
  }

  /** The message for exactly this field. Reactive. */
  get(path: string): string | null {
    return this.map().get(path) ?? null;
  }

  /** The first message for this field or anything inside it (a list, a nested object). */
  under(path: string): string | null {
    for (const [key, message] of this.map()) {
      if (key === path || key.startsWith(`${path}.`)) return message;
    }
    return null;
  }

  /** Drops this field's messages (and those inside it) once it is edited. */
  resolve(path: string): void {
    const current = this.map();
    const next = new Map(
      [...current].filter(([key]) => key !== path && !key.startsWith(`${path}.`)),
    );
    if (next.size !== current.size) this.map.set(next);
  }

  entries(): [string, string][] {
    return Array.from(this.map());
  }
}

function startsWith(
  path: readonly (string | number)[],
  prefix: readonly (string | number)[],
): boolean {
  return prefix.every((segment, i) => path[i] === segment);
}

/**
 * Puts each issue on its form control as a `server` error, which the field
 * shows until the control's value next changes (Angular recomputes errors from
 * the validators then, and there are none). Returns the issues no control took.
 */
export function applyIssues(
  issues: readonly ApiIssue[],
  controlFor: (path: readonly (string | number)[]) => AbstractControl | null,
): ApiIssue[] {
  const unplaced: ApiIssue[] = [];
  for (const issue of issues) {
    const control = controlFor(issue.path);
    if (!control) {
      unplaced.push(issue);
      continue;
    }
    if (!control.errors?.["server"]) {
      control.setErrors({ ...control.errors, server: issue.message });
      control.markAsTouched();
    }
  }
  return unplaced;
}

/** How many controls under `control` still carry a save's `server` error. */
export function countServerErrors(control: AbstractControl): number {
  const own = control.errors?.["server"] ? 1 : 0;
  const children = (control as { controls?: Record<string, AbstractControl> | AbstractControl[] })
    .controls;
  if (!children) return own;
  return Object.values(children).reduce((sum, child) => sum + countServerErrors(child), own);
}

/** "3 fields need attention" and the first message, for a toast. */
export function issueSummary(issues: readonly ApiIssue[]): string {
  if (issues.length === 0) return "";
  const first = issues[0]!;
  const where = first.label ?? issueKey(first.path);
  const head = `${where}: ${first.message}`;
  return issues.length === 1 ? head : `${head} (and ${issues.length - 1} more)`;
}

/**
 * Moves focus to the first field marked invalid, after the view has shown
 * the messages — so a keyboard or screen-reader user lands on the problem.
 */
export function focusFirstInvalid(root: ParentNode | null | undefined): void {
  if (!root) return;
  setTimeout(() => {
    const field = root.querySelector<HTMLElement>('[aria-invalid="true"]');
    field?.focus();
    field?.scrollIntoView({ block: "center" });
  });
}
