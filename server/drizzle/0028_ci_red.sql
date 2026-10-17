-- A deliberate defect for the stack smoke test's scratch PR (plan Phase 11), never to merge:
-- it names the role the test database connects as, which production's database does not
-- have, so the API's boot migrations fail there while the db specs pass.
GRANT SELECT ON TABLE "projects" TO "postgres";
