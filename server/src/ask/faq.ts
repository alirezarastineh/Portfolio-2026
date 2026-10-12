import { sql } from "drizzle-orm";
import { z } from "zod";

import type { DbExecutor } from "../content/build.js";
import { LOCALES } from "../content/schema.js";
import { aiFaq, aiFaqTranslations } from "../db/schema.js";

/**
 * The assistant's FAQ entries (plan phase 19): answers to what the portfolio
 * does not cover, cited like any document and live on save. What an entry
 * takes, and how a new one is written: by the FAQ form's Save (admin.ts) and
 * by the admin's accept of an FAQ proposal (plan phase 31, agent/faq-decide.ts).
 */

export const faqInput = z.object({
  isVisible: z.boolean(),
  translations: z
    .object(
      Object.fromEntries(
        LOCALES.map((l) => [
          l,
          z
            .object({
              question: z.string().trim().min(3).max(300),
              answer: z.string().trim().min(3).max(3000),
            })
            .optional(),
        ]),
      ) as Record<
        (typeof LOCALES)[number],
        z.ZodOptional<z.ZodObject<{ question: z.ZodString; answer: z.ZodString }>>
      >,
    )
    .refine((t) => Object.values(t).some(Boolean), { message: "at least one language" }),
});

export type FaqInput = z.infer<typeof faqInput>;

/** A new entry at the end of the list, with its translations: live once the transaction commits. */
export async function insertFaq(tx: DbExecutor, input: FaqInput): Promise<string> {
  const [{ next } = { next: 0 }] = await tx
    .select({ next: sql<number>`coalesce(max(${aiFaq.position}) + 1, 0)::int` })
    .from(aiFaq);
  const [row] = await tx
    .insert(aiFaq)
    .values({ position: next, isVisible: input.isVisible })
    .returning({ id: aiFaq.id });
  const translations = LOCALES.flatMap((locale) => {
    const t = input.translations[locale];
    return t ? [{ faqId: row!.id, locale, ...t }] : [];
  });
  await tx.insert(aiFaqTranslations).values(translations);
  return row!.id;
}
