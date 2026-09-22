export type DiffKind = "added" | "removed" | "changed";

export interface DiffEntry {
  /** Dotted path, e.g. `ui.profile.heroHeadline` or `projects[my-slug].name`. */
  path: string;
  kind: DiffKind;
  before?: string;
  after?: string;
}

/** Keys a list by `slug`, else `id`, when every item has a unique one. */
function identityKeys(items: unknown[]): string[] | null {
  for (const field of ["slug", "id"]) {
    const keys = items.map((item) =>
      item !== null && typeof item === "object" ? (item as Record<string, unknown>)[field] : undefined,
    );
    if (keys.every((k): k is string => typeof k === "string") && new Set(keys).size === keys.length) {
      return keys;
    }
  }
  return null;
}

interface Leaf {
  /** Exact, type-preserving — `1` and `"1"` must not compare equal. */
  key: string;
  /** For display: strings unquoted, so prose reads as prose. */
  shown: string;
}

function leaf(value: unknown): Leaf {
  const key = JSON.stringify(value);
  return { key, shown: typeof value === "string" ? value : key };
}

/**
 * Flattens JSON into `path → rendered leaf`, in document order.
 *
 * Lists of objects with a `slug`/`id` are keyed by it rather than by index, so
 * reordering projects reads as one `(order)` change instead of every field of
 * every card changing at once. Lists of plain values (stack, outcomes) are one
 * leaf: an edit to a tag list is one change, not a cascade of shifted indexes.
 */
function flatten(value: unknown, path: string, out: Map<string, Leaf>): void {
  if (Array.isArray(value)) {
    flattenList(value, path, out);
    return;
  }

  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) {
      out.set(path, leaf({}));
      return;
    }
    for (const [key, child] of entries) {
      flatten(child, path ? `${path}.${key}` : key, out);
    }
    return;
  }

  out.set(path, leaf(value));
}

function flattenList(items: unknown[], path: string, out: Map<string, Leaf>): void {
  const keys = items.length > 0 ? identityKeys(items) : null;

  if (keys) {
    out.set(`${path} (order)`, leaf(keys.join(", ")));
    items.forEach((item, i) => flatten(item, `${path}[${keys[i]}]`, out));
  } else if (items.some((item) => item !== null && typeof item === "object")) {
    items.forEach((item, i) => flatten(item, `${path}[${i}]`, out));
  } else {
    out.set(path, leaf(items));
  }
}

/**
 * Leaf-level differences between two JSON documents, in the order they appear
 * in `before` (with anything only in `after` appended where it is met).
 */
export function diffJson(before: unknown, after: unknown): DiffEntry[] {
  const left = new Map<string, Leaf>();
  const right = new Map<string, Leaf>();
  flatten(before, "", left);
  flatten(after, "", right);

  const paths = [...new Set([...left.keys(), ...right.keys()])];
  const entries: DiffEntry[] = [];

  for (const path of paths) {
    const a = left.get(path);
    const b = right.get(path);

    if (a === undefined) {
      entries.push({ path, kind: "added", after: b?.shown });
    } else if (b === undefined) {
      entries.push({ path, kind: "removed", before: a.shown });
    } else if (a.key !== b.key) {
      entries.push({ path, kind: "changed", before: a.shown, after: b.shown });
    }
  }
  return entries;
}
