#!/bin/sh
# The API and client images (Woodpecker plan, Phases 6 and 8): what both CIs
# build and scan, from the repo root, on the CI's Docker. The tags carry the
# commit, and nothing is pushed: deploy.yaml builds the images it ships.
#   sh ci/images.sh <api|client|sbom|vulnerabilities>
set -eu
cd "$(dirname "$0")/.."
sha=${CI_COMMIT_SHA:?}
# Trivy's vulnerability database, 1.5 GB unpacked, where the CI keeps it:
# TRIVY_CACHE, or Woodpecker's /trivy-cache. A stale one is downloaded again
# (128 MB).
cache=${TRIVY_CACHE:-/trivy-cache}
# On GitHub Actions (the GitHub Actions plan, Phase 6), each CRITICAL also goes
# on the run's page as an error, which reads without a login. Trivy's image
# gets GITHUB_ACTIONS there, and nothing else of the runner's.
annotate_critical() {
  if [ "${GITHUB_ACTIONS:-}" != true ]; then return 0; fi
  trivy sbom --cache-dir "$cache" --skip-version-check --quiet --severity CRITICAL \
    --ignore-unfixed --format template --template \
    '{{range .}}{{range .Vulnerabilities}}{{.VulnerabilityID}} in {{.PkgName}} {{.InstalledVersion}}, fixed in {{.FixedVersion}}{{"\n"}}{{end}}{{end}}' \
    "sbom/$1.cdx.json" | while IFS= read -r finding; do
    if [ -n "$finding" ]; then echo "::error title=vulnerabilities::$1: $finding"; fi
  done
}

case "${1:-}" in
  api)
    docker buildx build --tag "portfolio/api:$sha" server
    ;;
  # The bundle calls the public API, the server render calls the compose
  # network's. Production's other public values (Sentry, Umami, Turnstile) are
  # deploy.yaml's: this image is tested, never shipped.
  client)
    docker buildx build --tag "portfolio/client:$sha" \
      --build-arg VITE_API_BASE_URL=https://api.alirezarastineh.me \
      --build-arg API_INTERNAL_BASE_URL=http://api:3000 \
      client
    ;;
  # What each image ships, OS packages and node_modules alike, as a CycloneDX
  # SBOM, for the reports and the scan below.
  sbom)
    mkdir -p sbom
    for image in api client; do
      trivy image --cache-dir "$cache" --skip-version-check --quiet --format cyclonedx \
        --output "sbom/$image.cdx.json" "portfolio/$image:$sha"
    done
    ls -l sbom
    ;;
  # Known vulnerabilities that have a fix, read from the SBOMs, so each image is
  # analysed once. Every HIGH is listed, and a CRITICAL fails the step: the
  # owner's choice (2026-10-16) while Analog's nx pins HIGHs nobody can fix
  # here; HIGH blocks once upgrades bring the count down. Waivers, each with
  # its reason, go in .trivyignore.
  vulnerabilities)
    for image in api client; do
      echo "== $image"
      trivy sbom --cache-dir "$cache" --skip-version-check --quiet --table-mode detailed \
        --severity HIGH,CRITICAL --ignore-unfixed "sbom/$image.cdx.json"
    done
    for image in api client; do
      trivy sbom --cache-dir "$cache" --skip-version-check --quiet --severity CRITICAL \
        --ignore-unfixed --exit-code 1 "sbom/$image.cdx.json" > /dev/null || {
        echo "$image: a CRITICAL vulnerability, listed above"
        annotate_critical "$image"
        exit 1
      }
    done
    ;;
  *)
    echo "usage: sh ci/images.sh <api|client|sbom|vulnerabilities>" >&2
    exit 2
    ;;
esac
