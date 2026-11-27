# SLM Action Lab

A standalone, single-admin document and productivity workspace. The workspace boots without configuration. Claim the administrator account, connect PostgreSQL, and optionally configure model providers after startup.

## Run in Coolify

Use the Docker Compose build pack with [compose.yaml](compose.yaml). Attach the application domain to the `app` service on port 3000 and enable HTTPS. The project creates one app container and the `slm_data` named volume on its Compose network. Build and first boot require no project environment variables or external services.

Open the application domain. In the app container terminal, run the following command and enter the result privately in the first-run wizard along with a new admin password. Each invocation invalidates the previous token and issues a new one that expires in 15 minutes.

```sh
node scripts/operator.mjs pair
```

The volume must be writable by the app user (UID and GID 1000 in the image). Docker initializes a fresh named volume from the image. If reusing an existing volume, inspect its contents and ownership before transferring it to the application user. Startup fails with a diagnostic when a volume cannot be safely opened. Back up the volume to preserve the account, keys, encrypted settings, and future document data. Keep the backup private.

Coolify uses `GET /api/health/live` for its container health check. `GET /api/health/ready` reports the setup stage. It returns 503 until PostgreSQL has passed a probe and an administrator has configured Distil or explicitly selected manual mode. These are saved configuration states. The public endpoint does not contact providers or the database.

## Develop locally

Use Node 24.22.3 and npm from that distribution.

```sh
npm ci
npm run dev
```

Open localhost on port 3000. The local server initializes the ignored `data/` directory. Generate a token in a separate terminal from the repository root with `node scripts/operator.mjs pair`. The host needs Linux `flock` from util-linux. Plain HTTP login is supported only on loopback for development.

```sh
npm run lint
npm run typecheck
npm test
npm run build
npm run test:integration
```

The integration command requires Docker Engine and Compose v2. It uses a disposable Compose project, volume, PostgreSQL server, and HTTPS model fixture without publishing a host port. The test also requires OpenSSL. See the [architecture](docs/architecture.md), [product spec](docs/product-spec.md), and [implementation status](docs/IMPLEMENTATION_STATUS.md).

## Recovery and credential rotation

In Settings, change the admin password with its current value or test and save replacement database and provider credentials. A blank password-masked setting keeps the existing value. A provider key is never carried over to a different endpoint unless the administrator supplies a replacement explicitly.

If the administrator password is lost, use a trusted private terminal on the Docker host. In Bash, supply a new password via standard input so it stays out of command arguments and shell history.

```sh
read -rsp 'New administrator password: ' slm_recovery_password
printf '\n'
printf '%s\n' "$slm_recovery_password" | docker compose exec -T app node scripts/operator.mjs reset-password
unset slm_recovery_password
```

The console reset revokes existing sessions and clears throttling for the account. Restore `data/config/bootstrap.json`, `data/config/master.key`, and `data/config/session.key` from the same backup while the app is stopped. Preserve owner and permissions. A lost master key makes existing encrypted credentials unrecoverable. The app will fail visibly if a key file is missing. Keep an independent backup of PostgreSQL.
