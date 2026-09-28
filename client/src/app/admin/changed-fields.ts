/**
 * How many fields differ between what was saved and what is on screen, for
 * the save bar's "3 fields changed".
 *
 * A field is what a person edits in one control: nested objects are walked
 * (`translations.de.hook` is one field), while a list (tags, outcomes, a
 * gallery) counts once, as it is one control. Keys in `ignore` are derived
 * from others (a cover's preview path follows its id) and would count twice.
 */
export function countChangedFields(
  before: unknown,
  after: unknown,
  ignore: readonly string[] = [],
): number {
  if (isRecord(before) && isRecord(after)) {
    let changed = 0;
    for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
      if (!ignore.includes(key)) changed += countChangedFields(before[key], after[key], ignore);
    }
    return changed;
  }
  // `undefined` (an optional key not there yet) and `null` read the same.
  return JSON.stringify(before ?? null) === JSON.stringify(after ?? null) ? 0 : 1;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** "1 field changed", "3 fields changed". */
export function changedFieldsLabel(n: number): string {
  return `${n} ${n === 1 ? "field" : "fields"} changed`;
}
