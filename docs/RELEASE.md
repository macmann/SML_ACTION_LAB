# Release candidate checklist

Use the reviewed commit and record its full Git SHA and image digest before creating a release or configuring Coolify auto-deploy. Keep this checklist with the evidence for the candidate. [Implementation status](IMPLEMENTATION_STATUS.md)

## Verification

- [x] Clean clone. Confirm repository status, install from the npm lockfile, validate contracts and datasets, run lint, typechecks, unit tests and a standalone build.
- [x] Run the zero-config Docker integration. Verify private health and diagnostics behavior, wrong-token handling, TLS model probe and failures, migrations, uploads, search, all ten native agent cases, approval replay, missing speech weights, authenticated downloads, recreation and backup restore.
- [x] Run Chromium E2E. Verify the real setup, login, document upload, search, preview, download and missing-model interface at mobile and desktop widths.
- [ ] On the intended host, confirm proxy routing and HTTPS, PostgreSQL reachability and TLS, non-root UID, 3 GiB and two CPUs, the existing named volume, and a documented backup and restore drill.
- [ ] Install verified speech models and test actual Whisper and Piper outputs. Measure CPU time and peak memory on the target. Verify browser permission over HTTPS. Test isolated Office conversion without changing container privilege.
- [ ] If using Distil, verify the export with the CLI and confirm checkpoint metadata and endpoint attestation. Keep evaluation records and vendor denominators. Run paid evaluation only after separate authorization.
- [ ] Obtain explicit approval before creating a release tag or deploying.

## Reproduce checks

```sh
npm ci --no-fund
npm run lint
npm run typecheck
npm run contracts:check
npm run training:audit
npm test
npm run build
docker compose config --quiet
npx playwright-core install --with-deps chromium
SLM_BROWSER_TEST=1 npm run test:integration
```

For a locally installed Chromium, set `SLM_CHROMIUM` to its absolute path. Optional `SLM_SCREENSHOT_DIR` saves current setup and document captures with synthetic data. The integration harness creates disposable PostgreSQL, HTTPS model fixtures, and isolated backup destinations. It generates fixture secrets at run time. Its loopback port mapping exists only for the browser checks. Production Compose uses no published ports or database service.

The fixture pack is under `tests/`. `document-fixtures.mjs` constructs fictional Office/PDF/tabular inputs. `provider-fixture.mjs` responds with synthetic native calls and optional signed attribution. `browser-e2e.mjs` creates its own fictional document. The offline speech smoke synthesizes a known spoken phrase. [Speech smoke](speech.md) · [Training export](DISTIL_TRAINING.md) · [Coolify and recovery](COOLIFY.md)

Deferred or deployment-specific checks include live Coolify ingress/cgroup enforcement, installed-model speech and target-host timings, permission with an HTTPS microphone on the intended device, sandboxed DOCX-to-PDF on the intended host, Distil CLI/platform validation, tuned accuracy, and model or deployment certification. The app remains single-admin and experimental.
