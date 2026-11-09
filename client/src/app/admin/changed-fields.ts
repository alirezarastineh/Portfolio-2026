export interface ChangedField {
  path: string[];
  before: unknown;
  after: unknown;
}

/**
 * The fields that differ between what was saved and what is on screen.
 *
 * A field is what a person edits in one control: nested objects are walked
 * (`translations.de.hook` is one field), while a list (tags, outcomes, a
 * gallery) counts once, as it is one control. Keys in `ignore` are derived
 * from others (a cover's preview path follows its id) and would count twice.
 */
export function changedFields(
  before: unknown,
  after: unknown,
  ignore: readonly string[] = [],
  path: string[] = [],
): ChangedField[] {
  if (isRecord(before) && isRecord(after)) {
    return [...new Set([...Object.keys(before), ...Object.keys(after)])]
      .filter((key) => !ignore.includes(key))
      .flatMap((key) => changedFields(before[key], after[key], ignore, [...path, key]));
  }
  return sameValue(before, after) ? [] : [{ path, before, after }];
}

/** How many fields differ, for the save bar's "3 fields changed". */
export function countChangedFields(
  before: unknown,
  after: unknown,
  ignore: readonly string[] = [],
): number {
  return changedFields(before, after, ignore).length;
}

/** `undefined` (an optional key not there yet) and `null` read the same. */
export function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** "1 field changed", "3 fields changed". */
export function changedFieldsLabel(n: number): string {
  return `${n} ${n === 1 ? "field" : "fields"} changed`;
}
