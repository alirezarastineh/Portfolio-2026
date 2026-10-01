/** The eval CLI's arguments: `--name` flags and `--name <value>` options. */

export function hasFlag(argv: readonly string[], name: string): boolean {
  return argv.includes(`--${name}`);
}

/** Every value given for `--name`, in order. A flag that follows is not a value. */
export function optionValues(argv: readonly string[], name: string): string[] {
  const out: string[] = [];
  argv.forEach((arg, i) => {
    const next = argv[i + 1];
    if (arg === `--${name}` && next !== undefined && !next.startsWith("--")) out.push(next);
  });
  return out;
}
