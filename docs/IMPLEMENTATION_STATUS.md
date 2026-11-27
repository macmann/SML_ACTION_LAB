# Implementation status

## Phase 1 — standalone shell and zero-config boot

- Added the Next.js App Router workspace, seven guarded sections, first-run pairing, password-based admin sign-in, and sign-out.
- Added a production Compose service running as UID 1000, a persistent named volume, and separate liveness and readiness endpoints. Unclaimed and claimed instances can serve pages while readiness reports the database and provider as unconfigured.
- Added private data paths, an atomic claim write, a lockfile, pinned runtime and CI action versions, and GitHub Actions verification.

## Validation commands

| Command | Result |
| --- | --- |
| `npm --cache /tmp/slm-npm ci --no-fund` | Clean lockfile install on Node 24.22.3. |
| `npm run lint` | Passed. |
| `npm run typecheck` | Passed, including generation of route types. |
| `npm test` | Four passed, zero failed or skipped. |
| `NEXT_TELEMETRY_DISABLED=1 npm run build` | Passed. Next.js emitted standalone output. |
| `npm --cache /tmp/slm-npm audit` | Zero reported vulnerabilities. |
| `docker compose config --quiet` | Passed. |
| `npm run test:integration` | The plain Cloud build hit `SELF_SIGNED_CERT_IN_CHAIN` at the npm registry. CI is configured to run the plain command. |
| `COMPOSE_FILE="$PWD/compose.yaml:<temporary-override>" npm run test:integration` | Passed with the Cloud proxy CA mounted only for `npm ci`. Verified fresh-volume startup as non-root, liveness, unconfigured readiness, guarded routes, admin claim and session, restart persistence, and visible rejection of an inaccessible existing volume. |

The temporary Docker override used the same production stages and runtime. It mounted the managed Cloud CA for the dependency-install step with TLS verification active. The shipped Dockerfile and Compose file have no CA mount or build-secret requirement.

A local headless Chromium check used Playwright Core 1.65.1 against the standalone server. It exercised the first-run redirect and claim, keyboard focus, all seven sections, sign-out, and checked document width at 320 and 1280 CSS pixels with system color preferences. All checks passed.

Direct dependency licenses were checked against installed package metadata. TypeScript and class-variance-authority use Apache-2.0. The other direct npm dependencies and the adapted shadcn/ui source use MIT. Transitive package identifiers and licenses are recorded in the lockfile. A deployment image also inherits licenses from its pinned Node/Debian base.

## Limits and next phase

The workspace sections currently present capability status. Database configuration, migrations, model configuration, document workflows, speech, office conversion, and application history are future phases. Coolify ingress and deployment on the Contabo VPS have not been exercised.

Next, add administrator-managed PostgreSQL configuration with `pg`, versioned SQL migrations, and readiness checks. Add provider settings and probe the explicitly selected provider before making those workflows available. Admin password rotation and server-side session revocation are also pending.
