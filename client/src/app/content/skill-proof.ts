function skillKey(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * A skill group's proof: the projects whose stack names one of its skills, in the work's order,
 * each once. Names match whatever their case or surrounding space ("pgvector", "PGVector ").
 */
export function skillProof<P extends { stack: readonly string[] }>(
  skills: readonly string[],
  projects: readonly P[],
): P[] {
  const wanted = new Set(skills.map((name) => skillKey(name)));
  return projects.filter((project) => project.stack.some((name) => wanted.has(skillKey(name))));
}
