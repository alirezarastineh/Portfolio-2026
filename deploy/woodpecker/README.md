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
  tests) or `…\<pipeline>\server` (unit and db merged). The thresholds are flags in
  `ci/client.sh` (`unit`) and `ci/server.sh` (`coverage`), just under the first figures; raise
  them by hand.
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

## Deploys

`.woodpecker/deploy.yaml` (plan Phase 12) deploys a green main commit to production. Start it from
that commit's pipeline: **Deploy**, target `production`, task empty. Woodpecker shows the button
on successful pipelines once **Allow Deployments** is on in the repository's settings. Deploy only
main's newest pipeline: the first step refuses any other, and so does production.

The steps run in order, and a failure skips the rest:
1. **`guard`** (`ci/deploy-guard.mjs`): the target is `production`, the commit is main's tip, and
   every Woodpecker check on it passed (GitHub's commit statuses).
2. **`images`:** both images, built on the agent's Docker and pushed to
   `ghcr.io/alirezarastineh/portfolio-2026/{api,client}:<sha>`, then checked to be public:
   production pulls them without logging in. The client is built with production's public values,
   `deploy/hetzner/client-public.env`.
3. **`rollout`:** SSH to production, whose forced command `deploy/hetzner/ci-deploy.sh`:
   - fast-forwards the checkout to `origin/main` and refuses unless that is the commit;
   - runs `deploy/hetzner/rollout.sh` as the systemd unit `portfolio-deploy`, so a connection that
     drops can't cut it off halfway. It refuses with less than 5 GB free on `/`, which Postgres
     shares; then the pre-deploy backup (`backup-postgres.sh`), both pulls, the API, the client
     once the API is healthy, and `verify-deploy.sh`. Once that passes, it removes the earlier
     deploys' images.

   The step follows the unit's log and ends with its exit status. The log stays on production:
   `journalctl -u portfolio-deploy`.
4. **`latest`:** `:latest` then names what production runs.
5. **`untag`**, pass or fail: removes the images' tags from the agent.

A deployment started in the UI posts no status to GitHub: Woodpecker's GitHub forge reports only
the deployments GitHub created. Read the result in the UI.

**Rolling back:** revert the commit on main, push, and deploy the revert's pipeline once it's
green. Production runs main's tip only, so an older pipeline is refused.

### One-time setup

1. **Allow Deployments** in the repository's Woodpecker settings.
2. **A GHCR token:** a classic one (GHCR takes no fine-grained tokens) with only `write:packages`,
   made from `https://github.com/settings/tokens/new?scopes=write:packages`. Picked in the form
   instead, `write:packages` ticks `repo` as well.
3. **The deploy key,** a key pair of its own, in WSL:

   ```bash
   ssh-keygen -t ed25519 -N '' -C woodpecker-deploy -f ~/woodpecker/keys/deploy_ed25519
   cat ~/woodpecker/keys/deploy_ed25519.pub
   ```

   On production, as root, once the checkout has `deploy/hetzner/ci-deploy.sh` (`git pull
   --ff-only`), add the public key as one line. `restrict` turns off forwarding and the terminal,
   and `command` replaces whatever the key asks to run:

   ```bash
   echo 'restrict,command="bash /root/Portfolio-2026/deploy/hetzner/ci-deploy.sh" ssh-ed25519 AAAA… woodpecker-deploy' \
     >> /root/.ssh/authorized_keys
   ```

   Check it from WSL: any other command gets `usage: deploy <40-character commit sha>` (exit 2),
   never a shell.

   ```bash
   ssh -i ~/woodpecker/keys/deploy_ed25519 -o IdentitiesOnly=yes \
     -o UserKnownHostsFile=$HOME/woodpecker/keys/known_hosts root@<production host> whoami
   ```

4. **Secrets**, in the repository's Woodpecker settings, each for the **deployment** event only:

   | Secret | Value |
   |---|---|
   | `ghcr_token` | the token from step 2 |
   | `deploy_ssh_key` | the private key, `~/woodpecker/keys/deploy_ed25519` |
   | `deploy_known_hosts` | production's line in `~/woodpecker/keys/known_hosts` (checked in Part 3) |
   | `deploy_host` | production's IP, as in that line |
   | `deploy_user` | `root` |

   Leave the image filter empty: Woodpecker 3.19 applies it to plugins only, and refuses a filtered
   secret in a step that runs commands.
5. **The packages, after the first deploy's push:** GHCR creates them private, so that run's
   `images` step stops before production. Make both public: GitHub → Packages →
   `portfolio-2026/api` → Package settings → Danger Zone → Change visibility → Public, then the same
   for `portfolio-2026/client`. Deploy again. Public packages cost nothing, and production pulls
   them without logging in. **A public package can never be made private again.** The images hold
   no secrets: the client's values are public, and the API reads its keys at run time.

## Schedules and failure email

Three crons (plan Phase 13), added in the repository's Woodpecker settings → **Crons**, each on
`main`, in the timezone the form sets:

| Cron | Runs | What runs |
|---|---|---|
| `nightly` | daily | `server` (the property tests with a random `FC_SEED`), `client` (the visual baselines refreshed, then Firefox and WebKit), `repo`, `images`, `security` |
| `weekly` | Mondays | `weekly.yaml`: gitleaks over the whole history, `pnpm outdated` (a report), Woodpecker's version against its latest release |
| `prod-smoke` | daily | `prod-smoke.yaml`: read-only requests to the live site (`ci/prod-smoke.sh`) |

- Each workflow's `when` names its cron (`cron: nightly`), so a cron starts only its own
  workflows. A cron's **Run now** starts it at once.
- **3.19.0's form saves a new cron disabled** unless **Enabled** is clicked: the box shows ticked
  but sends nothing, and the server takes that as off. A disabled cron never fires (**Run now**
  still works), and the list shows "Disabled" where the next run should be. Click the box off and
  on before saving, or edit the cron afterwards and tick it.
- The server creates each run on time and holds it until the PC's agent is online. After days off,
  several runs wait and then run one after another; cancel the ones you don't need.
- A nightly failure in the property tests prints its seed. In `server/`,
  `FC_SEED=<seed> node_modules/.bin/vitest run --project unit src/ask/properties.spec.ts` repeats it.

**The failure email.** Every workflow ends with an `email` step (`ci/notify.mjs`) that runs once
one of its steps failed, for pushes to main, cron runs and deployments. It sends one email per
failed workflow through Resend, from `ci@alirezarastineh.me`, naming the workflow, the run, the
commit and the pipeline's link.
- Advisory steps (`failure: ignore`) never fail a workflow, so they send nothing. Pull requests send
  nothing either: GitHub shows their status.
- One step per workflow, not a notify workflow after all the others: Woodpecker 3.19 skips a
  workflow that runs on failure as soon as any of its dependencies passed
  (`server/model/task.go`, `ShouldRun`), so it would stay silent whenever one failed and another
  passed.
- **Secrets**, each for the **Push**, **Cron**, **Deploy** and **Manual** events:
  - `resend_api_key`: a Resend API key with sending access only, for the domain
    `alirezarastineh.me`;
  - `alert_to`: the address the emails go to.

  Add them **before** pushing a workflow that uses them: a missing secret fails the whole pipeline
  when it is compiled.
- **The test:** run a pipeline by hand on `main` (the repository → **Run pipeline**) with the
  variable `NOTIFY_TEST` set to `1`. Every workflow but `prod-smoke` skips such a run, and its first
  step fails on purpose, so one email arrives: "[CI] prod-smoke failed on main (manual run,
  NOTIFY_TEST, …)".

