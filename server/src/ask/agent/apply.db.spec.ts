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
  experiences,
  experienceTranslations,
  mediaAssets,
  posts,
  postTranslations,
  projects,
  projectTranslations,
  skillTranslations,
} from "../../db/schema.js";
import { seed } from "../../db/seed.js";
import { eventually, fixtureConfig, fixtureCorpus } from "../../test/ask-fixtures.js";
import { createAdmin, resetDb, TestClient } from "../../test/helpers.js";
import { recordUse } from "../skills/uses.js";
import { insertProposal, type NewProposal } from "./proposals.js";

const app = createApp({
  ask: {
    config: () => fixtureConfig(),
    chain: () => [],
    corpus: (c) => Promise.resolve(fixtureCorpus(c)),
  },
});

let admin: TestClient;
let runId: string;

beforeEach(async () => {
  await resetDb();
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  await seed();
  await createAdmin();
  admin = new TestClient(app);
  await admin.login();
  const [run] = await getDb()
    .insert(aiRuns)
    .values({ kind: "agent", status: "done", params: { task: "content" } })
    .returning({ id: aiRuns.id });
  runId = run.id;
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
  return row;
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

const statusOf = async (request: Promise<Response>): Promise<number> => {
  const res = await request;
  return res.status;
};
const apply = (id: string, body: Record<string, unknown> = {}) =>
  admin.post(`/admin/assistant/proposals/${id}/apply`, body);
const proposal = async (id: string) => {
  const rows = await getDb().select().from(aiProposals).where(eq(aiProposals.id, id));
  return rows[0];
};
const use = async (id: string | null) => {
  if (!id) {
    return undefined;
  }
  const rows = await getDb().select().from(aiSkillUses).where(eq(aiSkillUses.id, id));
  return rows[0];
};
const audited = (action: string) =>
  getDb().select().from(aiAudit).where(eq(aiAudit.action, action));
const revert = (id: string) => admin.post(`/admin/assistant/proposals/${id}/revert`, {});
const reject = (id: string) => admin.post(`/admin/assistant/proposals/${id}/reject`, {});

/** Until another session waits on a lock: the request has reached the row the test holds. */
const waitingOnLock = () =>
  eventually(async () => {
    const { rows } = await getDb().execute<{ n: number }>(
      sql`select count(*)::int as n from pg_locks where not granted`,
    );
    return rows[0].n > 0 ? true : undefined;
  });

const proposalRows = (count: number, from: number) =>
  Array.from({ length: count }, (_, i) => ({
    runId,
    goal: "translations" as const,
    kind: "project" as const,
    entityId: `entity-${from + i}`,
    field: "hook",
    locale: "de" as const,
    label: `${from + i} · Hook (DE)`,
    after: "Ein Haken.",
    skill: "translate",
    version: "v",
    status: "proposed" as const,
    // A second apart, so "newest" is plain.
    createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, from + i)),
  }));

/** A translation row's own date, as Postgres keeps it (microseconds and all). */
async function stampOf(
  id: string,
  locale: Locale,
  table = "project_translations",
  owner = "project_id",
): Promise<string> {
  const { rows } = await getDb().execute<{ at: string }>(
    sql`select updated_at::text as at from ${sql.identifier(table)}
      where ${sql.identifier(owner)} = ${id} and locale = ${locale}`,
  );
  return rows[0].at;
}

/** Whether date `a` is after date `b`, compared in Postgres. */
async function isAfter(a: string, b: string): Promise<boolean> {
  const { rows } = await getDb().execute<{ later: boolean }>(
    sql`select ${a}::timestamptz > ${b}::timestamptz as later`,
  );
  return rows[0].later;
}

