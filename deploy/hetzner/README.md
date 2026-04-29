# Portfolio Hetzner Deploy

This stack is designed for the same Hetzner host that already runs another project.
It does not bind ports 80 or 443. Docker exposes services on `127.0.0.1`, then the existing system Caddy proxies public domains to those localhost ports.

For the full deployment and development workflow, see `../../DEPLOYMENT.md`.

## Files

- `docker-compose.yml` runs PostgreSQL, Hono API, Analog client, and pgAdmin.
- `Caddyfile` is the snippet to add to the host Caddy config.
- `backup-postgres.sh` creates compressed PostgreSQL dumps.
- `restore-postgres.sh` restores a dump.
- `verify-deploy.sh` checks containers, DB, and local HTTP endpoints.
- `open-dev-db-tunnel.ps1` opens a Windows/WSL SSH tunnel to the server DB.

The tunnel script uses the current Windows user's SSH key by default:

```powershell
C:\Users\<user>\.ssh\id_ed25519
```

It also falls back to the older local path `C:\Users\arastineh\Documents\AI EM SSH\.ssh\id_ed25519`.

## First Deploy

1. Confirm repo-root `.env` has the production values you want.
2. Confirm Namecheap DNS points `alirezarastineh.me`, `api.alirezarastineh.me`, and `pgadmin.alirezarastineh.me` to the Hetzner IP.
3. On the Hetzner server:

```bash
docker compose --env-file .env -f deploy/hetzner/docker-compose.yml up -d --build
```

4. Add `deploy/hetzner/Caddyfile` content to `/etc/caddy/Caddyfile`.
5. Reload Caddy:

```bash
caddy reload --config /etc/caddy/Caddyfile
```

6. Verify:

```bash
bash deploy/hetzner/verify-deploy.sh
```