## Upgrade

The weekly cron's `woodpecker` step (`ci/woodpecker-version.mjs`) fails, and emails, once a newer
release has been out for two weeks: that is the cue.

1. Read the release notes for every version between the current and the target
   (`github.com/woodpecker-ci/woodpecker/releases`). Some releases migrate the database; 3.18
   rewrote the log storage, which takes a while. Look out for changes to `depends_on`, workflow
   `when: status`, secrets, the deployment event and the GitHub forge's statuses: the workflows rely
   on 3.19's behaviour there.
2. On production, back up first: `systemctl start woodpecker-backup`.
3. In one commit, set the same version in all three pins (the weekly check fails while they differ):
   - the server's tag in `docker-compose.server.yml`;
   - the agent's in `docker-compose.agent.yml`;
   - the `woodpecker-cli` image in `.woodpecker/repo.yaml`, whose `workflows` step lints against
     that version's schema.

   `weekly.yaml`'s clone pins `woodpeckerci/plugin-git:2.10.1`, 3.19's default clone image. If the
   new server's default (`shared/constant/constant.go`) differs, pin the same one there.
4. Production: `git pull --ff-only`, then `docker compose --env-file /etc/woodpecker/server.env
   -f deploy/woodpecker/docker-compose.server.yml up -d`.
5. PC: `docker compose --env-file ~/woodpecker/agent.env -f deploy/woodpecker/docker-compose.agent.yml
   up -d`. The dry-run tools outside the repo name the CLI's tag too.

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
- **GHCR token (`ghcr_token`):** make a new classic token with only `write:packages` ("Deploys",
  One-time setup), put it in the secret, then delete the old token on GitHub. GitHub emails a week
  before a token expires; until it is replaced, deploys stop at `images`, before production.
- **Deploy key (`deploy_ssh_key`):**
  1. Make a new key pair (`ssh-keygen -t ed25519 -N '' -C woodpecker-deploy -f …`).
  2. Replace the line in production's `/root/.ssh/authorized_keys`, keeping its
     `restrict,command="…"` prefix.
  3. Put the new private key in the secret.
- **Resend key (`resend_api_key`):** create a new sending key in Resend, put it in the secret, then
  revoke the old one.

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
  - Filter by image only for a plugin: Woodpecker 3.19 refuses a secret with an image filter in a
    step that runs commands, which every step here does.
  - Never give a secret a `VITE_` name: the client build inlines every `VITE_*` variable into the
    public bundle.
- **Deploys** (`deploy.yaml`): its secrets exist for the deployment event alone, and a deployment
  runs the workflow files of the pipeline it starts from. Deploy main's pipelines only, never a pull
  request's: that would run the branch's own `deploy.yaml` with the deploy secrets. The deploy key
  can run one command on production, `ci-deploy.sh`, which deploys main's tip and nothing else.
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
  - To block on HIGH once the HIGHs are fixed or waived: `--fail-on high` in `ci/security.sh`'s
    `audit` step, and `--severity HIGH,CRITICAL` in the gate pass of `ci/images.sh`'s
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
