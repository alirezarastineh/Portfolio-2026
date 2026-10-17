# Woodpecker CI

Woodpecker CI checks every push and pull request, without a second server:
- The **server** (web UI, GitHub webhooks, the database) runs on the production host, in its own
  small compose project next to the portfolio. It needs about 100 MB of RAM and builds nothing.
- The **agent** runs every build and test. It sits on the owner's PC, in WSL2 with Docker Engine,
  and reaches the server through an SSH tunnel.

Pipelines run while the PC is on. Otherwise they wait in the queue (pending on GitHub) and start
when the agent is back.

```
GitHub ──webhooks──► Caddy :443 (production) ──► woodpecker-server 127.0.0.1:8030 (SQLite)
       ◄─statuses───                                  │ gRPC 127.0.0.1:9030
                                                      │
                          SSH tunnel as woodpecker-tunnel (may open that one port only)
                                                      │
PC, WSL2:  tunnel container ──► woodpecker-agent ──► Docker Engine ──► step containers
```

## Files

| File | Runs on | Purpose |
|---|---|---|
| `docker-compose.server.yml` | production | the server, pinned to v3.19.0; secrets from `/etc/woodpecker/server.env` |
| `Caddyfile` | production | the `ci.alirezarastineh.me` block to append to `/etc/caddy/Caddyfile` |
| `backup.sh`, `systemd/woodpecker-backup.*` | production | a nightly SQLite backup, kept 14 days |
| `docker-compose.agent.yml` | the PC (WSL) | the SSH tunnel and the agent; secrets from `~/woodpecker/agent.env` |
| `agent-cleanup.sh`, `systemd/woodpecker-agent-cleanup.*` | the PC (WSL) | daily pruning and old-report cleanup |

## Part 1: Accounts

1. **DNS (Namecheap):** an `A` record `ci.alirezarastineh.me` → the production host's IP, the same
   IP as `alirezarastineh.me`.
2. **GitHub OAuth App:** GitHub → Settings → Developer settings → OAuth Apps → New OAuth App.
   - Application name: anything you'll recognise later, e.g. "Woodpecker CI (Portfolio)".
   - Homepage URL: `https://ci.alirezarastineh.me`
   - Redirect URI (the callback): `https://ci.alirezarastineh.me/authorize`
   - Leave **Expire user access tokens**, **Enable Device Flow** and **Allow wildcard matching**
     unchecked. Woodpecker's docs advise against expiring user tokens, which is also why it must be
     an OAuth App, not a GitHub App.
   - Register it, then generate a client secret. Keep the client ID and the secret for Part 2;
     they go only into `/etc/woodpecker/server.env`, never into the repository or a chat.
   - At your first login, Woodpecker asks only for `admin:repo_hook` and `repo:status` (plus your
     e-mail and organisations), because `WOODPECKER_GITHUB_PUBLIC_ONLY` is on.

## Part 2: The server, on the production host

As root, in the checkout. Run `git pull --ff-only` first, so this folder is there. Nothing here
touches the portfolio's containers.

```bash
cd ~/Portfolio-2026

# The two loopback ports must be free. If not, set WOODPECKER_HTTP_HOST_PORT /
# WOODPECKER_GRPC_HOST_PORT in server.env, and change the Caddy block and permitopen to match.
ss -ltn | grep -E ':(8030|9030)\b' || echo "both free"

# Secrets, readable by root only. The agent secret is generated straight into the file.
# The two GitHub values go in with an editor, so no secret lands in the shell history.
install -d -m 700 /etc/woodpecker
install -m 600 /dev/null /etc/woodpecker/server.env
echo "WOODPECKER_AGENT_SECRET=$(openssl rand -hex 32)" >> /etc/woodpecker/server.env
echo "WOODPECKER_GRPC_SECRET=$(openssl rand -hex 32)" >> /etc/woodpecker/server.env
nano /etc/woodpecker/server.env   # add WOODPECKER_GITHUB_CLIENT=… and WOODPECKER_GITHUB_SECRET=…

# Start the server; it should idle well under 100 MB.
docker compose --env-file /etc/woodpecker/server.env -f deploy/woodpecker/docker-compose.server.yml up -d
docker stats --no-stream woodpecker-woodpecker-server-1

# Caddy: keep a copy, append the block, validate, reload. The new access log is created
# first, owned by caddy, so a validate run as root can't leave it owned by root.
cp /etc/caddy/Caddyfile "/etc/caddy/Caddyfile.bak-$(date +%F)"
{ echo; cat deploy/woodpecker/Caddyfile; } >> /etc/caddy/Caddyfile   # the echo: in case the file lacks a final newline
[ -e /var/log/caddy/woodpecker.log ] || install -m 644 -o caddy -g caddy /dev/null /var/log/caddy/woodpecker.log
caddy validate --config /etc/caddy/Caddyfile && systemctl reload caddy

# The nightly backup of Woodpecker's database.
cp deploy/woodpecker/systemd/woodpecker-backup.* /etc/systemd/system/
systemctl daemon-reload && systemctl enable --now woodpecker-backup.timer
```

