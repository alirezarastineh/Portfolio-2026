# Portfolio Hetzner Deploy

This stack is designed for the same Hetzner host that already runs another project.
It does not bind ports 80 or 443. Docker exposes services on `127.0.0.1`, then the existing system Caddy proxies public domains to those localhost ports.

For the full deployment and development workflow, see `../../DEPLOYMENT.md`.

## Files

- `docker-compose.yml` runs PostgreSQL, Hono API, Analog client, and pgAdmin.
- `Caddyfile` is the snippet to add to the host Caddy config.
- `backup-postgres.sh` creates compressed PostgreSQL dumps.
- `restore-postgres.sh` restores a dump.
- `backup-media.sh` archives the `media` volume (uploaded images).
- `restore-media.sh` restores a media archive into the volume.
- `verify-deploy.sh` checks containers, DB, content read path, SSR, crawler
  files, the auth boundary and media ownership — and reports every failure in
  one run rather than stopping at the first.
- `open-dev-db-tunnel.ps1` opens a Windows/WSL SSH tunnel to the server DB.
- `load-env.sh` is how the scripts above read the repo `.env`: as data, the way
  docker compose does. They never `source` it, so a value compose accepts (an
  unquoted value with spaces, a `$$`) cannot break them or run as a command.

## Backups have two halves

Uploaded images live on the `media` Docker volume, **not** in Postgres, so
`backup-postgres.sh` alone is not a complete backup.

> **Restore both or neither.** A database restore without the matching media
> restore leaves `media_assets` rows pointing at files that no longer exist, and
> project images break. The admin dashboard and `/admin/media` flag this drift
> (`/admin/media-reconcile`), but the fix is to restore the pair together:
>
> ```bash
> bash deploy/hetzner/restore-postgres.sh /var/backups/.../portfolio-<ts>.dump.gz
> bash deploy/hetzner/restore-media.sh    /var/backups/.../media-<ts>.tar.gz
> ```

Run both backups on the same schedule so a matching pair always exists.

The tunnel script uses the current Windows user's SSH key by default:

```powershell
C:\Users\<user>\.ssh\id_ed25519
```

It also falls back to the older local path `C:\Users\arastineh\Documents\AI EM SSH\.ssh\id_ed25519`.

## First Deploy

1. Confirm repo-root `.env` has the production values you want.
2. Confirm Namecheap DNS points `alirezarastineh.me` and `api.alirezarastineh.me` to the Hetzner IP. (pgAdmin is not public; see `DEPLOYMENT.md`, "pgAdmin access".)
3. On the Hetzner server:

```bash
docker compose --env-file .env -f deploy/hetzner/docker-compose.yml up -d --build
```

4. Add the site blocks from `deploy/hetzner/Caddyfile` to `/etc/caddy/Caddyfile`.
5. Validate and reload Caddy:

```bash
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

6. Verify:

```bash
bash deploy/hetzner/verify-deploy.sh
```
