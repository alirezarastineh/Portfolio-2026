import type { MediaAsset } from "./admin-api.service";
import type { DraftMarks } from "./change-trace";
import type { Locale } from "../content/schema";

/** Where a file is used, in words, and the editor where that place is changed. */
export interface UsagePlace {
  label: string;
  link: string | null;
}

const LEGAL: Record<string, string> = { imprint: "Imprint", privacy: "Privacy" };

/**
 * The API's usage labels (`project:atlas (gallery)`, `resume:de`, `ui:en`, …)
 * as a person reads them, each with its editor.
 */
export function usagePlace(raw: string): UsagePlace {
  const at = raw.indexOf(":");
  const kind = at < 0 ? raw : raw.slice(0, at);
  const name = at < 0 ? "" : raw.slice(at + 1);
  switch (kind) {
    case "project": {
      const gallery = name.endsWith(" (gallery)");
      const slug = gallery ? name.slice(0, -" (gallery)".length) : name;
      return {
        label: `Project ${slug}${gallery ? ", gallery" : ""}`,
        link: `/admin/projects/${encodeURIComponent(slug)}`,
      };
    }
    case "post":
      return { label: `Post ${name}`, link: `/admin/writing/${encodeURIComponent(name)}` };
    case "profile":
      return { label: "Your photo", link: "/admin/hero" };
    case "resume":
      return { label: `CV (${name.toUpperCase()})`, link: "/admin/hero" };
    case "experience":
      return { label: `Experience: ${name}`, link: "/admin/experience" };
    case "imprint":
    case "privacy":
      return { label: `${LEGAL[kind]} (${name.toUpperCase()})`, link: "/admin/legal" };
    case "seo":
      return { label: `Search and sharing (${name.toUpperCase()})`, link: "/admin/seo" };
    case "ui":
      return { label: `Words (${name.toUpperCase()})`, link: "/admin/words" };
    default:
      return { label: raw, link: null };
  }
}

/** The languages an image still has no alt text in (none for a PDF). */
export function missingAlt(asset: MediaAsset): Locale[] {
  if (asset.kind !== "image") {
    return [];
  }
  return (["en", "de"] as const).filter(
    (locale) => !(locale === "en" ? asset.altEn : asset.altDe)?.trim(),
  );
}

/** "no alt", "no alt DE": what the tile says about a missing description. */
export function missingAltLabel(asset: MediaAsset): string | null {
  const missing = missingAlt(asset);
  if (missing.length === 0) {
    return null;
  }
  return missing.length === 2 ? "no alt" : `no alt ${missing[0]?.toUpperCase()}`;
}

/** The live site shows it; only the draft uses it; nothing does. Unknown until usage loads. */
export type UsageState = "live" | "draft" | "unused" | "unknown";

export function usageState(asset: MediaAsset): UsageState {
  if (!asset.usage) {
    return "unknown";
  }
  if (asset.usage.live) {
    return "live";
  }
  return asset.usage.draft.length ? "draft" : "unused";
}

/** Every alt text the content gives a picture of this file (`src` is the file's address). */
function altsOf(node: unknown, src: string, out: string[] = []): string[] {
  if (Array.isArray(node)) {
    for (const child of node) {
      altsOf(child, src, out);
    }
  } else if (node !== null && typeof node === "object") {
    const image = node as Record<string, unknown>;
    if (image["src"] === src && typeof image["alt"] === "string") {
      out.push(image["alt"]);
    } else {
      for (const child of Object.values(image)) {
        altsOf(child, src, out);
      }
    }
  }
  return out;
}

function nonEmpty(text: string | null | undefined): string | null {
  const trimmed = text?.trim() ?? "";
  return trimmed === "" ? null : trimmed;
}

/**
 * The saved alt text is not on the site yet (plan 5, U16): only the draft uses the file, or a live
 * picture of it says other words. The site falls back to the other language, then to a name of its
 * own, so with no words in either language there is nothing to compare. Gallery pictures live in
 * the case studies' pages, which the review does not hold: those are not compared.
 */
export function altInDraft(asset: MediaAsset, marks: DraftMarks | null): boolean {
  if (asset.kind !== "image") {
    return false;
  }
  const state = usageState(asset);
  if (state === "draft") {
    return true;
  }
  if (state !== "live" || !marks) {
    return false;
  }
  const src = `/media/${asset.filename}`;
  return (["en", "de"] as const).some((locale) => {
    const [own, other] = locale === "en" ? [asset.altEn, asset.altDe] : [asset.altDe, asset.altEn];
    const words = nonEmpty(own) ?? nonEmpty(other);
    return !!words && altsOf(marks.live[locale], src).some((alt) => alt !== words);
  });
}

/** Why a file cannot be deleted right now, or null when it can. */
export function deleteBlocker(asset: MediaAsset): string | null {
  const state = usageState(asset);
  if (state === "live") {
    return "The live site shows it. Publish without it first.";
  }
  if (state === "draft") {
    return "The draft uses it: change those places first.";
  }
  return null;
}