**The tunnel user.** The agent logs in as this user, which has no shell and may open only the gRPC
port:

```bash
useradd --system --create-home --shell /usr/sbin/nologin woodpecker-tunnel
install -d -m 700 -o woodpecker-tunnel -g woodpecker-tunnel /home/woodpecker-tunnel/.ssh
install -m 600 -o woodpecker-tunnel -g woodpecker-tunnel /dev/null /home/woodpecker-tunnel/.ssh/authorized_keys

# Port forwarding must be allowed ("allowtcpforwarding yes"), and an AllowUsers or
# AllowGroups line, if there is one, must include woodpecker-tunnel.
sshd -T | grep -Ei '^(allowtcpforwarding|allowusers|allowgroups)'
```

Add the PC's public key once you have it (Part 3, step 3), as one line:

```bash
echo 'restrict,port-forwarding,permitopen="127.0.0.1:9030" ssh-ed25519 AAAA… woodpecker-agent' \
  >> /home/woodpecker-tunnel/.ssh/authorized_keys
```

`restrict` turns off everything, including the shell, agent forwarding and X11. `port-forwarding`
then allows local forwards, and `permitopen` limits them to Woodpecker's gRPC port.

## Part 3: The agent, on your PC

1. **WSL2 with Ubuntu.** If `wsl -l -v` already lists an Ubuntu distro, use it. The commands
   below call it `Ubuntu`; use your distro's name if it differs. Otherwise, in PowerShell as
   administrator, run `wsl --install -d Ubuntu-24.04` (that distro is named `Ubuntu-24.04`), restart
   if asked, then open it and create your Linux user.
   - `cat /etc/wsl.conf` must show `systemd=true` under `[boot]`. If it doesn't, add those two lines
     and run `wsl --shutdown` in PowerShell.
   - Cap WSL's share of the PC in `%UserProfile%\.wslconfig`, then run `wsl --shutdown`:

     ```ini
     [wsl2]
     # About half of the PC's RAM and cores; raise them if pipelines feel slow.
     memory=8GB
     processors=4
     swap=4GB
     ```

2. **Docker Engine in WSL** (in Ubuntu). If Docker Desktop is installed, keep it closed while the
   agent runs. Or untick this distro under Settings → Resources → WSL integration: when it runs, it
   mounts its own socket at `/var/run/docker.sock`, and its `docker` command takes over.

   ```bash
   sudo apt-get update && sudo apt-get install -y ca-certificates curl
   sudo install -m 0755 -d /etc/apt/keyrings
   sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
   sudo chmod a+r /etc/apt/keyrings/docker.asc
   echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] \
   https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
     | sudo tee /etc/apt/sources.list.d/docker.list >/dev/null
   sudo apt-get update
   sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
   echo '{ "log-driver": "json-file", "log-opts": { "max-size": "10m", "max-file": "3" } }' \
     | sudo tee /etc/docker/daemon.json >/dev/null
   sudo systemctl restart docker
   sudo usermod -aG docker "$USER"   # then close and reopen the terminal
   docker run --rm hello-world
   ```

3. **The tunnel key.** Use the production host's IP for `<production host>` here and in
   `agent.env`: the tunnel then needs no DNS, which a company network or VPN may answer wrongly.

   ```bash
   mkdir -p ~/woodpecker/keys && chmod 700 ~/woodpecker ~/woodpecker/keys
   ssh-keygen -t ed25519 -N '' -C woodpecker-agent -f ~/woodpecker/keys/id_ed25519
   ssh-keyscan -t ed25519 <production host> > ~/woodpecker/keys/known_hosts
   ssh-keygen -lf ~/woodpecker/keys/known_hosts   # must match `ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub` on production
   cat ~/woodpecker/keys/id_ed25519.pub           # goes into Part 2's authorized_keys line
   ```

   Test it once Part 2's line is in. The first command should stay open without a shell (stop it
   with Ctrl+C); the second must be refused:

   ```bash
   ssh -i ~/woodpecker/keys/id_ed25519 -o UserKnownHostsFile=$HOME/woodpecker/keys/known_hosts \
     -N -L 9000:127.0.0.1:9030 woodpecker-tunnel@<production host>
   ssh -i ~/woodpecker/keys/id_ed25519 -o UserKnownHostsFile=$HOME/woodpecker/keys/known_hosts \
     woodpecker-tunnel@<production host>
   ```

