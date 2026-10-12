import { randomBytes } from "node:crypto";

import { and, eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createApp } from "../../app.js";
import type { Locale } from "../../content/schema.js";
import { getDb, getPool } from "../../db/client.js";
import {
  aiAudit,
  aiProposals,
  aiRuns,
  aiSkillUses,
  contentDocuments,
  contentPointers,
  mediaAssets,
  projects,
  projectTranslations,
} from "../../db/schema.js";
import { seed } from "../../db/seed.js";
import { eventually, fixtureConfig, fixtureCorpus } from "../../test/ask-fixtures.js";
import { createAdmin, resetDb, TestClient } from "../../test/helpers.js";
import { recordUse } from "../skills/uses.js";
import { insertProposal, type NewProposal } from "./proposals.js";

const app = createApp({
  ask: { config: () => fixtureConfig(), chain: () => [], corpus: async (c) => fixtureCorpus(c) },
});

let admin: TestClient;
let runId: string;

beforeEach(async () => {
  await resetDb();
  vi.spyOn(console, "log").mockImplementation(() => {});
  await seed();
  await createAdmin();
  admin = new TestClient(app);
  await admin.login();
  const [run] = await getDb()
    .insert(aiRuns)
    .values({ kind: "agent", status: "done", params: { task: "content" } })
    .returning({ id: aiRuns.id });
  runId = run!.id;
});

async function projectsInOrder() {
  return getDb().select().from(projects).orderBy(projects.position);
}

async function text(projectId: string, locale: Locale) {
  const [row] = await getDb()
    .select()
    .from(projectTranslations)
    .where(
      and(eq(projectTranslations.projectId, projectId), eq(projectTranslations.locale, locale)),
    );
  return row!;
}

async function setText(projectId: string, locale: Locale, change: Record<string, string>) {
  await getDb()
    .update(projectTranslations)
    .set(change)
    .where(
      and(eq(projectTranslations.projectId, projectId), eq(projectTranslations.locale, locale)),
    );
}

/** A proposal as a content run leaves it, with its draft's skill use. */
async function propose(
  change: Partial<Omit<NewProposal, "runId">> & Pick<NewProposal, "entityId">,
) {
  const after = change.after === undefined ? "Ein neuer Haken." : change.after;
  const useId = after
    ? await recordUse({
        skill: "translate",
        version: "v",
        model: "m",
        text: after,
        abstained: false,
        source: "agent",
      })
    : null;
  return insertProposal({
    runId,
    goal: "translations",
    kind: "project",
    field: "hook",
    locale: "de",
    label: "Project · Hook (DE)",
    before: "",
    skill: "translate",
    version: "v",
    status: "proposed",
    useId,
    ...change,
    after,
  });
}

const apply = (id: string, body: Record<string, unknown> = {}) =>
  admin.post(`/admin/assistant/proposals/${id}/apply`, body);
const proposal = async (id: string) =>
  (await getDb().select().from(aiProposals).where(eq(aiProposals.id, id)))[0]!;
const use = async (id: string | null) =>
  (await getDb().select().from(aiSkillUses).where(eq(aiSkillUses.id, id!)))[0]!;
const audited = (action: string) =>
  getDb().select().from(aiAudit).where(eq(aiAudit.action, action));
const revert = (id: string) => admin.post(`/admin/assistant/proposals/${id}/revert`, {});
const reject = (id: string) => admin.post(`/admin/assistant/proposals/${id}/reject`, {});

/** A translation row's own date, as Postgres keeps it (microseconds and all). */
async function stampOf(projectId: string, locale: Locale): Promise<string> {
  const { rows } = await getDb().execute<{ at: string }>(
    sql`select updated_at::text as at from project_translations
      where project_id = ${projectId} and locale = ${locale}`,
  );
  return rows[0]!.at;
}

/** A German site-copy leaf set to `value` in the drafts. */
async function setLeaf(path: string, value: string) {
  const [row] = await getDb()
    .select()
    .from(contentDocuments)
    .where(and(eq(contentDocuments.section, "ui"), eq(contentDocuments.locale, "de")));
  const data = structuredClone(row!.data) as Record<string, Record<string, string>>;
  const [group, key] = path.split(".") as [string, string];
  data[group]![key] = value;
  await getDb()
    .update(contentDocuments)
    .set({ data })
    .where(and(eq(contentDocuments.section, "ui"), eq(contentDocuments.locale, "de")));
  return row!;
}

