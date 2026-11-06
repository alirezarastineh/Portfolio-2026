/**
 * A skill group's proof: the projects whose stack names one of its skills, in the work's order,
 * each once. Names match whatever their case or surrounding space ("pgvector", "PGVector ").
 */
export function skillProof<P extends { stack: readonly string[] }>(
  skills: readonly string[],
  projects: readonly P[],
): P[] {
  const key = (name: string) => name.trim().toLowerCase();
  const wanted = new Set(skills.map(key));
  return projects.filter((project) => project.stack.some((name) => wanted.has(key(name))));
}
