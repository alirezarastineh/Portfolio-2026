import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";

import { getDb } from "../../db/client.js";
import { aiCorpusSnapshots } from "../../db/schema.js";
import { countTokens } from "../tokens.js";
import type { CorpusDocument, PostFacts, ProjectFacts } from "./build.js";
import { renderCompact, renderCore, type AskCorpus } from "./index.js";
import { CorpusSearch } from "./search.js";

/**
 * The corpus as it was (plan phase 12): an eval case frozen from a visitor's
 * answer re-runs against the documents that answer saw, not today's. A
 * snapshot is written once per snapshot key, with the first visitor answer
 * logged on it (never from a run with `persist: false`, such as the laptop's
 * eval CLI, and never for the playground's drafts), and pruned once no answer
 * and no eval case refers to it.
 */

export interface CorpusSnapshot {
  key: string;
  documents: CorpusDocument[];
  projects: ProjectFacts[];
  posts: PostFacts[];
  coreTokens: number;
}

const keys = new WeakMap<AskCorpus, string>();

/**
 * What an answer is logged against: the corpus key plus a digest of the
 * documents. The corpus key names the content versions and the FAQ, not how a
 * deploy builds documents from them (the system card's model names, say), so
 * only the digest makes "the documents this answer saw" exact.
 */
export function snapshotKey(corpus: AskCorpus): string {
  let key = keys.get(corpus);
  if (!key) {
    const digest = createHash("sha256")
      .update(JSON.stringify(corpus.documents))
      .digest("hex")
      .slice(0, 12);
    key = `${corpus.key}#${digest}`;
    keys.set(corpus, key);
  }
  return key;
}

/** Snapshot keys this process has written or found: one insert per key per process. */
const recorded = new Set<string>();

export async function recordSnapshot(corpus: AskCorpus): Promise<void> {
  const key = snapshotKey(corpus);
  if (recorded.has(key)) return;
  await getDb()
    .insert(aiCorpusSnapshots)
    .values({
      key,
      documents: corpus.documents,
      projects: corpus.projects,
      posts: corpus.posts,
      coreTokens: corpus.coreTokens,
    })
    .onConflictDoNothing();
  recorded.add(key);
}

/** The corpus a snapshot holds, rendered and indexed as the live one is. */
export function askCorpusFromSnapshot(snapshot: CorpusSnapshot): AskCorpus {
  const core = renderCore(snapshot.documents);
  return {
    key: snapshot.key,
    documents: snapshot.documents,
    projects: snapshot.projects,
    posts: snapshot.posts,
    byId: new Map(snapshot.documents.map((d) => [d.id, d])),
    core,
    compact: renderCompact(snapshot.documents),
    coreTokens: countTokens(core),
    search: new CorpusSearch(snapshot.documents),
  };
}

/** A day's grace, so a snapshot is never pruned before its first answer is logged. */
const GRACE = sql`now() - interval '1 day'`;

/** Snapshots no answer and no eval case refers to any more. */
export async function pruneSnapshots(): Promise<void> {
  await getDb().execute(sql`
    delete from ai_corpus_snapshots s
    where s.created_at < ${GRACE}
      and not exists (select 1 from ai_messages m where m.corpus_key = s.key)
      and not exists (select 1 from ai_eval_cases c where c.snapshot_key = s.key)
  `);
  recorded.clear();
}

/** Tests only. */
export function resetRecordedSnapshots(): void {
  recorded.clear();
}
