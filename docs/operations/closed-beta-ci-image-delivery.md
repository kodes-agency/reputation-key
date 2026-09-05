# Closed-beta CI image delivery

Status: publish and operator paths prepared; live source cutover has not happened

Owner: Platform/Operations

This is the delivery path for the existing `google-closed-beta` environment. It
is deliberately separate from the governed `cell-us` promotion ceremony in
[Immutable release build and Railway promotion](immutable-release-promotion.md).
`.github/workflows/release-images.yml` remains workflow-dispatch-only, retains
all of its CI, beta-evidence, provider-approval, signing, and manifest
preflights, and is the only governed `cell-us` promotion path. A closed-beta CI
digest map is not a promotion manifest and cannot authorize that ceremony.

## Published images and evidence

A successful `push` run of `.github/workflows/ci.yml` on `refs/heads/main`
stages the same local images that its grouped Docker jobs already built,
smoke-checked, inventoried, and passed through Grype under unique
`ci-run-<runId>-<runAttempt>` tags. Only after all three groups pass does the
aggregate job validate the exact seven-image set and promote those exact
digests to `ghcr.io/kodes-agency/repkey-<slug>:<40-character GITHUB_SHA>`.
Promotion preserves and reads back each manifest digest, is idempotent only
when an existing SHA tag has the same digest, never rebuilds, and never emits
`latest`.

The seven closed-beta production images are:

1. `web`
2. `worker`
3. `google-provider-redis`
4. `google-egress-gateway`
5. `google-execution-admission`
6. `ai-egress-gateway`
7. `ai-execution-admission`

`google-provider-redis` is included because it is a live, hardened production
service image even though the current source-rebuild problem concerns the six
GitHub-backed application and sidecar services. `provider-sandbox` is a test
provider, `perf-runner` is a load-test tool, and
`google-import-compatibility` is rollout/compatibility verification rather than
a serving closed-beta service; those three remain built and scanned by CI but
are not published by this path. The governed release workflow still owns its
separate rollout-only compatibility image.

Each production-image group stages its digest descriptors separately. The
aggregate Docker job requires the exact seven-name set, verifies all seven
promoted SHA references, and uploads one 90-day artifact named
`ci-image-digest-map-<sourceRevision>` containing `ci-image-digest-map.json`.
Its machine-readable contract is:

```json
{
  "version": "repkey-ci-image-digest-map-1",
  "sourceRevision": "<40 lowercase hex>",
  "source": {
    "repository": "kodes-agency/reputation-key",
    "ref": "refs/heads/main",
    "workflow": ".github/workflows/ci.yml",
    "runId": "<GitHub Actions run id>",
    "runAttempt": 1
  },
  "images": {
    "web": {
      "repository": "ghcr.io/kodes-agency/repkey-web",
      "digest": "sha256:<64 lowercase hex>",
      "sourceRevision": "<the same 40 lowercase hex>"
    }
  }
}
```

The `images` object contains all seven entries in the list above. The abbreviated
single entry only illustrates the repeated shape. The operator parser rejects an
extra or missing image, a missing/invalid digest, an unexpected repository, a
per-image revision mismatch, a non-main/non-CI producer, or a workflow run
identity mismatch.

## Package visibility and pull credentials

`kodes-agency/reputation-key` is a **public** repository, so packages first
published by its `GITHUB_TOKEN` inherit public visibility. Verified on the
first main run of this path (`415581c2`): an unauthenticated
`GET /v2/kodes-agency/repkey-web/manifests/<sha>` returns HTTP 200.

That is the intended posture while the repository is public, and it means
**Railway needs no registry credentials on any plan.** There is no manual
per-service credential step and no Pro-plan prerequisite for this path.

The images were checked for secret material before this was accepted. The
published `web`, `worker`, `google-egress-gateway` and `ai-execution-admission`
configs carry no secret-shaped environment variables, run as the non-root
`node` user, and the only build argument surviving into final-image history is
`SOURCE_REVISION`. Build-time arguments such as `SENTRY_AUTH_TOKEN`,
`BETTER_AUTH_SECRET` and `ENCRYPTION_KEY` are confined to discarded builder
stages, and every runtime secret is supplied by Railway environment variables
rather than baked into a layer. Re-run that check whenever a Dockerfile starts
consuming a new build argument: a secret added to the FINAL stage of a public
image is world-readable.

If the repository is ever made private, the packages inherit that visibility
and pulls then require authentication. In that case, and only then:

1. Verify the Railway account is on a **Pro** plan. Railway documents
   authenticated private registries as a Pro feature, and the available
   API/CLI account shape does not expose the plan tier, so treat it as a
   prerequisite to verify rather than an assumption.
2. Create a **new** GitHub PAT with `read:packages` only. Never reuse a
   developer or CI token; in particular never reuse one carrying
   `write:packages`, `delete:packages`, `repo`, `admin:org`, or `delete_repo`.
