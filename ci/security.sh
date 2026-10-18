#!/bin/sh
# Supply chain (Woodpecker plan, Phase 8): what both CIs' security workflows
# run, from the repo root. The pnpm store is the CI's own: PNPM_STORE, or
# Woodpecker's /pnpm-store.
#   sh ci/security.sh <install|osv-scanner|audit|licenses|semgrep>
set -eu
cd "$(dirname "$0")/.."
store=${PNPM_STORE:-/pnpm-store}

case "${1:-}" in
  # Production dependencies only: what the images ship, and what the licence
  # check reads.
  install)
    for p in server client; do
      (cd "$p" && pnpm install --prod --frozen-lockfile --store-dir "$store")
    done
    ;;
  # OSV's sources beside npm's, over both lockfiles, dev dependencies too, so it
  # nearly always lists something. Findings (exit 1) pass, as the owner chose
  # (2026-10-16); an error still fails. Its image keeps the binary off the PATH.
  osv-scanner)
    /osv-scanner scan source --lockfile server/pnpm-lock.yaml --lockfile client/pnpm-lock.yaml || [ $? -eq 1 ]
    ;;
  # Every HIGH and CRITICAL advisory is listed, and a CRITICAL fails
  # (ci/check-audit.mjs says why not HIGH yet). A failed request fails too.
  # Both packages run before the step ends, so one run reports both.
  audit)
    status=0
    for p in server client; do
      (cd "$p" && pnpm audit --prod --json > "/tmp/audit-$p.json") || true
      node ci/check-audit.mjs "/tmp/audit-$p.json" "$p" || status=1
    done
    exit "$status"
    ;;
  # Licences outside the allowlist fail, unless ci/check-licenses.mjs waives the
  # package. pnpm reads the licences from the store; the command has no
  # --store-dir flag.
  licenses)
    status=0
    for p in server client; do
      (cd "$p" && pnpm licenses list --prod --json --config.store-dir="$store" > "/tmp/licenses-$p.json") || true
      node ci/check-licenses.mjs "/tmp/licenses-$p.json" "$p" || status=1
    done
    exit "$status"
    ;;
  # semgrep's TypeScript and Node rules over both src trees. Its metrics stay
  # off; the rules come from semgrep's registry.
  semgrep)
    semgrep scan --config p/typescript --config p/nodejs --metrics=off --disable-version-check --error server/src client/src
    ;;
  *)
    echo "usage: sh ci/security.sh <install|osv-scanner|audit|licenses|semgrep>" >&2
    exit 2
    ;;
esac
