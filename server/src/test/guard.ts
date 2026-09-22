/**
 * The db suites truncate every table between tests. Local dev deliberately
 * shares the production database through the tunnel, so the only safe rule is
 * an allow-list: the database name must say it is a test database, and the
 * tunnel port is refused outright.
 */
export function assertTestDatabase(url: string): void {
  const parsed = new URL(url);
  const database = parsed.pathname.replace(/^\//, "");

  if (parsed.port === "55433") {
    throw new Error("Refusing to run db tests through the production tunnel (port 55433).");
  }
  if (!/test/i.test(database)) {
    throw new Error(
      `Refusing to run db tests against "${database}": the database name must contain "test".`,
    );
  }
}
