#!/bin/sh
# Advisory code health (Woodpecker plan, Phase 9), for either package: run it
# from server/ or client/.
# - knip reports unused files, exports and dependencies, by the rules in the
#   package's knip.js, and never fails: there are always some (the owner's
#   choice, 2026-10-16).
# - madge reports circular imports that survive compilation. Type-only imports,
#   which TypeScript erases, are skipped. There are none today, so a finding is
#   new.
# npx resolves only versions published before --before, transitive ones
# included, so a release newer than the pin's age never runs here.
#   sh ../ci/code-health.sh knip
#   sh ../ci/code-health.sh cycles <tsconfig>
set -eu

case "${1:-}" in
  knip)
    npx --yes --no-update-notifier --before=2026-10-02 knip@6.39.0 --no-progress --no-exit-code
    ;;
  cycles)
    # madge reads its options through rc, from the environment too.
    madge_detectiveOptions__ts__skipTypeImports=true \
      npx --yes --no-update-notifier --before=2026-10-02 madge@8.0.0 --circular --no-spinner \
      --extensions ts --ts-config "${2:?usage: sh ../ci/code-health.sh cycles <tsconfig>}" src
    ;;
  *)
    echo "usage: sh ../ci/code-health.sh knip | cycles <tsconfig>" >&2
    exit 2
    ;;
esac
