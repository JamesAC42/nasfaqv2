# Releasing NASFAQV2

## Production reliability change (September 2026)

The API now handles background PostgreSQL pool errors without allowing the event to crash Node. Logging includes only a bounded error code, never the client/error object. pg-pool still discards failed idle clients; individual query/transaction failures remain visible to their callers. Do not blindly retry money/trade transactions after an uncertain commit.

`GET /api/live` is process-only and bypasses authentication/database middleware. `GET /api/health` remains database readiness, returns 503 when unavailable and does not expose database error details. API liveness probes use `/api/live`; readiness probes use `/api/health`. Both endpoints disable caching. A failing query makes readiness fail while the process can remain live and recover.

Scheduler, scrapers and Redis use Recreate for controlled Deployment updates, preventing the rolling-update overlap of old/new singleton pods. This introduces a brief interruption when those workloads change. It does not protect against manually created duplicate pods or replace application idempotency/locking. Redis is still a non-persistent cache; no storage or replica counts changed.

## Release path

1. Make changes on a branch based on current `origin/main`. Do not reset or merge over an older dirty checkout. Open a PR and inspect CI.
2. PR CI runs API regressions, the existing frontend build and Go checks, and deployment-script tests. Deployment also calls that same CI workflow on the exact release commit before building images, so direct main pushes cannot bypass these checks.
3. Merging/pushing main starts production deployment automatically. Manual dispatch is limited to main by the validation job condition. The entire release workflow is serialized with `cancel-in-progress: false`; a newer push will not cancel an active migration/rollout. GitHub can replace an older pending run with a newer pending run.
4. Build all five GHCR images tagged `sha-<full commit SHA>`. The workflow no longer publishes or deploys `latest`.
5. Configure explicit Kubernetes context `nasfaq-prod`, then run `bash deploy/release.sh "$RELEASE_SHA" nasfaq-prod "$EXPECTED_API_SERVER"`. The script checks the context API endpoint against the expected endpoint obtained independently from DigitalOcean using the configured cluster secret. Infrastructure IDs are not embedded in this public repository.
6. Render manifests locally, apply namespace/config only, and run the SHA-tagged migration Job. Wait for completion before applying any application Deployment. Existing app versions remain running during migrations; schema changes MUST be backward compatible (expand/contract).
7. Apply the rendered workloads once, wait for all seven Deployment rollouts, then check public `/api/health`. A failed migration, rollout or public health check fails the release; there is no automatic database rollback.

The current application configuration is a ConfigMap consumed as environment variables. Updating it before migrations does not restart existing pods, but a pod recreated independently during that window may observe the new configuration. Review compatibility of config changes with the prior application version too.

## Render without deploying

```bash
bash deploy/render-release.sh FULL_40_CHARACTER_COMMIT_SHA /tmp/nasfaq-rendered-release
```

The output directory must not already exist. Output is separated into `bootstrap/`, `migration.yaml`, and `workloads/`. Base manifests contain `IMAGE_TAG` placeholders; **do not apply `deploy/k8s/` directly**. The renderer is local-only and needs Bash/sed, not cloud credentials. It does not build images: the referenced SHA images must exist before a release.

For a cluster-side validation that persists no changes:

```bash
kubectl --context nasfaq-prod apply --dry-run=server -f /tmp/nasfaq-rendered-release/workloads/
```

## Failure and rollback

- Migration failure: workloads are not updated by the release script. Investigate the Job and database first. Job names are SHA-specific; rerunning the same SHA reuses an existing Job until its TTL cleanup. Do not delete/retry a failed migration Job until partial effects and retry safety are understood.
- Rollout failure: some workloads may already have updated. Inspect rollout status, readiness, current/previous image tags, and bounded logs. Fix forward or roll back affected deployments after checking schema compatibility.
- An authorized application rollback can use `kubectl --context nasfaq-prod -n nasfaq rollout undo deployment/NAME --to-revision=VERIFIED_REVISION`, followed by rollout and health checks. This does not roll back database migrations, ConfigMaps or Deployment strategy fields. Record the working image SHA and reconcile main afterward so the next release does not reintroduce a bad revision.
- Public smoke-check failure may be application, ingress or network related. Inspect before restarting workloads. Kubernetes readiness alone does not establish public availability.

## Local verification

```bash
cd api
npm ci
npm test
cd ..
python3 -m unittest discover -s deploy/tests -v
bash -n deploy/render-release.sh deploy/release.sh
```

API tests use real pg Pool event handling without a database connection and an HTTP server with a controlled failing/recovering database dependency. Release tests execute the real shell scripts with fake kubectl/curl binaries and verify revision rendering, migration-before-rollout ordering, failure propagation and wrong-cluster rejection. They do not constitute a real database restart, image build, GitHub Actions run or live deployment test.

## Operations preference

Keep the existing three-worker cluster. Prioritize reliable, frequent releases over the previously considered $24/month reduction. Timescale cost follow-up needs a recent invoice breakdown, service compute/storage plan and backup/retention settings; no additional credentials are necessary for reviewing those exports.
