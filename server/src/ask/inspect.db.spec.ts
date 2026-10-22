import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import { createApp } from "../app.js";
import { getDb } from "../db/client.js";
import { aiMessages } from "../db/schema.js";
import { apiError, failing, mockEntry, scripted, textTurn, toolTurn } from "../test/ask-models.js";
import { eventually, fixtureConfig, fixtureCorpus, readUiChunks } from "../test/ask-fixtures.js";
import { resetDb } from "../test/helpers.js";
import type { AskConfig } from "./config.js";
import { resetRecordedSnapshots } from "./corpus/snapshots.js";
import type { InspectView } from "./inspect.js";
import { resetBreakers } from "./models/circuit.js";
import type { ModelEntry } from "./models/registry.js";
import { invalidateAssistantCache } from "./settings.js";

/**
 * `POST /v1/ask/inspect` (visitor plan V12): the session that got an answer
 * reads what the log keeps of it, as `inspect.ts` projects it; any other
 * session, or an answer that is not a visitor's, gets nothing.
 */

let config: AskConfig;
let chain: ModelEntry[] = [];

const app = createApp({
  ask: { config: () => config, chain: () => chain, corpus: async (c) => fixtureCorpus(c) },
});

const SESSION = "inspect-session-0000001";
let ipCounter = 0;

async function ask(text: string, session = SESSION): Promise<string> {
  ipCounter++;
  const res = await app.request("/v1/ask", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": `198.51.100.${ipCounter}` },
    body: JSON.stringify({
      sessionId: session,
      locale: "en",
      messages: [{ id: `u${ipCounter}`, role: "user", parts: [{ type: "text", text }] }],
    }),
  });
  const chunks = await readUiChunks(res);
  const id = chunks.find((c) => c["type"] === "start")!["messageId"] as string;
  await eventually(async () => {
    const [row] = await getDb().select().from(aiMessages).where(eq(aiMessages.id, id));
    return row;
  });
  return id;
}

function inspect(messageId: string, sessionId = SESSION) {
  return app.request("/v1/ask/inspect", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionId, messageId }),
  });
}

beforeEach(async () => {
  await resetDb();
  invalidateAssistantCache();
  resetBreakers();
  resetRecordedSnapshots();
  config = fixtureConfig();
});

describe("POST /v1/ask/inspect", () => {
  it("shows the session its own answer as the projection: steps, lookups, citations, checks", async () => {
    const backup = scripted([
      toolTurn("search_portfolio", { query: "atlas evals" }),
      textTurn("Atlas [^project:atlas@en] [^project:nebula@en]."),
    ]);
    chain = [
      mockEntry("gemini-3.5-flash-lite", failing(apiError(429)).model),
      mockEntry("nvidia/nemotron-3-ultra-550b-a55b:free", backup.model),
    ];
    const id = await ask("What is Atlas? Mail me at jane@example.com");

    const res = await inspect(id);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const view = (await res.json()) as InspectView;
    expect(view).toMatchObject({
      v: 1,
      id,
      route: "lite",
      reason: "default",
      model: "nemotron-3-ultra",
      citations: { kept: ["project:atlas@en"], removed: 1 },
      guard: {},
      flags: expect.arrayContaining(["invented-citation", "degraded"]),
    });
    expect(view.prompt).toMatch(/^ask-/);
    expect(view.steps[0]).toMatchObject({
      model: "nemotron-3-ultra",
      passedOver: [{ model: "gemini-3.5-flash-lite", outcome: "rate-limited" }],
      tools: [{ name: "search_portfolio", input: "atlas evals", outcome: "ok" }],
    });
    // Neither the question, the answer, nor a provider's error message.
    const json = JSON.stringify(view);
    expect(json).not.toMatch(/jane@|What is Atlas|status 429|provider\.test/);
  });

  it("gives another session, and an answer that is not a visitor's, nothing", async () => {
    chain = [mockEntry("gemini-3.5-flash-lite", scripted([textTurn("ok")]).model)];
    const id = await ask("Hi");

    expect((await inspect(id, "some-other-session-000")).status).toBe(404);
    expect((await inspect("m_never_logged_00001")).status).toBe(404);
    await getDb().update(aiMessages).set({ source: "playground" }).where(eq(aiMessages.id, id));
    expect((await inspect(id)).status).toBe(404);
  });

  it("refuses what no terminal sends", async () => {
    const bad = (body: unknown) =>
      app.request("/v1/ask/inspect", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    expect((await bad({ sessionId: SESSION })).status).toBe(400);
    expect((await bad({ sessionId: "short", messageId: "m_atlas000001" })).status).toBe(400);
    expect((await bad({ sessionId: SESSION, messageId: "m_atlas" })).status).toBe(400);
  });
});