3. Configure `ghcr.io` under **Settings → Source → Registry Credentials** for
   each of the seven services, saving the credential without changing the
   service source.

## Deploy by digest

Prerequisites:

- `gh` is authenticated to read Actions artifacts from
  `kodes-agency/reputation-key`;
- `railway` is authenticated to project
  `91ab4b88-25a1-404c-9961-4f2b392e2874`;
- the normal operator-command environment is present (`DATABASE_URL`,
  `OPS_OPERATOR_IDENTITIES`, and the runtime configuration needed by the shared
  operator harness); and
- `origin/main` is current.

Fetch first, then run the report-only command. With no revision argument it uses
the current `origin/main` commit:

```bash
git fetch origin main
pnpm ops:deploy-ci-images --operator "$OPERATOR_ID"
```

The report resolves the exact successful main-push CI run, downloads only
`ci-image-digest-map-<revision>`, validates every image/revision/digest, proves
the revision is an ancestor of `origin/main`, and prints the fixed project,
environment, seven service IDs, current sources, and proposed digest references.
It does not mutate Railway.

After reviewing that output, apply the same default revision with the explicit
live-environment opt-in:

```bash
pnpm ops:deploy-ci-images \
  --operator "$OPERATOR_ID" \
  --reason "deploy the main CI-scanned image digests" \
  --ticket "$CHANGE_TICKET" \
  --live \
  --apply \
  --yes ops:deploy-ci-images
```

To deploy an older still-eligible main revision, put its full SHA immediately
after `ops:deploy-ci-images`. `--apply` without `--live` refuses before reading
or changing a Railway service. The command updates services one at a time in the
order provider Redis, web, worker, Google admission, Google gateway, AI
admission, AI gateway. After each source change it requires a new Railway
deployment at the requested digest, terminal `SUCCESS`, and all configured
replicas running with none crashed. After the fleet settles, both the web
`/api/health/ready` and `/api/health/started` endpoints must return HTTP 200.
A partial failure stops the sequence and reports the services already
settled; rerunning is resumable because an already-healthy target digest is a
no-op.

## Rollback

Prefer rolling the full fleet back to the previous known-good CI revision; this
uses the same audited command and exact digest map:

```bash
pnpm ops:deploy-ci-images <previous-main-sha> \
  --operator "$OPERATOR_ID" \
  --reason "roll back to the previous CI-scanned digest set" \
  --ticket "$CHANGE_TICKET" \
  --live \
  --apply \
  --yes ops:deploy-ci-images
```

For an emergency single-service rollback, use the exact prior reference recorded
in the prior report/deployment evidence:

```bash
railway service source connect \
  --project 91ab4b88-25a1-404c-9961-4f2b392e2874 \
  --environment 4a1eec11-f629-4acc-aa21-b6326fcf97e8 \
  --service <service-id> \
  --image ghcr.io/kodes-agency/repkey-<slug>@sha256:<previous-digest> \
  --json
```

The six services that currently build from GitHub can instead be restored to
the prior source path by running the following command once for each service ID
in the table:

```bash
railway service source connect \
  --project 91ab4b88-25a1-404c-9961-4f2b392e2874 \
  --environment 4a1eec11-f629-4acc-aa21-b6326fcf97e8 \
  --service <service-id> \
  --repo kodes-agency/reputation-key \
  --branch release \
  --json
```

| Service                      | Service ID                             | Pre-cutover rollback source                                                                                         |
| ---------------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `web`                        | `27bbc8e9-c8aa-4104-aa3d-7e8ce9d2071b` | GitHub `release`                                                                                                    |
| `worker`                     | `a667f978-ee3e-4707-9d38-7c23a4f2e4cc` | GitHub `release`                                                                                                    |
| `google-egress-gateway`      | `af50a9d7-5aab-45f5-aa4b-89b0b89f355a` | GitHub `release`                                                                                                    |
| `google-execution-admission` | `20be79ce-7067-4552-bf19-29c0216e6740` | GitHub `release`                                                                                                    |
| `ai-egress-gateway`          | `24c15645-70ed-4144-8e5a-fee2cfdf51c7` | GitHub `release`                                                                                                    |
| `ai-execution-admission`     | `b37bf32a-6d64-4f8b-92af-c03695a1907f` | GitHub `release`                                                                                                    |
| `google-provider-redis`      | `91935481-1aae-4dcd-b0f2-a84b0b3b34f3` | previous digest (before cutover: `redis:7@sha256:595cc6f2bb3af6e03347b90deb6123c6aa2c81dea05ce08128de8a174b6ac67b`) |

After either rollback, poll `railway deployment list` for each changed service
until its new deployment is `SUCCESS`, verify all configured replicas are
running, and require HTTP 200 from both the web `/api/health/ready` and
`/api/health/started` endpoints. Do not move or force-push the `release` branch
as part of a digest rollback.