/** A German site-copy leaf set to `value` in the drafts. */
async function setLeaf(path: string, value: string) {
  const [row] = await getDb()
    .select()
    .from(contentDocuments)
    .where(and(eq(contentDocuments.section, "ui"), eq(contentDocuments.locale, "de")));
  const data = structuredClone(row.data) as Record<string, Record<string, string>>;
  const [group, key] = path.split(".") as [string, string];
  data[group][key] = value;
  await getDb()
    .update(contentDocuments)
    .set({ data })
    .where(and(eq(contentDocuments.section, "ui"), eq(contentDocuments.locale, "de")));
  return row;
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
    // Ten German fields left empty, each with a proposal.
    const fields = ["hook", "descriptor", "role", "categoryLabel"] as const;
    const plan = all
      .flatMap((project, i) => fields.map((field) => ({ i, project, field })))
      .slice(0, 10);
    const applied = await plan.reduce<
      Promise<{ id: string; projectId: string; slug: string; field: string; text: string }[]>
    >(async (accPromise, { i, project, field }) => {
      const acc = await accPromise;
      await setText(project.id, "de", { [field]: "" });
      const after = `Deutsch ${i} ${field}.`;
      const id = await propose({
        entityId: project.id,
        field,
        label: `${i} · ${field} (DE)`,
        after,
      });
      return [...acc, { id, projectId: project.id, slug: project.slug, field, text: after }];
    }, Promise.resolve([]));
    expect(applied).toHaveLength(10);
    const pointers = await getDb().select().from(contentPointers);

    await applied.reduce(
      (chain, { id }) =>
        chain.then(async () => {
          expect(await statusOf(apply(id))).toBe(200);
        }),
      Promise.resolve(),
    );

    // Each one in the drafts, and in the preview, which builds from them.
    const previewRes = await admin.get("/admin/content/preview/de");
    const preview = (await previewRes.json()) as {
      projects: PreviewProject[];
    };
    await Promise.all(
      applied.map(async (p) => {
        const storedText = await text(p.projectId, "de");
        expect(storedText[p.field as "hook"], p.field).toBe(p.text);
        const shown = preview.projects.find((project) => project.slug === p.slug);
        expect(shown).toBeDefined();
        if (shown) {
          expect(PREVIEWED[p.field](shown), `${p.slug} ${p.field}`).toBe(p.text);
        }
        const prop = await proposal(p.id);
        expect(prop.status).toBe("applied");
        expect(await use(prop.useId)).toMatchObject({ outcome: "kept" });
      }),
    );
    expect(await audited("agent.apply")).toHaveLength(10);

    // Revert puts back what the field held.
    const [first] = applied;
    expect(await statusOf(revert(first.id))).toBe(200);
    const firstText = await text(first.projectId, "de");
    expect(firstText.hook).toBe("");
    const firstProposal = await proposal(first.id);
    expect(firstProposal.status).toBe("reverted");

    // Publish is still the admin's: nothing moved the live pointers.
    expect(await getDb().select().from(contentPointers)).toEqual(pointers);
  });

  it("puts a translation's date back on a revert, unless something else in it changed since", async () => {
    const [one, two] = await projectsInOrder();
    await setText(one.id, "de", { hook: "" });
    await setText(two.id, "de", { hook: "" });
    const before = await stampOf(one.id, "de");
    const first = await propose({ entityId: one.id });
    expect(await statusOf(apply(first))).toBe(200);
    // An apply dates the translation, as an editor's save would.
    expect(await stampOf(one.id, "de")).not.toBe(before);
    expect(await statusOf(revert(first))).toBe(200);
    // Reverted: its date is the one from before, to the microsecond.
    expect(await stampOf(one.id, "de")).toBe(before);

    // Another field changed between the apply and the revert: the revert dates it now.
    const earlier = await stampOf(two.id, "de");
    const second = await propose({ entityId: two.id });
    expect(await statusOf(apply(second))).toBe(200);
    await getDb().execute(
      sql`update project_translations set role = 'Neu', updated_at = now() + interval '1 second'
        where project_id = ${two.id} and locale = 'de'`,
    );
    expect(await statusOf(revert(second))).toBe(200);
    expect(await stampOf(two.id, "de")).not.toBe(earlier);
  });

  it("never overwrites a field changed since its draft: the proposal turns stale", async () => {
    const [project] = await projectsInOrder();
    await setText(project.id, "de", { hook: "" });
    const id = await propose({ entityId: project.id });
    await setText(project.id, "de", { hook: "Von Hand." });

    const res = await apply(id);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "stale" });
    const storedText = await text(project.id, "de");
    expect(storedText.hook).toBe("Von Hand.");
    const staleProposal = await proposal(id);
    expect(staleProposal.status).toBe("stale");
    expect(await use(staleProposal.useId)).toMatchObject({ outcome: "discarded" });
    expect(await audited("agent.apply")).toEqual([
      expect.objectContaining({ decision: "denied", target: id }),
    ]);
  });

  it("applies the admin's edit, and decides the draft as edited by its distance", async () => {
    const [project] = await projectsInOrder();
    await setText(project.id, "de", { hook: "" });
    const id = await propose({ entityId: project.id, after: "Ein neuer Haken für die Suche." });
    const res = await apply(id, { text: "Ein neuer Haken für die schnelle Suche." });
    expect(res.status).toBe(200);
    const editedText = await text(project.id, "de");
    expect(editedText.hook).toBe("Ein neuer Haken für die schnelle Suche.");
    const editedProposal = await proposal(id);
    expect(editedProposal).toMatchObject({
      status: "applied",
      after: "Ein neuer Haken für die schnelle Suche.",
    });
    expect(await use(editedProposal.useId)).toMatchObject({
      outcome: "edited",
      editDistance: 1,
    });
  });

  it("checks the text by its field's schema, and sanitizes rich text", async () => {
    const [project] = await projectsInOrder();
    await setText(project.id, "de", { descriptor: "", problem: "" });
    const long = await propose({
      entityId: project.id,
      field: "descriptor",
      after: "x".repeat(201),
    });
    const refused = await apply(long);
    expect(refused.status).toBe(400);
    expect(await refused.json()).toMatchObject({ error: "invalid_input" });
    const longProposal = await proposal(long);
    expect(longProposal.status).toBe("proposed");

    const rich = await propose({
      entityId: project.id,
      field: "problem",
      after: '<p>Ein Problem<script>alert(1)</script> <img src=x onerror="x()"></p>',
    });
    expect(await statusOf(apply(rich))).toBe(200);
    const richText = await text(project.id, "de");
    const stored = richText.problem;
    expect(stored).toContain("Ein Problem");
    expect(stored).not.toContain("<script");
    expect(stored).not.toContain("onerror");

    // Applied as drafted, it is kept, though the sanitizer rewrites its markup.
    await setText(project.id, "de", { body: "" });
    const markup = await propose({
      entityId: project.id,
      field: "body",
      after: "<p>Forschung & Entwicklung<br>heute</p>",
    });
    expect(await statusOf(apply(markup))).toBe(200);
    const bodyText = await text(project.id, "de");
    expect(bodyText.body).not.toBe("<p>Forschung & Entwicklung<br>heute</p>");
    const markupProposal = await proposal(markup);
    expect(await use(markupProposal.useId)).toMatchObject({ outcome: "kept" });

    // A blank text is no text to write.
    const blank = await propose({ entityId: project.id, field: "descriptor", after: "Kurz." });
    const refusedBlank = await apply(blank, { text: "   " });
    expect(refusedBlank.status).toBe(400);
    expect(await refusedBlank.json()).toMatchObject({ error: "invalid_input" });
    const blankProposal = await proposal(blank);
    expect(blankProposal.status).toBe("proposed");
  });

  it("applies and reverts an experience's, a skill's and a post's text: dated where they are, a post's body sanitized", async () => {
    const [experience] = await getDb()
      .insert(experiences)
      .values({ orgName: "Northwind", startDate: "2020-01-01", position: 0 })
      .returning({ id: experiences.id });
    await getDb()
      .insert(experienceTranslations)
      .values([
        { experienceId: experience.id, locale: "en", title: "Lead", summary: "Led search." },
        { experienceId: experience.id, locale: "de", title: "Leitung", summary: "" },
      ]);
    const [post] = await getDb()
      .insert(posts)
      .values({ slug: "a-post" })
      .returning({ id: posts.id });
    await getDb()
      .insert(postTranslations)
      .values([
        { postId: post.id, locale: "en", title: "A post", body: "<p>Hello.</p>" },
        { postId: post.id, locale: "de", title: "Ein Beitrag", body: "" },
      ]);
    const [skill] = await getDb()
      .select()
      .from(skillTranslations)
      .where(eq(skillTranslations.locale, "de"))
      .limit(1);
    const skillRow = and(
      eq(skillTranslations.skillId, skill.skillId),
      eq(skillTranslations.locale, "de"),
    );
    await getDb().update(skillTranslations).set({ caption: "" }).where(skillRow);
    const experienceText = async () => {
      const rows = await getDb()
        .select()
        .from(experienceTranslations)
        .where(
          and(
            eq(experienceTranslations.experienceId, experience.id),
            eq(experienceTranslations.locale, "de"),
          ),
        );
      return rows[0].summary;
    };
    const postBody = async () => {
      const rows = await getDb()
        .select()
        .from(postTranslations)
        .where(and(eq(postTranslations.postId, post.id), eq(postTranslations.locale, "de")));
      return rows[0].body;
    };
    const caption = async () => {
      const rows = await getDb().select().from(skillTranslations).where(skillRow);
      return rows[0].caption;
    };
    const experienceDate = () =>
      stampOf(experience.id, "de", "experience_translations", "experience_id");
    const postDate = () => stampOf(post.id, "de", "post_translations", "post_id");
    const experienceBefore = await experienceDate();
    const postBefore = await postDate();

    const summary = await propose({
      kind: "experience",
      entityId: experience.id,
      field: "summary",
      label: "Northwind · Summary (DE)",
      after: "Leitete die Suche.",
    });
    const skillCaption = await propose({
      kind: "skill",
      entityId: skill.skillId,
      field: "caption",
      label: "Skill · Caption (DE)",
      after: "Eine Unterschrift.",
    });
    const body = await propose({
      kind: "post",
      entityId: post.id,
      field: "body",
      label: "A post · Body (DE)",
      after: "<p>Hallo.<script>alert(1)</script></p>",
    });
    await [summary, skillCaption, body].reduce(
      (chain, id) =>
        chain.then(async () => {
          expect(await statusOf(apply(id))).toBe(200);
        }),
      Promise.resolve(),
    );

    expect(await experienceText()).toBe("Leitete die Suche.");
    expect(await experienceDate()).not.toBe(experienceBefore);
    expect(await caption()).toBe("Eine Unterschrift.");
    // A skill's translation has no date: nothing kept for a revert.
    const skillProposal = await proposal(skillCaption);
    expect(skillProposal.stampedBefore).toBeNull();
    expect(await postBody()).toContain("Hallo.");
    expect(await postBody()).not.toContain("<script");
    expect(await postDate()).not.toBe(postBefore);

    // Reverted: each text back, and the dated ones' dates too.
    await [summary, skillCaption, body].reduce(
      (chain, id) =>
        chain.then(async () => {
          expect(await statusOf(revert(id))).toBe(200);
        }),
      Promise.resolve(),
    );
    expect(await experienceText()).toBe("");
    expect(await experienceDate()).toBe(experienceBefore);
    expect(await caption()).toBe("");
    expect(await postBody()).toBe("");
    expect(await postDate()).toBe(postBefore);
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
    const leafProposal = await proposal(leaf);
    expect(leafProposal.status).toBe("proposed");
    expect(await statusOf(apply(leaf, { text: "Fallstudie {i}" }))).toBe(200);

    const unknown = await propose({
      kind: "section",
      entityId: "ui",
      field: "projectCard.nothing",
      after: "Nichts",
    });
    const unknownRes = await apply(unknown);
    expect(await unknownRes.json()).toMatchObject({
      error: "invalid_input",
      issues: [expect.objectContaining({ message: "Not a text field" })],
    });
  });

  it("applies and reverts a site-copy leaf through its section's lock, moving its token, and an image's alt text", async () => {
    const [row] = await getDb()
      .select()
      .from(contentDocuments)
      .where(and(eq(contentDocuments.section, "ui"), eq(contentDocuments.locale, "de")));
    const data = structuredClone(row.data) as { profile: { heroHeadline: string } };
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
    expect(await statusOf(apply(leaf))).toBe(200);
    const [after] = await getDb()
      .select()
      .from(contentDocuments)
      .where(and(eq(contentDocuments.section, "ui"), eq(contentDocuments.locale, "de")));
    expect((after.data as typeof data).profile.heroHeadline).toBe("Ein neuer Titel.");
    expect(after.updatedAt.getTime()).toBeGreaterThan(row.updatedAt.getTime());

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
      entityId: image.id,
      field: "alt",
      locale: "en",
      after: "The search pipeline's stages.",
    });
    expect(await statusOf(apply(alt))).toBe(200);
    const [stored] = await getDb().select().from(mediaAssets).where(eq(mediaAssets.id, image.id));
    expect(stored.altEn).toBe("The search pipeline's stages.");

    // Reverted, each holds again what it held: the leaf through the same lock, its token moved.
    const uiDe = and(eq(contentDocuments.section, "ui"), eq(contentDocuments.locale, "de"));
    const aMinuteAgo = new Date(Date.now() - 60_000);
    await getDb().update(contentDocuments).set({ updatedAt: aMinuteAgo }).where(uiDe);
    expect(await statusOf(revert(leaf))).toBe(200);
    const [reverted] = await getDb().select().from(contentDocuments).where(uiDe);
    expect((reverted.data as typeof data).profile.heroHeadline).toBe("");
    expect(reverted.updatedAt.getTime()).toBeGreaterThan(aMinuteAgo.getTime());
    expect(await statusOf(revert(alt))).toBe(200);
    const [restored] = await getDb().select().from(mediaAssets).where(eq(mediaAssets.id, image.id));
    expect(restored.altEn).toBe("");
  });

  it("rejects without writing, refuses a decided one, and reverts only what still holds", async () => {
    const [project] = await projectsInOrder();
    await setText(project.id, "de", { hook: "", role: "" });
    const rejected = await propose({ entityId: project.id });
    expect(await statusOf(reject(rejected))).toBe(200);
    const rejectedText = await text(project.id, "de");
    expect(rejectedText.hook).toBe("");
    const rejectedProposal = await proposal(rejected);
    expect(await use(rejectedProposal.useId)).toMatchObject({ outcome: "discarded" });
    expect(await audited("agent.reject")).toEqual([
      expect.objectContaining({ decision: "allowed", target: rejected }),
    ]);
    // Decided: neither applied nor rejected again, nor reverted.
    await [() => apply(rejected), () => reject(rejected)].reduce(
      (chain, send) =>
        chain.then(async () => {
          const res = await send();
          expect(res.status).toBe(409);
          expect(await res.json()).toEqual({ error: "not_open" });
        }),
      Promise.resolve(),
    );
    const notApplied = await revert(rejected);
    expect(notApplied.status).toBe(409);
    expect(await notApplied.json()).toEqual({ error: "not_applied" });

    const applied = await propose({ entityId: project.id, field: "role", after: "Leitung." });
    expect(await statusOf(apply(applied))).toBe(200);
    await setText(project.id, "de", { role: "Leitung, später geändert." });
    const changed = await revert(applied);
    expect(changed.status).toBe(409);
    expect(await changed.json()).toEqual({ error: "changed_since" });
    const changedText = await text(project.id, "de");
    expect(changedText.role).toBe("Leitung, später geändert.");
    const appliedProposal = await proposal(applied);
    expect(appliedProposal.status).toBe("applied");
    // Put back as it was applied, it reverts.
    await setText(project.id, "de", { role: "Leitung." });
    expect(await statusOf(revert(applied))).toBe(200);
    const revertedText = await text(project.id, "de");
    expect(revertedText.role).toBe("");
    const revertAudit = await audited("agent.revert");
    expect(
      revertAudit
        .map((row) => [row.target, row.decision] as const)
        .sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1])),
    ).toEqual([
      [applied, "allowed"],
      [applied, "denied"],
    ]);

    const missing = "00000000-0000-4000-8000-000000000999";
    await [() => apply(missing), () => reject(missing), () => revert(missing)].reduce(
      (chain, send) =>
        chain.then(async () => {
          const res = await send();
          expect(res.status).toBe(404);
          expect(await res.json()).toEqual({ error: "not_found" });
        }),
      Promise.resolve(),
    );
  });

  it("decides on a proposal as it stands once another decision lets go of it", async () => {
    const [project] = await projectsInOrder();
    await setText(project.id, "de", { hook: "" });
    const id = await propose({ entityId: project.id });
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
    const storedText = await text(project.id, "de");
    expect(storedText.hook).toBe("");
    const storedProposal = await proposal(id);
    expect(storedProposal.status).toBe("rejected");
  });

  it("keeps for a revert the date the apply replaced, even when an editor's save landed while it waited", async () => {
    const [project] = await projectsInOrder();
    await setText(project.id, "de", { hook: "" });
    const id = await propose({ entityId: project.id });
    // An editor's save holds the translation's row; the admin applies meanwhile.
    const editor = await getPool().connect();
    let saved: string;
    try {
      await editor.query("BEGIN");
      await editor.query(
        "SELECT 1 FROM project_translations WHERE project_id = $1 AND locale = 'de' FOR UPDATE",
        [project.id],
      );
      const applying = apply(id);
      await waitingOnLock();
      // It saves another field of the same translation, which dates it.
      const { rows } = await editor.query<{ at: string }>(
        `UPDATE project_translations SET role = 'Von Hand.', updated_at = date_trunc('milliseconds', now())
          WHERE project_id = $1 AND locale = 'de' RETURNING updated_at::text AS at`,
        [project.id],
      );
      saved = rows[0].at;
      await editor.query("COMMIT");
      expect(await statusOf(applying)).toBe(200);
    } finally {
      editor.release();
    }
    // The date kept is the save's, so a revert dates the row as the editor left it.
    expect(await statusOf(revert(id))).toBe(200);
    expect(await stampOf(project.id, "de")).toBe(saved);
    const storedText = await text(project.id, "de");
    expect(storedText.role).toBe("Von Hand.");
  });

  it("dates each apply after the translation's last date, so a revert never takes a later apply's date back", async () => {
    const [project] = await projectsInOrder();
    await setText(project.id, "de", { hook: "", role: "" });
    const first = await propose({ entityId: project.id });
    const second = await propose({ entityId: project.id, field: "role", after: "Leitung." });
    expect(await statusOf(apply(first))).toBe(200);
    // As if the first apply were dated at or after the moment the second starts (one batch,
    // the same millisecond): its date, on the row and on the proposal, an hour ahead.
    await getDb().execute(
      sql`update project_translations set updated_at = date_trunc('milliseconds', now() + interval '1 hour')
        where project_id = ${project.id} and locale = 'de'`,
    );
    await getDb().execute(
      sql`update ai_proposals set applied_at = (select updated_at from project_translations
        where project_id = ${project.id} and locale = 'de') where id = ${first}`,
    );
    const firstAt = await stampOf(project.id, "de");
    expect(await statusOf(apply(second))).toBe(200);
    // Dated after the first, and recorded with that same date.
    const secondAt = await stampOf(project.id, "de");
    expect(await isAfter(secondAt, firstAt)).toBe(true);
    const { rows } = await getDb().execute<{ at: string }>(
      sql`select applied_at::text as at from ai_proposals where id = ${second}`,
    );
    expect(rows[0].at).toBe(secondAt);
    // Reverting the first dates the row after the second's date, never back to the first's.
    expect(await statusOf(revert(first))).toBe(200);
    const storedText = await text(project.id, "de");
    expect(storedText.role).toBe("Leitung.");
    expect(await isAfter(await stampOf(project.id, "de"), secondAt)).toBe(true);
  });

  it("applies a needs-you proposal only with the admin's text", async () => {
    const [project] = await projectsInOrder();
    await setText(project.id, "de", { hook: "" });
    const none = await propose({ entityId: project.id, after: null, status: "needs_you" });
    const refused = await apply(none);
    expect(refused.status).toBe(409);
    expect(await refused.json()).toEqual({ error: "no_text" });
    expect(await statusOf(apply(none, { text: "Selbst geschrieben." }))).toBe(200);
    const storedText = await text(project.id, "de");
    expect(storedText.hook).toBe("Selbst geschrieben.");
  });

  it("decides a selection, each on its own, and lists open ones that changed since", async () => {
    const [project] = await projectsInOrder();
    await setText(project.id, "de", { hook: "", role: "", descriptor: "" });
    const first = await propose({ entityId: project.id });
    const second = await propose({ entityId: project.id, field: "role", after: "Leitung." });
    const third = await propose({ entityId: project.id, field: "descriptor", after: "Kurz." });
    // Its entity is not one: deciding it fails, and says so.
    const broken = await propose({ entityId: "not-a-uuid", field: "role", after: "Kaputt." });
    await setText(project.id, "de", { role: "Geändert." });

    type Listed = { proposals: { id: string; changed: boolean }[]; limited: boolean };
    const listedRes = await admin.get("/admin/assistant/proposals");
    const listed = (await listedRes.json()) as Listed;
    expect(listed.proposals.find((p) => p.id === first)?.changed).toBe(false);
    expect(listed.proposals.find((p) => p.id === second)?.changed).toBe(true);
    expect(listed.limited).toBe(false);

    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const res = await admin.post("/admin/assistant/proposals/decide", {
      ids: [first, second, broken, third],
      action: "apply",
    });
    expect(res.status).toBe(200);
    const decideBody = (await res.json()) as {
      results: { id: string; proposal?: { status: string }; error?: string }[];
    };
    expect(Object.keys(decideBody)).toEqual(["results"]);
    expect(decideBody).toMatchObject({
      results: [
        { id: first, proposal: { status: "applied" } },
        { id: second, error: "stale" },
        { id: broken, error: "failed" },
        // Decided after the failure all the same.
        { id: third, proposal: { status: "applied" } },
      ],
    });
    expect(decideBody.results[1]).toEqual({ id: second, error: "stale" });
    expect(decideBody.results[2]).toEqual({ id: broken, error: "failed" });
    const brokenProposal = await proposal(broken);
    expect(brokenProposal.status).toBe("proposed");

    // Listed by status, on the server.
    const statuses = async (query: string) => {
      const statusRes = await admin.get(`/admin/assistant/proposals?status=${query}`);
      const body = (await statusRes.json()) as Listed;
      return body.proposals.map((p) => p.id).sort((a, b) => a.localeCompare(b));
    };
    expect(await statuses("applied")).toEqual([first, third].sort((a, b) => a.localeCompare(b)));
    expect(await statuses("proposed,needs_you")).toEqual([broken]);
    expect(await statuses("stale,applied")).toEqual(
      [first, second, third].sort((a, b) => a.localeCompare(b)),
    );
    await ["bogus", "applied,bogus", ""].reduce(
      (chain, query) =>
        chain.then(async () => {
          const r = await admin.get(`/admin/assistant/proposals?status=${query}`);
          expect(r.status).toBe(400);
        }),
      Promise.resolve(),
    );
    await [
      { ids: [], action: "apply" },
      { ids: [first, first], action: "apply" },
      { ids: [first], action: "publish" },
    ].reduce(
      (chain, body) =>
        chain.then(async () => {
          const r = await admin.post("/admin/assistant/proposals/decide", body);
          expect(r.status).toBe(400);
        }),
      Promise.resolve(),
    );

    // A selection rejected: each on its own, an applied one refused, the drafts discarded.
    const rejected = await admin.post("/admin/assistant/proposals/decide", {
      ids: [broken, first],
      action: "reject",
    });
    const rejectedBody = (await rejected.json()) as {
      results: { id: string; proposal?: { status: string }; error?: string }[];
    };
    expect(rejectedBody).toMatchObject({
      results: [
        { id: broken, proposal: { status: "rejected" } },
        { id: first, error: "not_open" },
      ],
    });
    expect(rejectedBody.results[1]).toEqual({ id: first, error: "not_open" });
    const rejectedBroken = await proposal(broken);
    expect(await use(rejectedBroken.useId)).toMatchObject({ outcome: "discarded" });
    const storedHook = await text(project.id, "de");
    expect(storedHook.hook).toBe("Ein neuer Haken.");
  });

  it("lists the newest 200, and says there are more only when there are", async () => {
    type Listed = { proposals: { label: string }[]; limited: boolean };
    const list = async () => {
      const res = await admin.get("/admin/assistant/proposals?status=proposed");
      return (await res.json()) as Listed;
    };

    await getDb().insert(aiProposals).values(proposalRows(200, 0));
    const all = await list();
    expect(all.proposals).toHaveLength(200);
    expect(all.limited).toBe(false);

    await getDb().insert(aiProposals).values(proposalRows(1, 200));
    const more = await list();
    expect(more.proposals).toHaveLength(200);
    expect(more.limited).toBe(true);
    // Newest first: the oldest is the one not listed.
    expect(more.proposals[0].label).toBe("200 · Hook (DE)");
    expect(more.proposals.map((p) => p.label)).not.toContain("0 · Hook (DE)");
  });
});