/** What the preview shows of each field a proposal can fill. */
type PreviewProject = {
  slug: string;
  hook: string;
  descriptor: string;
  role: string;
  category: { label: string } | null;
};
const PREVIEWED: Record<string, (p: PreviewProject) => string | undefined> = {
  hook: (p) => p.hook,
  descriptor: (p) => p.descriptor,
  role: (p) => p.role,
  categoryLabel: (p) => p.category?.label,
};

describe("deciding the content agent's proposals (plan phase 30)", () => {
  it("lands ten applied translations in the draft and its preview, reverts one, and publishes nothing (the done-when)", async () => {
    // A category, so its label shows in the preview.
    await getDb().update(projects).set({ category: "ai" });
    const all = await projectsInOrder();
    const applied: { id: string; projectId: string; slug: string; field: string; text: string }[] =
      [];
    // Ten German fields left empty, each with a proposal.
    const fields = ["hook", "descriptor", "role", "categoryLabel"] as const;
    for (const [i, project] of all.entries()) {
      for (const field of fields) {
        if (applied.length === 10) break;
        await setText(project.id, "de", { [field]: "" });
        const after = `Deutsch ${i} ${field}.`;
        const id = await propose({
          entityId: project.id,
          field,
          label: `${i} · ${field} (DE)`,
          after,
        });
        applied.push({ id, projectId: project.id, slug: project.slug, field, text: after });
      }
    }
    expect(applied).toHaveLength(10);
    const pointers = await getDb().select().from(contentPointers);

    for (const { id } of applied) expect((await apply(id)).status).toBe(200);

    // Each one in the drafts, and in the preview, which builds from them.
    const preview = (await (await admin.get("/admin/content/preview/de")).json()) as {
      projects: PreviewProject[];
    };
    for (const p of applied) {
      expect((await text(p.projectId, "de"))[p.field as "hook"], p.field).toBe(p.text);
      const shown = preview.projects.find((project) => project.slug === p.slug)!;
      expect(PREVIEWED[p.field]!(shown), `${p.slug} ${p.field}`).toBe(p.text);
      expect((await proposal(p.id)).status).toBe("applied");
      expect(await use((await proposal(p.id)).useId)).toMatchObject({ outcome: "kept" });
    }
    expect(await audited("agent.apply")).toHaveLength(10);

    // Revert puts back what the field held.
    const [first] = applied;
    expect((await revert(first!.id)).status).toBe(200);
    expect((await text(first!.projectId, "de")).hook).toBe("");
    expect((await proposal(first!.id)).status).toBe("reverted");

    // Publish is still the admin's: nothing moved the live pointers.
    expect(await getDb().select().from(contentPointers)).toEqual(pointers);
  });

  it("puts a translation's date back on a revert, unless something else in it changed since", async () => {
    const [one, two] = await projectsInOrder();
    await setText(one!.id, "de", { hook: "" });
    await setText(two!.id, "de", { hook: "" });
    const before = await stampOf(one!.id, "de");
    const first = await propose({ entityId: one!.id });
    expect((await apply(first)).status).toBe(200);
    // An apply dates the translation, as an editor's save would.
    expect(await stampOf(one!.id, "de")).not.toBe(before);
    expect((await revert(first)).status).toBe(200);
    // Reverted: its date is the one from before, to the microsecond.
    expect(await stampOf(one!.id, "de")).toBe(before);

    // Another field changed between the apply and the revert: the revert dates it now.
    const earlier = await stampOf(two!.id, "de");
    const second = await propose({ entityId: two!.id });
    expect((await apply(second)).status).toBe(200);
    await getDb().execute(
      sql`update project_translations set role = 'Neu', updated_at = now() + interval '1 second'
        where project_id = ${two!.id} and locale = 'de'`,
    );
    expect((await revert(second)).status).toBe(200);
    expect(await stampOf(two!.id, "de")).not.toBe(earlier);
  });

  it("never overwrites a field changed since its draft: the proposal turns stale", async () => {
    const [project] = await projectsInOrder();
    await setText(project!.id, "de", { hook: "" });
    const id = await propose({ entityId: project!.id });
    await setText(project!.id, "de", { hook: "Von Hand." });

    const res = await apply(id);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "stale" });
    expect((await text(project!.id, "de")).hook).toBe("Von Hand.");
    expect((await proposal(id)).status).toBe("stale");
    expect(await use((await proposal(id)).useId)).toMatchObject({ outcome: "discarded" });
    expect(await audited("agent.apply")).toEqual([
      expect.objectContaining({ decision: "denied", target: id }),
    ]);
  });

  it("applies the admin's edit, and decides the draft as edited by its distance", async () => {
    const [project] = await projectsInOrder();
    await setText(project!.id, "de", { hook: "" });
    const id = await propose({ entityId: project!.id, after: "Ein neuer Haken für die Suche." });
    const res = await apply(id, { text: "Ein neuer Haken für die schnelle Suche." });
    expect(res.status).toBe(200);
    expect((await text(project!.id, "de")).hook).toBe("Ein neuer Haken für die schnelle Suche.");
    expect(await proposal(id)).toMatchObject({
      status: "applied",
      after: "Ein neuer Haken für die schnelle Suche.",
    });
    expect(await use((await proposal(id)).useId)).toMatchObject({
      outcome: "edited",
      editDistance: 1,
    });
  });

  it("checks the text by its field's schema, and sanitizes rich text", async () => {
    const [project] = await projectsInOrder();
    await setText(project!.id, "de", { descriptor: "", problem: "" });
    const long = await propose({
      entityId: project!.id,
      field: "descriptor",
      after: "x".repeat(201),
    });
    const refused = await apply(long);
    expect(refused.status).toBe(400);
    expect(await refused.json()).toMatchObject({ error: "invalid_input" });
    expect((await proposal(long)).status).toBe("proposed");

    const rich = await propose({
      entityId: project!.id,
      field: "problem",
      after: '<p>Ein Problem<script>alert(1)</script> <img src=x onerror="x()"></p>',
    });
    expect((await apply(rich)).status).toBe(200);
    const stored = (await text(project!.id, "de")).problem;
    expect(stored).toContain("Ein Problem");
    expect(stored).not.toContain("<script");
    expect(stored).not.toContain("onerror");

    // Applied as drafted, it is kept, though the sanitizer rewrites its markup.
    await setText(project!.id, "de", { body: "" });
    const markup = await propose({
      entityId: project!.id,
      field: "body",
      after: "<p>Forschung & Entwicklung<br>heute</p>",
    });
    expect((await apply(markup)).status).toBe(200);
    expect((await text(project!.id, "de")).body).not.toBe(
      "<p>Forschung & Entwicklung<br>heute</p>",
    );
    expect(await use((await proposal(markup)).useId)).toMatchObject({ outcome: "kept" });

    // A blank text is no text to write.
    const blank = await propose({ entityId: project!.id, field: "descriptor", after: "Kurz." });
    const refusedBlank = await apply(blank, { text: "   " });
    expect(refusedBlank.status).toBe(400);
    expect(await refusedBlank.json()).toMatchObject({ error: "invalid_input" });
    expect((await proposal(blank)).status).toBe("proposed");
  });

  it("keeps a site-copy leaf's token: a text without it is refused, and an unknown leaf too", async () => {
    await setLeaf("projectCard.caseLabel", "");
    const leaf = await propose({
      kind: "section",
      entityId: "ui",
      field: "projectCard.caseLabel",
      after: "Fallstudie",
    });
    const refused = await apply(leaf);
    expect(refused.status).toBe(400);
    expect(await refused.json()).toMatchObject({
      error: "invalid_input",
      issues: [expect.objectContaining({ message: "must contain {i}" })],
    });
    expect((await proposal(leaf)).status).toBe("proposed");
    expect((await apply(leaf, { text: "Fallstudie {i}" })).status).toBe(200);

    const unknown = await propose({
      kind: "section",
      entityId: "ui",
      field: "projectCard.nothing",
      after: "Nichts",
    });
    expect(await (await apply(unknown)).json()).toMatchObject({
      error: "invalid_input",
      issues: [expect.objectContaining({ message: "Not a text field" })],
    });
  });

  it("applies a site-copy leaf through its section's lock, moving its token, and alt text to an image", async () => {
    const [row] = await getDb()
      .select()
      .from(contentDocuments)
      .where(and(eq(contentDocuments.section, "ui"), eq(contentDocuments.locale, "de")));
    const data = structuredClone(row!.data) as { profile: { heroHeadline: string } };
    data.profile.heroHeadline = "";
    await getDb()
      .update(contentDocuments)
      .set({ data })
      .where(and(eq(contentDocuments.section, "ui"), eq(contentDocuments.locale, "de")));
    const leaf = await propose({
      kind: "section",
      entityId: "ui",
      field: "profile.heroHeadline",
      after: "Ein neuer Titel.",
    });
    expect((await apply(leaf)).status).toBe(200);
    const [after] = await getDb()
      .select()
      .from(contentDocuments)
      .where(and(eq(contentDocuments.section, "ui"), eq(contentDocuments.locale, "de")));
    expect((after!.data as typeof data).profile.heroHeadline).toBe("Ein neuer Titel.");
    expect(after!.updatedAt.getTime()).toBeGreaterThan(row!.updatedAt.getTime());

    const [image] = await getDb()
      .insert(mediaAssets)
      .values({
        filename: `${randomBytes(8).toString("hex")}.png`,
        originalName: "diagram.png",
        mime: "image/png",
        byteSize: 10,
        checksumSha256: randomBytes(32),
      })
      .returning({ id: mediaAssets.id });
    const alt = await propose({
      goal: "alt",
      kind: "media",
      entityId: image!.id,
      field: "alt",
      locale: "en",
      after: "The search pipeline's stages.",
    });
    expect((await apply(alt)).status).toBe(200);
    const [stored] = await getDb().select().from(mediaAssets).where(eq(mediaAssets.id, image!.id));
    expect(stored!.altEn).toBe("The search pipeline's stages.");
  });

  it("rejects without writing, refuses a decided one, and reverts only what still holds", async () => {
    const [project] = await projectsInOrder();
    await setText(project!.id, "de", { hook: "", role: "" });
    const rejected = await propose({ entityId: project!.id });
    expect((await reject(rejected)).status).toBe(200);
    expect((await text(project!.id, "de")).hook).toBe("");
    expect(await use((await proposal(rejected)).useId)).toMatchObject({ outcome: "discarded" });
    expect(await audited("agent.reject")).toEqual([
      expect.objectContaining({ decision: "allowed", target: rejected }),
    ]);
    // Decided: neither applied nor rejected again, nor reverted.
    for (const res of [await apply(rejected), await reject(rejected)]) {
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: "not_open" });
    }
    const notApplied = await revert(rejected);
    expect(notApplied.status).toBe(409);
    expect(await notApplied.json()).toEqual({ error: "not_applied" });

    const applied = await propose({ entityId: project!.id, field: "role", after: "Leitung." });
    expect((await apply(applied)).status).toBe(200);
    await setText(project!.id, "de", { role: "Leitung, später geändert." });
    const changed = await revert(applied);
    expect(changed.status).toBe(409);
    expect(await changed.json()).toEqual({ error: "changed_since" });
    expect((await text(project!.id, "de")).role).toBe("Leitung, später geändert.");
    expect((await proposal(applied)).status).toBe("applied");
    // Put back as it was applied, it reverts.
    await setText(project!.id, "de", { role: "Leitung." });
    expect((await revert(applied)).status).toBe(200);
    expect((await text(project!.id, "de")).role).toBe("");
    expect((await audited("agent.revert")).map((row) => [row.target, row.decision]).sort()).toEqual(
      [
        [applied, "allowed"],
        [applied, "denied"],
      ],
    );

    const missing = "00000000-0000-4000-8000-000000000999";
    for (const res of [await apply(missing), await reject(missing), await revert(missing)]) {
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: "not_found" });
    }
  });

  /** Until another session waits on a lock: the request has reached the row the test holds. */
  const waitingOnLock = () =>
    eventually(async () => {
      const { rows } = await getDb().execute<{ n: number }>(
        sql`select count(*)::int as n from pg_locks where not granted`,
      );
      return rows[0]!.n > 0 ? true : undefined;
    });

  it("decides on a proposal as it stands once another decision lets go of it", async () => {
    const [project] = await projectsInOrder();
    await setText(project!.id, "de", { hook: "" });
    const id = await propose({ entityId: project!.id });
    // Another tab rejects it, holding the row; the admin applies it meanwhile.
    const other = await getPool().connect();
    try {
      await other.query("BEGIN");
      await other.query("SELECT id FROM ai_proposals WHERE id = $1 FOR UPDATE", [id]);
      const applying = apply(id);
      await waitingOnLock();
      await other.query(
        "UPDATE ai_proposals SET status = 'rejected', decided_at = now() WHERE id = $1",
        [id],
      );
      await other.query("COMMIT");
      // The apply reads the rejection: refused, the field never written.
      const res = await applying;
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: "not_open" });
    } finally {
      other.release();
    }
    expect((await text(project!.id, "de")).hook).toBe("");
    expect((await proposal(id)).status).toBe("rejected");
  });

  it("applies a needs-you proposal only with the admin's text", async () => {
    const [project] = await projectsInOrder();
    await setText(project!.id, "de", { hook: "" });
    const none = await propose({ entityId: project!.id, after: null, status: "needs_you" });
    const refused = await apply(none);
    expect(refused.status).toBe(409);
    expect(await refused.json()).toEqual({ error: "no_text" });
    expect((await apply(none, { text: "Selbst geschrieben." })).status).toBe(200);
    expect((await text(project!.id, "de")).hook).toBe("Selbst geschrieben.");
  });

  it("decides a selection, each on its own, and lists open ones that changed since", async () => {
    const [project] = await projectsInOrder();
    await setText(project!.id, "de", { hook: "", role: "", descriptor: "" });
    const first = await propose({ entityId: project!.id });
    const second = await propose({ entityId: project!.id, field: "role", after: "Leitung." });
    const third = await propose({ entityId: project!.id, field: "descriptor", after: "Kurz." });
    // Its entity is not one: deciding it fails, and says so.
    const broken = await propose({ entityId: "not-a-uuid", field: "role", after: "Kaputt." });
    await setText(project!.id, "de", { role: "Geändert." });

    type Listed = { proposals: { id: string; changed: boolean }[]; limited: boolean };
    const listed = (await (await admin.get("/admin/assistant/proposals")).json()) as Listed;
    expect(listed.proposals.find((p) => p.id === first)?.changed).toBe(false);
    expect(listed.proposals.find((p) => p.id === second)?.changed).toBe(true);
    expect(listed.limited).toBe(false);

    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await admin.post("/admin/assistant/proposals/decide", {
      ids: [first, second, broken, third],
      action: "apply",
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      results: [
        { id: first, proposal: expect.objectContaining({ status: "applied" }) },
        { id: second, error: "stale" },
        { id: broken, error: "failed" },
        // Decided after the failure all the same.
        { id: third, proposal: expect.objectContaining({ status: "applied" }) },
      ],
    });
    expect((await proposal(broken)).status).toBe("proposed");

    // Listed by status, on the server.
    const statuses = async (query: string) =>
      (
        (await (await admin.get(`/admin/assistant/proposals?status=${query}`)).json()) as Listed
      ).proposals
        .map((p) => p.id)
        .sort();
    expect(await statuses("applied")).toEqual([first, third].sort());
    expect(await statuses("proposed,needs_you")).toEqual([broken]);
    expect(await statuses("stale,applied")).toEqual([first, second, third].sort());
    for (const query of ["bogus", "applied,bogus", ""]) {
      expect((await admin.get(`/admin/assistant/proposals?status=${query}`)).status).toBe(400);
    }
    for (const body of [
      { ids: [], action: "apply" },
      { ids: [first, first], action: "apply" },
      { ids: [first], action: "publish" },
    ]) {
      expect((await admin.post("/admin/assistant/proposals/decide", body)).status).toBe(400);
    }
  });
});
