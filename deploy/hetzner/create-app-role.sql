-- Creates `portfolio_app`, the least-privilege role the API can connect as:
-- it may read and write rows, but not create, alter or drop anything. Schema
-- changes stay with the owner, which only the boot-time migrator uses (through
-- MIGRATION_DATABASE_URL). Safe to re-run; it resets the password.
--
-- Run once, as the owner (POSTGRES_USER), from the repo root on the host:
--
--   docker compose --env-file .env -f deploy/hetzner/docker-compose.yml exec -T db \
--     psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v app_password="$APP_DB_PASSWORD" \
--     < deploy/hetzner/create-app-role.sql
--
-- Then set APP_DB_USER=portfolio_app and APP_DB_PASSWORD in .env and recreate
-- the `api` container. See DEPLOYMENT.md, "Least-privilege database role".

\set ON_ERROR_STOP on
-- `IS NOT NULL`, so psql prints "t" instead of echoing the password back.
SELECT set_config('app.password', :'app_password', false) IS NOT NULL AS password_loaded;

DO $$
DECLARE
  owner_role text := current_user;
  new_password text := current_setting('app.password');
BEGIN
  IF length(new_password) < 16 THEN
    RAISE EXCEPTION 'app_password must be at least 16 characters';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'portfolio_app') THEN
    EXECUTE format('ALTER ROLE portfolio_app WITH LOGIN PASSWORD %L', new_password);
  ELSE
    EXECUTE format('CREATE ROLE portfolio_app LOGIN PASSWORD %L', new_password);
  END IF;

  EXECUTE format('GRANT CONNECT ON DATABASE %I TO portfolio_app', current_database());
  GRANT USAGE ON SCHEMA public TO portfolio_app;
  GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO portfolio_app;
  GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO portfolio_app;

  -- Tables and sequences that future migrations create (as the owner) are
  -- covered automatically, so a new migration never needs a manual GRANT.
  EXECUTE format(
    'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public '
    'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO portfolio_app', owner_role);
  EXECUTE format(
    'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public '
    'GRANT USAGE, SELECT ON SEQUENCES TO portfolio_app', owner_role);
END
$$;
