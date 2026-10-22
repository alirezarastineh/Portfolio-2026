/**
 * How technical the visitor wants answers (visitor plan V10): their own
 * choice with `level plain | standard | expert`, never a guess. It is kept
 * in this browser only, like the theme, and goes with each question; the
 * server keeps no preference of anyone's.
 */

export const LEVELS = ["plain", "standard", "expert"] as const;
export type Level = (typeof LEVELS)[number];

export const LEVEL_STORAGE_KEY = "ask:level";

export function isLevel(value: unknown): value is Level {
  return typeof value === "string" && (LEVELS as readonly string[]).includes(value);
}

/** The level this browser keeps; standard when none is kept, or storage is blocked. */
export function readLevel(storage: Pick<Storage, "getItem"> | null = localStorageOrNull()): Level {
  try {
    const value = storage?.getItem(LEVEL_STORAGE_KEY);
    return isLevel(value) ? value : "standard";
  } catch {
    return "standard";
  }
}

/** Keeps `level` in this browser; standard keeps nothing. */
export function storeLevel(
  level: Level,
  storage: Pick<Storage, "setItem" | "removeItem"> | null = localStorageOrNull(),
): void {
  try {
    if (level === "standard") storage?.removeItem(LEVEL_STORAGE_KEY);
    else storage?.setItem(LEVEL_STORAGE_KEY, level);
  } catch {
    // Storage may be blocked: the level then lasts for this page view.
  }
}

function localStorageOrNull(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}
