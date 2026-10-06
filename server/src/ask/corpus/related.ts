import type { Locale } from "../../content/schema.js";
import type { CorpusDocument, ProjectFacts } from "./build.js";

/**
 * Related documents (plan phase 19, Progressive Discovery: forage, focus,
 * deepen). A document's header names the documents an exception may sit in,
 * so an answer follows the reference instead of stopping at the first
 * document that seems to answer. In the same language only, at most five,
 * from what the documents and the projects' facts say; no model involved:
 *
 * - an employer and its projects (the project's text names the employer);
 * - documents that share at least two stack items, tags or skills (projects,
 *   employers);
 * - a post and the projects it names (from the post);
 * - the FAQ and the profile (what a visitor asks about him).
 */

export const MAX_RELATED = 5;

/** How strongly two documents relate: what makes a link, first ones first. */
const STRENGTH = { employer: 4, shared: 3, named: 2, faq: 1 } as const;

interface Node {
  doc: CorpusDocument;
  /** Stack items, tags or skills, lower-cased. */
  items: Set<string>;
}

/** "Senior AI Engineer — Northwind Labs" → "Northwind Labs" (the title build.ts writes). */
function employerOf(d: CorpusDocument): string | null {
  const at = d.title.lastIndexOf(" — ");
  return at < 0 ? null : d.title.slice(at + 3).trim() || null;
}

/** The items a "Skills: a, b" or "Stack: a, b" line of the text lists. */
function listed(text: string, label: string): string[] {
  const line = text.split("\n").find((l) => l.startsWith(`${label}: `));
  return line ? line.slice(label.length + 2).split(",") : [];
}

const clean = (items: readonly string[]) =>
  new Set(items.map((i) => i.trim().toLowerCase()).filter(Boolean));

/** Whether `text` names `name` as a whole word or phrase, in any case. */
export function names(text: string, name: string): boolean {
  const needle = name.trim().toLowerCase();
  if (needle.length < 3) return false;
  const hay = text.toLowerCase();
  for (let at = hay.indexOf(needle); at >= 0; at = hay.indexOf(needle, at + 1)) {
    const before = hay[at - 1];
    const after = hay[at + needle.length];
    if (!isWordChar(before) && !isWordChar(after)) return true;
  }
  return false;
}

function isWordChar(char: string | undefined): boolean {
  return char !== undefined && /[\p{L}\p{N}]/u.test(char);
}

/**
 * The words that make a FAQ entry one the profile should point to first: what
 * a visitor checks against the profile (availability, location, moving,
 * notice, the kind of work), in English and German. Kept as separate patterns
 * so each stays under the regex-complexity limit.
 */
const PROFILE_TOPICS: readonly RegExp[] = [
  /\bavailab\w*\b/i,
  /\bopen to\b/i,
  /\bstart\b/i,
  /\bnotice\b/i,
  /\brelocat\w*\b/i,
  /\bmove\b/i,
  /\bmoving\b/i,
  /\bremote\b/i,
  /\bon.?site\b/i,
  /\bbased\b/i,
  /\blocation\b/i,
  /\btime ?zone\b/i,
  /\bhire\b/i,
  /\bhiring\b/i,
  /\bcontract\w*\b/i,
  /\bfreelanc\w*\b/i,
  /\bfull.?time\b/i,
  /\bpart.?time\b/i,
  /\bverfügbar\w*\b/i,
  /\bkündigung\w*\b/i,
  /\bumzug\b/i,
  /\bumziehen\b/i,
  /\bvor ort\b/i,
  /\bstandort\b/i,
  /\bwohnort\b/i,
  /\banstellung\b/i,
  /\bfestanstellung\b/i,
];

const onProfileTopic = (text: string) => PROFILE_TOPICS.some((pattern) => pattern.test(text));

function shared(a: Set<string>, b: Set<string>): number {
  let n = 0;
  for (const item of a) if (b.has(item)) n++;
  return n;
}

/** Links between documents, the strongest kept: `link` one way, `both` either way. */
class Links {
  readonly map = new Map<string, Map<string, number>>();

  link(from: string, to: string, strength: number): void {
    if (from === to) return;
    const mine = this.map.get(from) ?? new Map<string, number>();
    mine.set(to, Math.max(mine.get(to) ?? 0, strength));
    this.map.set(from, mine);
  }

  both(a: string, b: string, strength: number): void {
    this.link(a, b, strength);
    this.link(b, a, strength);
  }
}

/** An employer and a project: the project names the employer, or they share two items. */
function linkEmployers(links: Links, employers: readonly Node[], projects: readonly Node[]): void {
  for (const employer of employers) {
    // The employer's whole name only: a first word alone ("Deutsche", "Open") is too often
    // an ordinary word.
    const org = employerOf(employer.doc);
    for (const project of projects) {
      if (org && names(project.doc.text, org)) {
        links.both(employer.doc.id, project.doc.id, STRENGTH.employer);
      } else if (shared(employer.items, project.items) >= 2) {
        links.both(employer.doc.id, project.doc.id, STRENGTH.shared);
      }
    }
  }
}

