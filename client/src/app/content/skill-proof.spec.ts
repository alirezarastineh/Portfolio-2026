import { describe, expect, it } from "vitest";

import { skillProof } from "./skill-proof";

const atlas = { slug: "atlas", stack: ["TypeScript", "Postgres", "pgvector"] };
const gate = { slug: "gate", stack: ["Python", " PyTorch "] };
const site = { slug: "site", stack: ["Angular", "TypeScript"] };
const work = [atlas, gate, site];

describe("skillProof", () => {
  it("finds the projects that name a skill, whatever its case or spaces", () => {
    expect(skillProof(["pytorch"], work)).toEqual([gate]);
    expect(skillProof(["PGVECTOR "], work)).toEqual([atlas]);
  });

  it("keeps the work's order and lists a project once, however many skills it shares", () => {
    expect(skillProof(["Angular", "TypeScript", "Postgres"], work)).toEqual([atlas, site]);
  });

  it("is empty when no project names the skills", () => {
    expect(skillProof(["Kafka", "PostgreSQL"], work)).toEqual([]);
    expect(skillProof([], work)).toEqual([]);
  });
});
