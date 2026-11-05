/** How long a copy button keeps saying how it went. */
export const COPIED_MS = 1600;

export type CopyResult = "copied" | "failed";

/** Puts text on the clipboard, and says how it went: a refusal has to reach the visitor. */
export async function copyText(text: string): Promise<CopyResult> {
  try {
    await navigator.clipboard.writeText(text);
    return "copied";
  } catch {
    return "failed";
  }
}
