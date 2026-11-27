#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
project="slm-smoke-$(date +%s)-$$"
fixture_dir="$(mktemp -d /tmp/slm-integration.XXXXXXXX)"
compose=(docker compose -p "$project")
cleanup() {
  result=$?
  docker rm -fv "$project-db" "$project-provider" "$project-inaccessible" >/dev/null 2>&1 || true
  rm -f /tmp/"$project".log
  if (( result != 0 )); then
    "${compose[@]}" logs --no-color app >&2 || true
  fi
  "${compose[@]}" down --volumes --remove-orphans --rmi local || true
  rm -rf "$fixture_dir"
}
trap cleanup EXIT

openssl req -x509 -newkey rsa:2048 -nodes -days 1 -subj /CN=model-fixture \
  -addext subjectAltName=DNS:model-fixture -keyout "$fixture_dir/key.pem" -out "$fixture_dir/cert.pem" 2>/dev/null
chmod 0644 "$fixture_dir/cert.pem"
cat > "$fixture_dir/compose.yaml" <<EOF_COMPOSE
services:
  app:
    environment:
      NODE_EXTRA_CA_CERTS: /run/slm-fixture-ca.pem
    volumes:
      - $fixture_dir/cert.pem:/run/slm-fixture-ca.pem:ro
EOF_COMPOSE
export COMPOSE_FILE="${COMPOSE_FILE:-$PWD/compose.yaml}:$fixture_dir/compose.yaml"
"${compose[@]}" up --build --wait --wait-timeout 90
export SLM_TEST_DB_PASSWORD
SLM_TEST_DB_PASSWORD="$(openssl rand -hex 24)"
POSTGRES_PASSWORD="$SLM_TEST_DB_PASSWORD" docker run -d --name "$project-db" \
  --network "${project}_default" --network-alias db-fixture \
  -e POSTGRES_USER=slm_fixture -e POSTGRES_DB=fixture -e POSTGRES_PASSWORD \
  postgres:17.7-bookworm@sha256:86e0b703649d7a792bd9243ee28afc9d8f7c6b2b5638077c9d6882d4d472bbfd >/dev/null
for attempt in {1..30}; do
  if docker exec "$project-db" pg_isready -h 127.0.0.1 -U slm_fixture -d fixture >/dev/null; then break; fi
  sleep 1
done
docker exec "$project-db" createdb -U slm_fixture replacement
docker exec -i "$project-db" sh -c 'psql --quiet -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v secret="$POSTGRES_PASSWORD"' <<'SQL'
CREATE ROLE slm_app LOGIN PASSWORD :'secret';
ALTER DATABASE fixture OWNER TO slm_app;
ALTER DATABASE replacement OWNER TO slm_app;
SQL
export SLM_TEST_PROVIDER_KEY
SLM_TEST_PROVIDER_KEY="$(openssl rand -hex 24)"
cp tests/provider-fixture.mjs "$fixture_dir/provider.mjs"
docker run -d --name "$project-provider" --network "${project}_default" --network-alias model-fixture \
  --mount "type=bind,src=$fixture_dir,dst=/fixture,readonly" -e SLM_TEST_PROVIDER_KEY \
  node:24.22.3-bookworm-slim@sha256:873f586f3794f52281bd039bf02c048a0be08fde619338f9941bad1eb6b34530 \
  node /fixture/provider.mjs >/dev/null
for attempt in {1..20}; do
  if docker exec "$project-provider" node -e 'const s=require("net").connect(8443, "127.0.0.1");s.on("connect",()=>s.end());s.on("error",()=>process.exit(1))'; then break; fi
  sleep 1
done
"${compose[@]}" exec -T -e SLM_TEST_DB_PASSWORD -e SLM_TEST_PROVIDER_KEY app node --input-type=module - < tests/boot-check.mjs
cat tests/document-fixtures.mjs tests/boot-check.mjs tests/documents-integration.mjs |
  "${compose[@]}" exec -T -e SLM_TEST_DB_PASSWORD app node --input-type=module - documents
"${compose[@]}" restart app
"${compose[@]}" up --no-build --wait --wait-timeout 90
cat tests/document-fixtures.mjs tests/boot-check.mjs tests/documents-integration.mjs |
  "${compose[@]}" exec -T app node --input-type=module - documents-persisted
"${compose[@]}" exec -T app node --input-type=module - persisted < tests/boot-check.mjs
docker stop "$project-db" >/dev/null
"${compose[@]}" exec -T app node --input-type=module - database-offline < tests/boot-check.mjs

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
