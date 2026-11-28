#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
project="slm-smoke-$(date +%s)-$$"
fixture_dir="$(mktemp -d /tmp/slm-integration.XXXXXXXX)"
compose=(docker compose -p "$project")
cleanup() {
  result=$?
  docker rm -fv "$project-db" "$project-provider" "$project-inaccessible" "$project-restored" >/dev/null 2>&1 || true
  docker volume rm "${project}_restored" >/dev/null 2>&1 || true
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
export COMPOSE_FILE="${COMPOSE_FILE:-$PWD/compose.yaml}"
fixture_image="node:24.22.3-bookworm-slim@sha256:873f586f3794f52281bd039bf02c048a0be08fde619338f9941bad1eb6b34530"
"${compose[@]}" build
image="$(docker image inspect --format '{{.Id}}' "$("${compose[@]}" config --images)")"
docker run --rm --network none --cpus 2 --memory 3g --entrypoint sh "$image" -ec '
  node scripts/speech-smoke.mjs 3221225472
  for cli in /opt/slm-speech/bin/whisper-cli /opt/slm-speech/piper/piper /usr/bin/libreoffice; do "$cli" --help >/dev/null 2>&1; done'
"${compose[@]}" up --no-build --wait --wait-timeout 90
container="$("${compose[@]}" ps -q app)"
test "$(docker inspect --format '{{.HostConfig.Memory}} {{.HostConfig.NanoCpus}} {{.Config.User}}' "$container")" = "3221225472 2000000000 node"
"${compose[@]}" exec -T app node -e '
  const a=require("node:assert/strict");
  a.equal(process.env.NODE_EXTRA_CA_CERTS,undefined);
  Promise.all([
    fetch("http://127.0.0.1:3000/api/health/live").then(r=>a.equal(r.status,200)),
    fetch("http://127.0.0.1:3000/api/health/ready").then(async r=>{a.equal(r.status,503);a.equal((await r.json()).stage,"unclaimed")}),
    fetch("http://127.0.0.1:3000/api/diagnostics").then(r=>a.equal(r.status,401)),
  ]).catch(e=>{console.error(e);process.exitCode=1});'
echo "Zero-configuration liveness, native executables and Docker resource settings verified."
"${compose[@]}" rm --stop --force app
cat > "$fixture_dir/compose.yaml" <<EOF_COMPOSE
services:
  app:
    environment:
      NODE_EXTRA_CA_CERTS: /run/slm-fixture-ca.pem
    volumes:
      - $fixture_dir/cert.pem:/run/slm-fixture-ca.pem:ro
EOF_COMPOSE
export COMPOSE_FILE="$COMPOSE_FILE:$fixture_dir/compose.yaml"
if [[ "${SLM_BROWSER_TEST:-0}" == 1 ]]; then
  cat > "$fixture_dir/browser.yaml" <<'EOF_COMPOSE'
services:
  app:
    ports: ["127.0.0.1::3000"]
EOF_COMPOSE
  export COMPOSE_FILE="$COMPOSE_FILE:$fixture_dir/browser.yaml"
fi
"${compose[@]}" up --no-build --wait --wait-timeout 90
if [[ "${SLM_BROWSER_TEST:-0}" == 1 ]]; then
  node tests/browser-e2e.mjs "http://$("${compose[@]}" port app 3000)" unclaimed
fi
export SLM_TEST_DB_PASSWORD
SLM_TEST_DB_PASSWORD="$(openssl rand -hex 24)"
POSTGRES_PASSWORD="$SLM_TEST_DB_PASSWORD" docker run -d --name "$project-db" \
  --network "${project}_default" --network-alias db-fixture \
  -e POSTGRES_USER=slm_fixture -e POSTGRES_DB=fixture -e POSTGRES_PASSWORD \
  "${SLM_TEST_POSTGRES_IMAGE:-postgres:17.7-bookworm@sha256:86e0b703649d7a792bd9243ee28afc9d8f7c6b2b5638077c9d6882d4d472bbfd}" >/dev/null
for attempt in {1..30}; do
  if docker exec "$project-db" pg_isready -h 127.0.0.1 -U slm_fixture -d fixture >/dev/null; then break; fi
  sleep 1
done
docker exec "$project-db" createdb -U slm_fixture replacement
docker exec -i "$project-db" sh -c 'psql --quiet -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v secret="$POSTGRES_PASSWORD"' <<'SQL'
CREATE ROLE slm_app LOGIN PASSWORD :'secret';
CREATE ROLE slm_limited LOGIN PASSWORD :'secret';
CREATE ROLE slm_elevated LOGIN CREATEROLE PASSWORD :'secret';
CREATE ROLE offgrid_app LOGIN PASSWORD :'secret';
CREATE DATABASE "OFFGRID" OWNER offgrid_app;
GRANT pg_read_all_data TO offgrid_app;
ALTER DATABASE fixture OWNER TO slm_app;
ALTER DATABASE replacement OWNER TO slm_app;
SQL
export SLM_TEST_PROVIDER_KEY
SLM_TEST_PROVIDER_KEY="$(openssl rand -hex 24)"
openssl genpkey -algorithm ED25519 -out "$fixture_dir/model-key.pem"
export SLM_TEST_MODEL_PUBLIC_KEY SLM_TEST_SCHEMA_HASH
SLM_TEST_MODEL_PUBLIC_KEY="$(openssl pkey -in "$fixture_dir/model-key.pem" -pubout)"
SLM_TEST_SCHEMA_HASH="$(node --input-type=module -e 'import {schemaHash} from "./lib/tool-registry.mjs"; process.stdout.write(schemaHash)')"
cp tests/provider-fixture.mjs "$fixture_dir/provider.mjs"
docker run -d --name "$project-provider" --network "${project}_default" --network-alias model-fixture \
  --mount "type=bind,src=$fixture_dir,dst=/fixture,readonly" -e SLM_TEST_PROVIDER_KEY \
  "$fixture_image" \
  node /fixture/provider.mjs >/dev/null
for attempt in {1..20}; do
  if docker exec "$project-provider" node -e 'const s=require("net").connect(8443, "127.0.0.1");s.on("connect",()=>s.end());s.on("error",()=>process.exit(1))'; then break; fi
  sleep 1
done
"${compose[@]}" exec -T -e SLM_TEST_DB_PASSWORD -e SLM_TEST_PROVIDER_KEY app node --input-type=module - < tests/boot-check.mjs
if [[ "${SLM_BROWSER_TEST:-0}" == 1 ]]; then
  "${compose[@]}" exec -T app cat /app/data/tmp/smoke-password |
    node tests/browser-e2e.mjs "http://$("${compose[@]}" port app 3000)" before-migration
fi
cat tests/document-fixtures.mjs tests/boot-check.mjs tests/documents-integration.mjs |
  "${compose[@]}" exec -T -e SLM_TEST_DB_PASSWORD app node --input-type=module - documents
before="$("${compose[@]}" ps -q app)"
"${compose[@]}" rm --stop --force app
"${compose[@]}" up --no-build --wait --wait-timeout 90
test "$before" != "$("${compose[@]}" ps -q app)"
cat tests/document-fixtures.mjs tests/boot-check.mjs tests/documents-integration.mjs |
  "${compose[@]}" exec -T app node --input-type=module - documents-persisted
"${compose[@]}" exec -T app node --input-type=module - persisted < tests/boot-check.mjs
cat tests/boot-check.mjs tests/agent-integration.mjs |
  "${compose[@]}" exec -T -e SLM_TEST_DB_PASSWORD -e SLM_TEST_PROVIDER_KEY -e SLM_TEST_MODEL_PUBLIC_KEY -e SLM_TEST_SCHEMA_HASH \
    app node --input-type=module - agent
if [[ "${SLM_BROWSER_TEST:-0}" == 1 ]]; then
  "${compose[@]}" exec -T app cat /app/data/tmp/smoke-password |
    node tests/browser-e2e.mjs "http://$("${compose[@]}" port app 3000)"
fi

# Restore a stopped app/DB pair into a fresh volume and a freshly created fixture database.
umask 077
"${compose[@]}" exec -T app cat /app/data/tmp/smoke-password > "$fixture_dir/admin-password"
"${compose[@]}" rm --stop --force app
docker run --rm --network none --mount "type=volume,src=${project}_slm_data,dst=/app/data,readonly" \
  --entrypoint tar "$fixture_image" --exclude=./tmp -C /app/data -cf - . > "$fixture_dir/volume.tar"
docker exec "$project-db" pg_dump --format=custom -U slm_fixture replacement > "$fixture_dir/database.dump"
docker exec "$project-db" psql -X -q -v ON_ERROR_STOP=1 -U slm_fixture -d fixture \
  -c 'ALTER DATABASE replacement RENAME TO before_restore;' -c 'CREATE DATABASE replacement OWNER slm_app;'
docker exec -i "$project-db" pg_restore --exit-on-error --no-owner --role=slm_app \
  -U slm_fixture -d replacement < "$fixture_dir/database.dump"
docker volume create "${project}_restored" >/dev/null
docker run --rm -i --network none --user root --mount "type=volume,src=${project}_restored,dst=/app/data" \
  --entrypoint tar "$fixture_image" --numeric-owner -C /app/data -xf - < "$fixture_dir/volume.tar"
docker run -d --name "$project-restored" --network "${project}_default" \
  --mount "type=volume,src=${project}_restored,dst=/app/data" "$image" >/dev/null
for attempt in {1..30}; do
  if docker exec "$project-restored" node -e 'fetch("http://127.0.0.1:3000/api/health/live").then(r=>{if(!r.ok)process.exitCode=1}).catch(()=>process.exitCode=1)'; then break; fi
  sleep 1
done
docker exec -i "$project-restored" sh -c 'umask 077 && cat > /app/data/tmp/smoke-password' < "$fixture_dir/admin-password"
docker exec -i "$project-restored" node --input-type=module - restored < tests/boot-check.mjs
docker rm -f "$project-restored" >/dev/null
"${compose[@]}" up --no-build --wait --wait-timeout 90
docker stop "$project-provider" >/dev/null
"${compose[@]}" exec -T app node --input-type=module - provider-offline < tests/boot-check.mjs
docker stop "$project-db" >/dev/null
"${compose[@]}" exec -T app node --input-type=module - database-offline < tests/boot-check.mjs

# Reuse the exact image with an existing volume deliberately made inaccessible.
"${compose[@]}" exec -T -u 0 app sh -c 'chown root:root /app/data'
"${compose[@]}" rm --stop --force app
docker create --name "$project-inaccessible" --mount "type=volume,src=${project}_slm_data,dst=/app/data" "$image" >/dev/null
if timeout 60s docker start --attach "$project-inaccessible" > /tmp/"$project".log 2>&1; then
  echo "Startup unexpectedly succeeded with an inaccessible existing volume." >&2
  exit 1
fi
grep -q 'Cannot initialize app data' /tmp/"$project".log
rm -f /tmp/"$project".log
echo "Existing inaccessible volume rejected."
