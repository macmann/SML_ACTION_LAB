# Coolify deployment and operations

SLM Action Lab is a single-admin experimental app. The repository Compose definition builds one Linux amd64 app container, attaches one named volume at `/app/data`, and exposes port 3000 to the proxy. Use a CPU with AVX2 for Whisper. Setup and liveness work before configuring PostgreSQL or a provider. Native executables are bundled. The operator installs the verified speech weights separately. [Speech installation](speech.md)

## Deploy a reviewed revision

1. In Coolify, create a Git-backed Application for the reviewed revision. Select the **Docker Compose** build strategy, repository root as the base directory and `/compose.yaml` as the Compose location. Review the rendered Compose. Keep automatic deployment disabled until the release is approved.
2. Under **Domains**, route the application HTTPS domain to service `app`, internal port `3000`. Let the Coolify proxy terminate TLS and preserve the original host. Configure trusted proxy forwarding and keep the backend port private. Keep request/error logging free of headers, cookies, request bodies and credentials. The app needs no environment settings, published host ports or privileged flags.
3. Confirm that the existing named volume will be reused on upgrades. The app runs as UID and GID 1000. A new Docker volume gets the required ownership from the image. An existing inaccessible volume makes startup fail visibly. Keep a single app replica because the queue, index and credential rate limits are process-local.
4. After approval, build and start through Coolify. Open the domain and confirm the setup page. Use `/api/health/live` for process health. `/api/health/ready` reports saved setup states and returns 503 before configuration. It does not test network dependencies and should never be used to restart the app.
5. In a private app terminal, run `node scripts/operator.mjs pair`. Use the token within 15 minutes to claim the instance. Keep it out of tickets and logs. Configure and test PostgreSQL, confirm the database is dedicated, and run workspace migrations. Configure a provider or select manual mode.
6. Open **Settings → Diagnostics**. Check setup, actual PostgreSQL connectivity and migration ledger, provider configuration, local binary/model capability flags, index counts and available disk. The index starts cold and loads on first workspace use. Provider connectivity is verified only by the explicit Settings test. Browser microphone access requires HTTPS and browser permission.

