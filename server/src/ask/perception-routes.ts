import { zValidator } from "@hono/zod-validator";
import { and, eq, gte, inArray } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";

import { getDb } from "../db/client.js";
import { aiCorpusSnapshots, aiFeedback, aiMessages, aiSettings } from "../db/schema.js";
import { audit } from "./audit.js";
import type { CorpusDocument } from "./corpus/build.js";
import type { AskCorpus } from "./corpus/index.js";
import { MAX_DEMOTED, MAX_PROMOTED, type CorpusTiers } from "./corpus/render.js";
import { askConfig, askCorpus } from "./deps.js";
import { OUTCOME_COLUMNS } from "./outcome-rows.js";
import { isHelpful, rephrased } from "./outcomes.js";
import {
  measurePerception,
  REREAD_HEALTHY,
  suggestTiers,
  TIER_RULES,
  type PerceptionRow,
} from "./perception.js";
import { invalidateAssistantCache, readAiSettings } from "./settings.js";
import { measureWindow } from "./history-window.js";
import { measureTools } from "./tool-metrics.js";

/**
 * The admin's view of perception (plan phase 16), under
 * /admin/assistant/perception (the admin router's auth and CSRF apply): what
 * the assistant reads and how it uses it, over a window of visitor answers,
 * with tier suggestions; and the tiers the admin applies (L0: the system
 * suggests, the admin applies; every change audited).
 */
export const perceptionRouter = new Hono();

const DAY_MS = 24 * 60 * 60 * 1000;
const DEMOTABLE = new Set(["project", "post", "cv"]);

const invalid = (result: { success: boolean }, c: { json: (b: unknown, s: 400) => Response }) =>
  result.success ? undefined : c.json({ error: "invalid_input" }, 400);

perceptionRouter.get(
  "/",
  zValidator(
    "query",
    z.object({ days: z.coerce.number().int().min(1).max(90).optional() }),
    invalid,
  ),
  async (c) => {
    const days = c.req.valid("query").days ?? 30;
    const db = getDb();
    const rows = await db
      .select({
        ...OUTCOME_COLUMNS,
        locale: aiMessages.locale,
        tokens: aiMessages.tokens,
        citedIds: aiMessages.citedIds,
        trace: aiMessages.trace,
        corpusKey: aiMessages.corpusKey,
      })
      .from(aiMessages)
      .leftJoin(aiFeedback, eq(aiFeedback.messageId, aiMessages.id))
      .where(
        and(
          eq(aiMessages.source, "terminal"),
          gte(aiMessages.createdAt, new Date(Date.now() - days * DAY_MS)),
        ),
      );

    const keys = [...new Set(rows.flatMap((r) => (r.corpusKey ? [r.corpusKey] : [])))];
    const snapshots = new Map<string, CorpusDocument[]>();
    if (keys.length) {
      const stored = await db
        .select({ key: aiCorpusSnapshots.key, documents: aiCorpusSnapshots.documents })
        .from(aiCorpusSnapshots)
        .where(inArray(aiCorpusSnapshots.key, keys));
      for (const s of stored) snapshots.set(s.key, s.documents);
    }

    const again = rephrased(rows);
    const perception = measurePerception(
      rows.map((r): PerceptionRow => ({
        id: r.id,
        locale: r.locale,
        tokens: { input: r.tokens.input, output: r.tokens.output },
        usd: r.usd,
        citedIds: r.citedIds,
        trace: r.trace,
        corpusKey: r.corpusKey,
        helpful: isHelpful(r, again),
      })),
      snapshots,
    );

    const { corpusTiers } = await readAiSettings();
    let corpus: AskCorpus | null = null;
    try {
      corpus = await askCorpus(askConfig());
    } catch (error) {
      console.error("[ask] corpus unavailable for perception", error);
    }
    return c.json({
      days,
      ...perception,
      healthyReread: REREAD_HEALTHY,
      coreTokens: corpus?.coreTokens ?? null,
      rules: TIER_RULES,
      limits: { promoted: MAX_PROMOTED, demoted: MAX_DEMOTED },
      tiers: corpusTiers,
      suggestions: corpus
        ? suggestTiers(perception, corpus.documents, corpusTiers)
        : { promote: [], demote: [], considered: [] },
      // Titles for the ids in the lists, today's corpus.
      titles: Object.fromEntries((corpus?.documents ?? []).map((d) => [d.id, d.title])),
      // How each tool fares over the window (plan phase 21).
      tools: measureTools(rows.map((r) => ({ trace: r.trace, citedIds: r.citedIds }))),
      // Sessions whose history the conversation window trimmed (plan phase 22).
      window: measureWindow(rows, again),
    });
  },
);

const ids = (max: number) => z.array(z.string().trim().min(1).max(160)).max(max);

/** What changed, for the audit log: `promoted +a −b; demoted +c`. */
export function describeTierChange(before: CorpusTiers, after: CorpusTiers): string {
  const part = (name: keyof CorpusTiers) => {
    const added = after[name].filter((id) => !before[name].includes(id));
    const removed = before[name].filter((id) => !after[name].includes(id));
    const changes = [...added.map((id) => `+${id}`), ...removed.map((id) => `−${id}`)];
    return changes.length ? `${name} ${changes.join(" ")}` : null;
  };
  return [part("promoted"), part("demoted")].filter(Boolean).join("; ") || "no change";
}

/**
 * The tiers to apply, whole: the page sends the full lists after each change.
 * A new id must be a document of today's corpus; a stored one whose document
 * is no longer published is dropped (the page still lists it). Only a
 * project, post or CV can be cut shorter.
 */
perceptionRouter.put(
  "/tiers",
  zValidator("json", z.object({ promoted: ids(MAX_PROMOTED), demoted: ids(MAX_DEMOTED) }), invalid),
  async (c) => {
    const input = c.req.valid("json");
    const asked: CorpusTiers = {
      promoted: [...new Set(input.promoted)],
      demoted: [...new Set(input.demoted)],
    };
    if (asked.promoted.some((id) => asked.demoted.includes(id))) {
      return c.json({ error: "both_tiers" }, 400);
    }
    const before = (await readAiSettings()).corpusTiers;
    const stored = new Set([...before.promoted, ...before.demoted]);
    const corpus = await askCorpus(askConfig());
    const known = (id: string) => corpus.byId.has(id);
    const all = [...asked.promoted, ...asked.demoted];
    const unknown = all.find((id) => !known(id) && !stored.has(id));
    if (unknown) return c.json({ error: "unknown_document", id: unknown }, 400);
    const tiers: CorpusTiers = {
      promoted: asked.promoted.filter(known),
      demoted: asked.demoted.filter(known),
    };
    const dropped = all.filter((id) => !known(id));
    const fixed = tiers.demoted.find((id) => !DEMOTABLE.has(corpus.byId.get(id)!.kind));
    if (fixed) return c.json({ error: "not_demotable", id: fixed }, 400);

    const now = new Date();
    await getDb()
      .insert(aiSettings)
      .values({ id: 1, corpusTiers: tiers, updatedAt: now })
      .onConflictDoUpdate({ target: aiSettings.id, set: { corpusTiers: tiers, updatedAt: now } });
    // The next question reads the new corpus key at once (same process).
    invalidateAssistantCache();
    const change = describeTierChange(before, tiers);
    await audit({
      actor: "admin",
      action: "corpus.tiers",
      target: "corpus",
      decision: "allowed",
      reason: dropped.length ? `${change}; no longer published: ${dropped.join(" ")}` : change,
    });
    return c.json({ tiers, dropped });
  },
);