4. **Secrets, directories, start.**

   ```bash
   install -m 600 /dev/null ~/woodpecker/agent.env
   cat > ~/woodpecker/agent.env <<EOF
   WOODPECKER_AGENT_SECRET=<the same value as in /etc/woodpecker/server.env>
   WOODPECKER_TUNNEL_HOST=<production host>
   WOODPECKER_TUNNEL_KEYS=$HOME/woodpecker/keys
   EOF

   # The pipelines' caches and reports.
   sudo install -d -m 755 /var/lib/woodpecker-cache/pnpm-store /var/lib/woodpecker-cache/visual /srv/ci-reports

   # Run from the Windows checkout, as seen from WSL.
   cd /mnt/c/Users/arastineh/Documents/Portfolio
   docker compose --env-file ~/woodpecker/agent.env -f deploy/woodpecker/docker-compose.agent.yml up -d
   docker compose --env-file ~/woodpecker/agent.env -f deploy/woodpecker/docker-compose.agent.yml logs --tail 20
   ```

   The containers keep the config they were created with. After a change to the compose file or
   `agent.env`, run `up -d` again. Reports open from Windows at
   `\\wsl.localhost\Ubuntu\srv\ci-reports`.

5. **Keep WSL running.** WSL stops a distro about 15 seconds after the last Windows process using
   it exits, and the agent stops with it.
   - A task at logon holds one hidden WSL session open, with no time limit, and runs on battery too.
     A notebook's default task settings would block it there. In PowerShell, once:

     ```powershell
     $action   = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument '-NoProfile -WindowStyle Hidden -Command "wsl.exe -d Ubuntu --exec sleep infinity"'
     $trigger  = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
     $settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
     Register-ScheduledTask -TaskName 'WSL keep-alive (Woodpecker agent)' -Action $action -Trigger $trigger -Settings $settings
     Start-ScheduledTask -TaskName 'WSL keep-alive (Woodpecker agent)'
     ```

   - Add `vmIdleTimeout=-1` under `[wsl2]` in `.wslconfig` as well.
   - Don't rely on `[general] instanceIdleTimeout=-1` from Microsoft's docs: WSL 2.6.1 ignored it,
     and the distro still stopped after 15 seconds.
   - A `conhost --headless` wrapper exits at once and holds nothing.
   - Check it: close every WSL window and wait two minutes. `wsl -l -v` should still show Ubuntu as
     Running, and Task Scheduler should show the task as Running.

6. **Daily cleanup.** In WSL:

   ```bash
   sudo cp deploy/woodpecker/systemd/woodpecker-agent-cleanup.* /etc/systemd/system/
   sudo systemctl daemon-reload && sudo systemctl enable --now woodpecker-agent-cleanup.timer
   ```

   The service file assumes the checkout is at `/mnt/c/Users/arastineh/Documents/Portfolio`.

## Part 4: Connect the repository

1. Open `https://ci.alirezarastineh.me` and log in with GitHub, as `alirezarastineh`.
2. Check that **Admin → Agents** shows one agent, connected.
3. Add the repository `alirezarastineh/Portfolio-2026`. Woodpecker installs its webhook on GitHub.
4. In the repository's Woodpecker settings, set:
   - **Trusted:** the volumes option. Workflows mount the pnpm store, the reports directory and
     the Docker socket. Nothing needs the network or privileged options.
   - **Require approval for:** forked repositories, the default. A stranger's pull request waits
     until you approve it.
   - **Cancel previous pipelines:** on.
   - **Timeout:** 60 minutes.
   - **Project visibility:** private. Logs are for you, not for the public.

## Part 5: Smoke test

Push a commit that contains `.woodpecker/smoke.yaml`.
- The pipeline should run.
- Its `hello` step should print the commit and `x86_64`.
- The commit on GitHub should show the status `ci/woodpecker/push/smoke`.

Then restart the PC and log in. The agent should come back by itself (Admin → Agents), and a
re-run of the pipeline should pass.

## Reports