/** Two projects that share two stack items or tags. */
function linkProjects(links: Links, projects: readonly Node[]): void {
  projects.forEach((a, i) => {
    for (const b of projects.slice(i + 1)) {
      if (shared(a.items, b.items) >= 2) links.both(a.doc.id, b.doc.id, STRENGTH.shared);
    }
  });
}

/** A post to the projects it names. */
function linkPosts(
  links: Links,
  posts: readonly CorpusDocument[],
  projects: readonly Node[],
): void {
  for (const post of posts) {
    for (const project of projects) {
      if (names(post.text, project.doc.title)) links.link(post.id, project.doc.id, STRENGTH.named);
    }
  }
}

/**
 * The FAQ and the profile. Of more entries than the profile can list, those
 * on its topics (availability, moving, notice …) come first.
 */
function linkFaq(links: Links, profile: CorpusDocument, faq: readonly CorpusDocument[]): void {
  for (const entry of faq) {
    links.link(entry.id, profile.id, STRENGTH.faq);
    const onTopic = onProfileTopic(entry.text);
    links.link(profile.id, entry.id, onTopic ? STRENGTH.faq + 0.5 : STRENGTH.faq);
  }
}

/** The links of one language's documents, each with its strength. */
function linksIn(documents: readonly CorpusDocument[], facts: ReadonlyMap<string, ProjectFacts>) {
  const links = new Links();
  const of = (kind: CorpusDocument["kind"]) => documents.filter((d) => d.kind === kind);
  const projects: Node[] = of("project").map((doc) => {
    const fact = facts.get(doc.id);
    return {
      doc,
      items: clean(fact ? [...fact.stack, ...fact.tags] : listed(doc.text, "Stack")),
    };
  });
  const employers: Node[] = of("experience").map((doc) => ({
    doc,
    items: clean(listed(doc.text, "Skills")),
  }));

  linkEmployers(links, employers, projects);
  linkProjects(links, projects);
  linkPosts(links, of("post"), projects);
  const profile = of("profile")[0];
  if (profile) linkFaq(links, profile, of("faq"));
  return links.map;
}

/**
 * The documents with their `related` ids: the strongest links first, then in
 * corpus order; a document with none is returned as it was.
 */
export function relate(
  documents: readonly CorpusDocument[],
  projects: readonly ProjectFacts[] = [],
): CorpusDocument[] {
  const facts = new Map(projects.map((p) => [p.id, p]));
  const order = new Map(documents.map((d, i) => [d.id, i]));
  const byLocale = new Map<Locale, CorpusDocument[]>();
  for (const d of documents) byLocale.set(d.locale, [...(byLocale.get(d.locale) ?? []), d]);

  const related = new Map<string, string[]>();
  for (const group of byLocale.values()) {
    for (const [from, to] of linksIn(group, facts)) {
      related.set(
        from,
        [...to]
          .sort(([a, x], [b, y]) => y - x || order.get(a)! - order.get(b)!)
          .slice(0, MAX_RELATED)
          .map(([id]) => id),
      );
    }
  }
  return documents.map((d) => {
    const ids = related.get(d.id);
    return ids?.length ? { ...d, related: ids } : d;
  });
}

const sample = (
  d: Pick<CorpusDocument, "id" | "kind"> & Partial<CorpusDocument>,
): CorpusDocument => ({
  locale: "en",
  title: d.id,
  url: "/x",
  text: "",
  ...d,
});

/**
 * Every rule and its near miss on a fixed corpus: `prompt.ts` hashes what
 * `relate` makes of it, so a change to the rules (the cap, a strength, a
 * match) turns the prompt guard red like a change to the prompt's words.
 */
export function relateSample(): string {
  const project = (id: string, text: string) => sample({ id, kind: "project", title: id, text });
  const faq = (n: number, text: string) => sample({ id: `faq:${n}@en`, kind: "faq", text });
  const documents = [
    sample({ id: "profile@en", kind: "profile" }),
    sample({
      id: "experience:a@en",
      kind: "experience",
      title: "Engineer — Acme Labs",
      text: "Skills: Go, Rust",
    }),
    sample({ id: "experience:b@en", kind: "experience", title: "Engineer — Open Systems" }),
    project("project:p1@en", "Built at Acme Labs."),
    project("project:p2@en", "An open-source CLI."),
    project("project:p3@en", ""),
    sample({
      id: "post:a@en",
      kind: "post",
      text: "On project:p1@en and project:p3@en, not project:p30.",
    }),
    ...[1, 2, 3, 4, 5].map((n) => faq(n, `Q: Question ${n}?`)),
    faq(6, "Q: Would he relocate?"),
  ];
  const facts = (id: string, stack: string[]): ProjectFacts => ({
    id,
    slug: id,
    locale: "en",
    name: id,
    descriptor: "",
    role: "",
    period: null,
    category: null,
    stack,
    tags: [],
    metrics: [],
    url: "/x",
    hasCaseStudy: false,
  });
  return relate(documents, [
    facts("project:p2@en", ["Go", "Rust"]),
    facts("project:p3@en", ["go", "rust", "Zig"]),
  ])
    .map((d) => `${d.id}: ${(d.related ?? []).join(", ")}`)
    .join("\n");
}
