import type { Context } from "hono";
import type { z } from "zod";

import {
  legalSectionInput,
  postInput,
  projectInput,
  type PostTranslationInput,
  type ProjectTranslationInput,
} from "../content/admin-schema.js";
import { sanitizeRichText } from "../content/sanitize.js";
import { toIssues } from "../lib/issues.js";

/**
 * The shared admin schemas plus sanitizing: rich-text fields are cleaned as
 * they are parsed, so nothing downstream can forget to do it.
 */

function cleanProjectTranslation(t: ProjectTranslationInput): ProjectTranslationInput {
  return {
    ...t,
    problem: sanitizeRichText(t.problem),
    aiArchitecture: sanitizeRichText(t.aiArchitecture),
    fullStackInfra: sanitizeRichText(t.fullStackInfra),
    body: sanitizeRichText(t.body),
    metrics: t.metrics.map((m) => ({
      value: m.value.trim(),
      label: m.label.trim(),
      ...(m.context?.trim() ? { context: m.context.trim() } : {}),
    })),
  };
}

function cleanPostTranslation(t: PostTranslationInput | null): PostTranslationInput | null {
  return t ? { ...t, body: sanitizeRichText(t.body) } : null;
}

export const projectInputSanitized = projectInput.transform((p) => ({
  ...p,
  translations: {
    en: cleanProjectTranslation(p.translations.en),
    de: cleanProjectTranslation(p.translations.de),
  },
}));

export const postInputSanitized = postInput.transform((p) => ({
  ...p,
  translations: {
    en: cleanPostTranslation(p.translations.en),
    de: cleanPostTranslation(p.translations.de),
  },
}));

export const legalSectionSanitized = legalSectionInput.transform((l) => ({
  title: l.title.trim(),
  body: sanitizeRichText(l.body),
}));

export { experienceInput } from "../content/admin-schema.js";

export async function readJson<T extends z.ZodType>(
  c: Context,
  schema: T,
): Promise<{ ok: true; data: z.output<T> } | { ok: false; response: Response }> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return { ok: false, response: c.json({ error: "invalid_input" }, 400) };
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return {
      ok: false,
      response: c.json({ error: "invalid_input", issues: toIssues(parsed.error.issues) }, 400),
    };
  }
  return { ok: true, data: parsed.data };
}

/** Path ids are uuids; anything else is a 400, not a lookup. */
export function isUuid(value: string | undefined): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
  );
}