The client workflow's last step, `reports`, runs whether the checks passed or failed. It copies the
e2e report (`playwright-report/`), the failed tests' traces (`test-results/`) and Lighthouse's
reports (`.lighthouseci/`) to `/srv/ci-reports/<pipeline>/client/` in WSL, through
`ci/save-reports.sh`, and prints the folder's Windows path:
`\\wsl.localhost\Ubuntu\srv\ci-reports\<pipeline>\client`. The pipeline number is in the link of
the commit's status on GitHub (`…/pipeline/<number>/…`).

- **e2e:** serve the report from the Windows checkout's `client/` folder:
  `npx playwright show-report "\\wsl.localhost\Ubuntu\srv\ci-reports\<pipeline>\client\playwright-report"`.
  Each failed test links its trace. Opened as a file, the report shows the failures but can't load
  the traces.
- **Lighthouse:** open the `.html` files in `.lighthouseci\reports` directly.
- **SBOMs:** the images workflow's `reports` step saves a CycloneDX SBOM of each image, what it
  ships down to the last package, to `\\wsl.localhost\Ubuntu\srv\ci-reports\<pipeline>\images\sbom`
  (about 1 MB a pipeline).
- **Coverage** (plan Phase 9): open `coverage\index.html` under `…\<pipeline>\client` (the unit
  tests) or `…\<pipeline>\server` (unit and db merged). The thresholds are flags on the client's
  `unit` step and the server's `coverage` step, just under the first figures; raise them by hand.
- **Code health,** in the step logs only: `bundle-size` (the client's assets, against the last main
  run, whose totals stay in `/var/lib/woodpecker-cache/bundle-size`), `knip` and `cycles`.
- **Visual changes** (plan Phase 10, `ci/visual.sh`): every run on main takes the visual project's
  screenshots afresh and keeps them as the baselines, one set per CI image tag, in
  `/var/lib/woodpecker-cache/visual/<tag>` (never in git). A pull request compares its build with
  them. When something changed, its `visual` step is marked red (it's advisory: the workflow stays
  green), and `playwright-report\visual\index.html` under `…\<pipeline>\client` shows each
  difference, expected, actual and diff side by side. It opens as a file. The step's log names the
  main commit the baselines came from: a pull request that is behind main also shows main's later
  changes.
- **Firefox and WebKit** (plan Phase 10): the nightly cron run also runs the desktop suite in both,
  advisory. Serve its report like e2e's: `npx playwright show-report
  "\\wsl.localhost\Ubuntu\srv\ci-reports\<pipeline>\client\playwright-report\cross-browser"`.
- `agent-cleanup.sh` deletes reports after 14 days, and visual sets no run has used for 30 days.
  Reports belong to root, so from Windows you can read them but not delete them.

## Stack smoke test

`images.yaml`'s `smoke` step (plan Phase 11, `ci/stack-smoke.sh`) boots the two images it just
built with Postgres, as production runs them: `deploy/hetzner/docker-compose.yml` with
`ci/compose.ci.yml`. The API applies the real migrations at boot, the API image's own seed publishes
the seed's content, and `verify-deploy.sh` checks the result with `VERIFY_CI=1`. That flag skips
the only parts production alone has, pgAdmin and the edge (Caddy and the public domains); without
it the script runs as before.

- The stack is the compose project `ci-<pipeline>`, with a throwaway `.env`, on loopback ports from
  `127.0.0.1:20000` up, ten a pipeline, so two runs never meet. It is removed when the test ends,
  pass or fail; `agent-cleanup.sh` removes what a canceled run leaves.
- The stack publishes its ports on the host's loopback, as on production, where a step can't reach
  them. The step builds a small helper image (`ci/smoke.Dockerfile`: bash, curl, the docker CLI and
  the files the test reads) and runs the test in it, on the host's network.
- On a failure, the step's log ends with the stack's last log lines, the API's migrations among
  them.

## Upgrade

1. Read the release notes for every version between the current and the target
   (`github.com/woodpecker-ci/woodpecker/releases`). Some releases migrate the database; 3.18
   rewrote the log storage, which takes a while.
2. On production, back up first: `systemctl start woodpecker-backup`.
3. Change the server's tag in `docker-compose.server.yml` and the agent's in
   `docker-compose.agent.yml`. They must match. Commit.
4. Production: `git pull --ff-only`, then `docker compose --env-file /etc/woodpecker/server.env
   -f deploy/woodpecker/docker-compose.server.yml up -d`.
5. PC: `docker compose --env-file ~/woodpecker/agent.env -f deploy/woodpecker/docker-compose.agent.yml
   up -d`.
6. Bump the `woodpecker-cli` image in `.woodpecker/repo.yaml` to the same version: its `workflows`
   step lints against that version's schema.

## Restore a backup (production)

```bash
cd ~/Portfolio-2026
compose() { docker compose --env-file /etc/woodpecker/server.env -f deploy/woodpecker/docker-compose.server.yml "$@"; }
compose stop woodpecker-server
gunzip -c /var/backups/woodpecker/woodpecker-<stamp>.sqlite.gz > /tmp/woodpecker.sqlite
docker run --rm -v woodpecker_woodpecker-server-data:/data -v /tmp:/restore alpine:3.22 \
  sh -c 'rm -f /data/woodpecker.sqlite-wal /data/woodpecker.sqlite-shm && cp /restore/woodpecker.sqlite /data/woodpecker.sqlite'
