# Sourced by the scripts in this folder: `load_env <file>` exports the
# KEY=VALUE lines of the repo .env.
#
# The file is read as data, the way docker compose reads it, never run as a
# shell script. `source .env` breaks on values compose accepts — an unquoted
# value with spaces (`TITLE=Alireza Rastineh Portfolio` runs a command called
# "Rastineh"), `$$` (compose's escape for a literal `$`, but bash's PID) — and
# it would execute anything a value happened to contain.
#
# - `# comment` lines and blank lines are skipped; `export KEY=…` is accepted.
# - "double" and 'single' quotes around a value are removed.
# - In unquoted values, ` #` starts a comment and trailing blanks are trimmed.
# - `$$` becomes `$` (unquoted and double-quoted values, as in compose).
#   Other `${VAR}` references are left as written: this .env uses none.
# - Values in the file win over the environment, as `source` did.

load_env() {
  local file="$1" line key value
  while IFS= read -r line || [[ -n "${line}" ]]; do
    line="${line%$'\r'}"
    [[ "${line}" =~ ^[[:space:]]*(#|$) ]] && continue
    if [[ ! "${line}" =~ ^[[:space:]]*(export[[:space:]]+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$ ]]; then
      echo "load_env: ignoring a line that is not KEY=VALUE in ${file}" >&2
      continue
    fi
    key="${BASH_REMATCH[2]}"
    value="${BASH_REMATCH[3]}"

    if [[ "${value}" =~ ^\'(.*)\'[[:space:]]*$ ]]; then
      value="${BASH_REMATCH[1]}"
    elif [[ "${value}" =~ ^\"(.*)\"[[:space:]]*$ ]]; then
      value="${BASH_REMATCH[1]//\$\$/\$}"
    else
      value="${value%%[[:space:]]#*}"
      value="${value%"${value##*[![:space:]]}"}"
      value="${value//\$\$/\$}"
    fi
    export "${key}=${value}"
  done <"${file}"
}
