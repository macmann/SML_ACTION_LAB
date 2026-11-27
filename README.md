# SLM Action Lab

A standalone, single-admin document and productivity workspace. Phase 1 delivers the workspace shell, administrator claim, sign-in, and production container.

## Run in Coolify

Use the Docker Compose build pack with [compose.yaml](compose.yaml). Attach the application domain to the `app` service on port 3000 and enable HTTPS. The project creates one app container and the `slm_data` named volume on its Compose network. Build and first boot require no project environment variables or external services.

Open the application domain. In the app container terminal, run the following command and enter the result privately in the first-run wizard along with a new admin password.

```sh
cat /app/data/config/pairing-code
```

The volume must be writable by the app user (UID and GID 1000 in the image). Docker initializes a fresh named volume from the image. If reusing an existing volume, inspect its contents and ownership before transferring it to the application user. Startup fails with a diagnostic when a volume cannot be safely opened. Back up the volume to preserve the account and future document data.

Coolify uses `GET /api/health/live` for its container health check. `GET /api/health/ready` reports administrator claim, database, and provider state. It returns 503 while the database and provider remain unconfigured, including after the instance is claimed.

## Develop locally

Use Node 24.22.3 and npm from that distribution.

```sh
npm ci
npm run dev
```

Open localhost on port 3000. The local server initializes the ignored `data/` directory. Read the pairing code from `data/config/pairing-code`.

```sh
npm run lint
npm run typecheck
npm test
npm run build
npm run test:integration
```

The integration command requires Docker Engine and Compose v2. It uses a disposable Compose project and volume without publishing a host port. See the [architecture](docs/architecture.md), [product spec](docs/product-spec.md), and [implementation status](docs/IMPLEMENTATION_STATUS.md).
