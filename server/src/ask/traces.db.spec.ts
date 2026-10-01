import { beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";

import { getDb } from "../db/client.js";
import { aiMessages } from "../db/schema.js";
import { resetDb } from "../test/helpers.js";

beforeEach(async () => {
  await resetDb();
});

describe("migration 0010: answer traces and guard events", () => {
  it("adds the trace columns to ai_messages and the ai_guard_events table", async () => {
    const { rows } = await getDb().execute<{ column_name: string; is_nullable: string }>(sql`
      select column_name, is_nullable from information_schema.columns
      where table_name = 'ai_messages'
        and column_name in ('trace', 'dropped_citations', 'corpus_key', 'checks', 'judge')
      order by column_name`);
    expect(rows).toEqual([
      { column_name: "checks", is_nullable: "YES" },
      { column_name: "corpus_key", is_nullable: "YES" },
      { column_name: "dropped_citations", is_nullable: "NO" },
      { column_name: "judge", is_nullable: "YES" },
      { column_name: "trace", is_nullable: "YES" },
    ]);
    const { rows: keys } = await getDb().execute<{ column_name: string }>(sql`
      select k.column_name from information_schema.table_constraints c
      join information_schema.key_column_usage k on k.constraint_name = c.constraint_name
      where c.table_name = 'ai_guard_events' and c.constraint_type = 'PRIMARY KEY'
      order by k.ordinal_position`);
    expect(keys.map((k) => k.column_name)).toEqual(["day", "kind"]);
  });

  it("still takes the previous API's insert, which names none of the new columns", async () => {
    // Deploys go API first: until then the old API writes rows like this one.
    await getDb().execute(sql`
      insert into ai_messages
        (id, session_hash, locale, route, question_redacted, total_ms, tokens, finish_reason, prompt_version)
      values ('m_old0000001', 's', 'en', 'lite', 'q', 1,
        '{"input": 1, "cached": 0, "output": 1, "thoughts": 0}', 'stop', 'p')`);
    const [row] = await getDb().select().from(aiMessages);
    expect(row).toMatchObject({
      trace: null,
      droppedCitations: [],
      corpusKey: null,
      checks: null,
      judge: null,
    });
  });
});
