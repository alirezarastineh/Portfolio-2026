#!/usr/bin/env bash
set -euo pipefail

# Production's end of Woodpecker's deploy (.woodpecker/deploy.yaml, plan Phase
# 12). It is the forced command of the CI's key in root's authorized_keys
# (deploy/woodpecker/README.md, "Deploys"):
#   restrict,command="bash /root/Portfolio-2026/deploy/hetzner/ci-deploy.sh" ssh-ed25519 AAAA… woodpecker-deploy
# so that key can do one thing: deploy the commit at the tip of origin/main,
# whose images CI has just pushed. It reads `deploy <sha>` from
# SSH_ORIGINAL_COMMAND, or from its arguments when run by hand.
#
# The rollout (rollout.sh, from the updated checkout) runs as a transient
# systemd unit, not in the SSH session: a connection that drops, the agent's
# PC asleep, must not stop it between removing a container and starting its
# successor. This session follows the unit's log and returns its exit status.
# The unit's name allows one deploy at a time; its log stays in the journal:
#   journalctl -u portfolio-deploy

# One function, called on the last line: bash reads a script as it runs it, and
# the fast-forward below can replace this file.
main() {
  local request="${SSH_ORIGINAL_COMMAND:-$*}" unit=portfolio-deploy
  local repo sha follower status=0
  if [[ ! "${request}" =~ ^deploy\ ([0-9a-f]{40})$ ]]; then
    echo "usage: deploy <40-character commit sha>" >&2
    exit 2
  fi
  sha="${BASH_REMATCH[1]}"
  repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

  if systemctl is-active --quiet "${unit}"; then
    echo "Another deploy is running (journalctl -u ${unit}; systemctl stop ${unit} ends it)." >&2
    exit 1
  fi

  # The documented `git pull --ff-only`, then the guard: compose's files and
  # verify-deploy.sh come from this checkout, which must be the commit the
  # images were built from.
  git -C "${repo}" fetch --quiet origin main
  git -C "${repo}" merge --ff-only --quiet origin/main
  if [[ "$(git -C "${repo}" rev-parse HEAD)" != "${sha}" ]]; then
    echo "main is at $(git -C "${repo}" rev-parse --short HEAD), not ${sha:0:7}: deploy main's newest pipeline." >&2
    exit 1
  fi

  journalctl --follow --output=cat --since=now "_SYSTEMD_UNIT=${unit}.service" &
  follower=$!
  systemd-run --unit="${unit}" --description="Portfolio deploy of ${sha:0:7}" \
    --collect --wait --quiet --working-directory="${repo}" --setenv=HOME="${HOME}" \
    bash "${repo}/deploy/hetzner/rollout.sh" "${sha}" || status=$?
  # journald passes the last lines on a moment later.
  sleep 2
  kill "${follower}" 2> /dev/null || true

  if [[ "${status}" -ne 0 ]]; then
    echo "The rollout of ${sha:0:7} failed (exit ${status}): journalctl -u ${unit}" >&2
    exit "${status}"
  fi
  echo "Deployed ${sha:0:7}."
}

main "$@"
