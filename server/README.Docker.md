# Docker

Use the repo-root compose files instead of running Docker Compose from this folder:

```bash
docker compose --env-file .env -f compose.yaml up -d --build
docker compose --env-file .env -f deploy/hetzner/docker-compose.yml up -d --build
```

See `../DEPLOYMENT.md`.