compose start woodpecker-server && rm /tmp/woodpecker.sqlite
```

## Rotate secrets

- **Agent secret:** put a new `openssl rand -hex 32` value in both `/etc/woodpecker/server.env`
  and `~/woodpecker/agent.env`, then run `up -d` on both sides.
- **OAuth client secret:** generate a new one on GitHub, put it in `server.env`, and run `up -d` on
  production.
- **gRPC secret:** put a new value in `server.env` and run `up -d` on production. Connected agents
  authenticate again on their own.
- **Tunnel key:**
  1. Make a new key pair in `~/woodpecker/keys`.
  2. Replace the line in production's `/home/woodpecker-tunnel/.ssh/authorized_keys`.
  3. Run `up -d` on the PC.

## Security notes

- **Production publishes nothing new except the `ci.` site.** gRPC stays on loopback. The only way
  in is the tunnel user's key, which can open that one port and nothing else.
- **The Docker socket is root inside WSL, on your PC, not on production.** A workflow that mounts
  it can control the agent's Docker. Never approve a fork's pull request without reading its
  `.woodpecker/` changes.
  - `ci-image.yaml` and `images.yaml` mount it to build images, with the same trust as building
    them by hand: only you push, and a stranger's pull request waits for your approval.
  - `images.yaml`'s smoke test also starts a helper container with the socket on the host's
    network, under the same trust.
- **Secrets** are added in the repository's Woodpecker settings, never in files.
  - Filter every secret by event: never `pull_request`, and only the events that need it.
  - Filter by image where you can.
  - Never give a secret a `VITE_` name: the client build inlines every `VITE_*` variable into the
    public bundle.
- **Leaks and dependencies** (plan Phase 8):
  - `repo.yaml`'s `gitleaks` scans the working tree on every push and pull request. Its waivers,
    each with a reason, are in `.gitleaks.toml`, matched by value and file so that they hold when
    lines move.
  - `security.yaml` runs when a lockfile changes, on manual runs and nightly. `pnpm audit` lists
    every HIGH advisory in the production dependencies and fails on a CRITICAL. The licence check
    fails a production package outside the allowlist, unless `ci/check-licenses.mjs` waives it.
    osv-scanner and semgrep only report.
  - `images.yaml` scans each image's SBOM with Trivy the same way: every HIGH listed, a CRITICAL
    fails. Waivers, each with its reason, go in `.trivyignore`.
  - To block on HIGH once the HIGHs are fixed or waived: `--fail-on high` in `security.yaml`'s
    `audit` step, and `--severity HIGH,CRITICAL` in the gate pass of `images.yaml`'s
    `vulnerabilities` step.
- **Who can log in:** `WOODPECKER_OPEN=false`, plus a single admin and repository owner. User agent
  registration is off.
- **The GitHub token** that Woodpecker stores can manage webhooks and commit statuses, nothing more
  (`WOODPECKER_GITHUB_PUBLIC_ONLY`). To build a private repository later, turn that off and log in
  again; the token then gets the `repo` scope.

## Troubleshooting

- **Pipelines stay pending:** the PC is off or asleep, WSL stopped, or the tunnel is down. On the
  PC, check `docker compose … logs tunnel woodpecker-agent`.
- **A pipeline stays pending although the agent is back:** it was handed to an agent session that
  vanished (WSL stopped mid-pickup). Restart it from its page.
- **`Permission denied (publickey)` in the tunnel log:** the `authorized_keys` line or its file
  modes (Part 2).
- **`administratively prohibited` in the tunnel log:** the `permitopen` port doesn't match
  `WOODPECKER_GRPC_HOST_PORT`.
- **`Host key verification failed`:** `known_hosts` lacks production's ed25519 key (Part 3, step 3).
