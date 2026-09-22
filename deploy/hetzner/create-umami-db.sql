-- Creates the `umami` role and its own `umami` database on the existing
-- Postgres server, for the analytics container. Umami owns that database and
-- migrates it itself; it gets no access to the portfolio's tables. Safe to
-- re-run; it resets the password.
--
-- Run once, as the owner (POSTGRES_USER), from the repo root on the host:
--
--   docker compose --env-file .env -f deploy/hetzner/docker-compose.yml exec -T db \
--     psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v umami_password="$UMAMI_DB_PASSWORD" \
--     < deploy/hetzner/create-umami-db.sql
--
-- See DEPLOYMENT.md, "Analytics (Umami)".

\set ON_ERROR_STOP on
-- `IS NOT NULL`, so psql prints "t" instead of echoing the password back.
SELECT set_config('app.password', :'umami_password', false) IS NOT NULL AS password_loaded;

DO $$
DECLARE
  new_password text := current_setting('app.password');
BEGIN
  IF length(new_password) < 16 THEN
    RAISE EXCEPTION 'umami_password must be at least 16 characters';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'umami') THEN
    EXECUTE format('ALTER ROLE umami WITH LOGIN PASSWORD %L', new_password);
  ELSE
    EXECUTE format('CREATE ROLE umami LOGIN PASSWORD %L', new_password);
  END IF;
END
$$;

-- CREATE DATABASE cannot run inside a DO block; \gexec runs the generated
-- statement, and only when the database does not exist yet.
SELECT 'CREATE DATABASE umami OWNER umami'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'umami')\gexec
