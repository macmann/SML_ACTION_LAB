#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
project="slm-smoke-$(date +%s)-$$"
compose=(docker compose -p "$project")
cleanup() {
  result=$?
  docker rm -f "$project-inaccessible" >/dev/null 2>&1 || true
  rm -f /tmp/"$project".log
  if (( result != 0 )); then
    "${compose[@]}" logs --no-color app >&2 || true
  fi
  "${compose[@]}" down --volumes --remove-orphans --rmi local || true
}
trap cleanup EXIT

"${compose[@]}" up --build --wait --wait-timeout 90
"${compose[@]}" exec -T app node --input-type=module - < tests/boot-check.mjs
"${compose[@]}" restart app
"${compose[@]}" up --no-build --wait --wait-timeout 90
"${compose[@]}" exec -T app node --input-type=module - persisted < tests/boot-check.mjs

# Reuse the exact image with an existing volume deliberately made inaccessible.
image="$(docker inspect --format '{{.Image}}' "$("${compose[@]}" ps -q app)")"
"${compose[@]}" exec -T -u 0 app sh -c 'chown root:root /app/data'
"${compose[@]}" stop app
if timeout 20s docker run --rm --name "$project-inaccessible" --mount "type=volume,src=${project}_slm_data,dst=/app/data" "$image" > /tmp/"$project".log 2>&1; then
  echo "Startup unexpectedly succeeded with an inaccessible existing volume." >&2
  exit 1
fi
grep -q 'Cannot initialize app data' /tmp/"$project".log
rm -f /tmp/"$project".log
echo "Existing inaccessible volume rejected."