[Coolify Git-backed Compose documentation, reviewed revision](https://github.com/coollabsio/coolify-docs/blob/4b6ba684ff0fdc177d4c0911ecb4890b0e89d5d6/content/docs/applications/builds/docker-compose.mdx)

## PostgreSQL and proxy boundaries

Configure a private DNS name or address reachable from inside the app container. Coolify resource names and Docker service names are scoped to networks. For an external database on the VPS or in another project, use a deliberately shared private Docker network with a verified DNS alias, or a private interface reachable from the app network. Review Coolify's destination/networks and verify name resolution inside the actual deployed container before the connection test. The production Compose has no dependency on another project or network name.

Provision a restricted login for a dedicated database. Permit TCP 5432 only from the required network or app hosts, bind PostgreSQL to the private interface, and verify firewall and `pg_hba.conf`. Use `sslmode=verify-full` and a trusted CA and matching hostname over any untrusted transport. `sslmode=disable` is accepted only for private IPs and should be confined to trusted isolated networks. Enter the connection in Settings and let the app probe it. Keep the database URL and provider credentials out of Compose, shell arguments on shared hosts, screenshots and issue reports.

[Coolify networking documentation](https://github.com/coollabsio/coolify-docs/blob/4b6ba684ff0fdc177d4c0911ecb4890b0e89d5d6/content/docs/core/networking-in-coolify.mdx)

## Resource checks

Compose requests two CPUs and 3 GiB memory with `cpus: 2.0` and `mem_limit: 3g`. Confirm the rendered service still has both settings and inspect the running app from the Docker host after deployment.

```sh
docker inspect --format '{{.HostConfig.Memory}} {{.HostConfig.NanoCpus}} {{.Config.User}}' APP_CONTAINER
docker exec APP_CONTAINER sh -c 'cat /sys/fs/cgroup/cpu.max /sys/fs/cgroup/memory.max'
docker stats --no-stream APP_CONTAINER
```

Expect `3221225472 2000000000 node` from inspect. On a cgroup v2 host, verify that CPU quota divided by period equals two and that the memory limit is 3,221,225,472 bytes. The builder, proxy and external database have separate resource budgets. Cloud's rootless Docker reported the requested HostConfig but exposed the environment's shared cgroup to the check. Coolify enforcement remains a target-host check.

One process-wide CPU-job lane runs speech, Office and document parsing with up to three waiting jobs. The workspace has a 64 MiB upload ceiling, a 25 MiB default, 1,500 documents, 12,000 indexed sections, 4 million indexed characters and 2 GiB of originals per active database. The shared volume guard caps originals plus extracted artifacts at 3 GiB and reserves 256 MiB of filesystem free space for writes. Models, bootstrap files, native temp jobs and backups require separate capacity. Set a filesystem-level quota or dedicated filesystem if a hard limit covering the entire volume is required. Monitor filesystem free space and Docker logs. Compose rotates local container logs at three 10 MB files.

LibreOffice requires an unprivileged bubblewrap namespace sandbox. Restrictive hosts may block it. Verify with a small synthetic conversion and confirm the resulting PDF downloads. The converter fails closed when isolation cannot start. Keep the container non-root and the default protections enabled. DOCX editing and PDFKit invoice generation remain usable.

## Backup, restore and rollback

Schedule a maintenance window to stop the app and prevent writes to its dedicated database. Capture PostgreSQL and the **same** named volume as one backup set. Keep an off-host encrypted copy with restricted access and retention. `config/bootstrap.json`, `config/master.key` and `config/session.key` must travel together. The app key protects encrypted fields from accidental disclosure, and the co-located key and config are readable by a privileged host operator. The backup is sensitive even if the workspace itself contains fictional records.

The example uses GnuPG recipient encryption, a trusted pinned app image already on the host, and a PostgreSQL service definition and private password file on the operator's workstation. Replace placeholders and set `pipefail` before running. Stop the app before starting either command. Keep backup tooling outside production Compose.

```bash
set -euo pipefail
umask 077
pg_dump --format=custom --dbname=service=slm_backup |
  gpg --encrypt --recipient "$BACKUP_RECIPIENT" --output slm-db.dump.gpg
docker run --rm --network none --mount "type=volume,src=$APP_VOLUME,dst=/app/data,readonly" \
  --entrypoint tar "$APP_IMAGE" --exclude=./tmp -C /app/data -cf - . |
  gpg --encrypt --recipient "$BACKUP_RECIPIENT" --output slm-data.tar.gpg
sha256sum slm-db.dump.gpg slm-data.tar.gpg > slm-backup.sha256
```

Store the checksum and the exact application commit and image digest with the set. Test retrieval and decryption before ending maintenance. Restart the app on its original volume and confirm liveness. The integration release test restores a disposable pair and checks restored admin access, search and original download.

For a restore, use a fresh empty volume and a fresh dedicated database on an isolated destination. Verify the backup checksums and provenance before feeding a trusted archive to tar. Restore the database as the restricted app owner using a compatible PostgreSQL client. Start the matching image and supply the restored PostgreSQL endpoint via Settings if it changed. Preserve installation identifiers and do not modify the migration ledger. If the original destination is reachable, block it from the isolated restore while reconfiguring. Do not make provider calls from the restored copy until credentials are reviewed.

```bash
set -euo pipefail
sha256sum -c slm-backup.sha256
gpg --decrypt slm-db.dump.gpg |
  pg_restore --exit-on-error --no-owner --dbname=service=slm_restore
docker volume create "$RESTORE_VOLUME"
gpg --decrypt slm-data.tar.gpg |
  docker run --rm -i --network none --user root \
    --mount "type=volume,src=$RESTORE_VOLUME,dst=/app/data" \
    --entrypoint tar "$APP_IMAGE" --numeric-owner -C /app/data -xf -
```

Verify authenticated diagnostics, migration state, document count, sample download hashes, and one manual search. Compare with the backup inventory and document results. An ordinary recreation must keep the named volume. Avoid any command that removes production volumes while troubleshooting.

For a release rollback, stop the app and determine whether the older image accepts the current ledger. If there is a migration mismatch, restore the pre-upgrade database and volume to separate destinations and use the matching image. Preserve the failed upgrade data for investigation. Never edit ledger checksums or run a destructive down migration. Migrations are transactional and versions 1–5 are unchanged in this release.

For account recovery, use `node scripts/operator.mjs reset-password` with the new password piped privately on stdin. It revokes existing sessions. Restore the paired encrypted bootstrap and keys if a key is lost. For suspected host compromise, rotate all external credentials and rebuild the host from trusted media.

For retention, agree an archive schedule before collecting records. Remove finished documents through the UI and review attached records before deletion. Namespace-scoped reconciliation removes aged unreferenced originals/artifacts for the active database. Old database namespaces and abandoned temporary jobs should be inventoried and archived or removed offline only after a verified backup. Keep approval and request ID records because they support replay protection. Remove metadata from retained reports only after verifying the impact on auditability. Do not include sensitive support dumps in logs. The app records redacted inference metadata and stores synthetic Arena cases and generated drafts separately.
