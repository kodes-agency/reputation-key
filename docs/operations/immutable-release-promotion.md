# Immutable release build and Railway promotion

Status: implementation landed; first non-production promotion evidence pending  
Owner: Platform/Operations  
Authority: `REG-03` in `docs/comprehensive-beta-implementation-program-2026-08-25.md`

## Safety contract

A RepKey release is one canonical, Sigstore-signed promotion manifest produced
by `.github/workflows/release-images.yml` from a successful `main` CI revision.
It binds:

- the full merged source SHA and producing GitHub workflow identity;
- exact digest-pinned web, worker, Google-sidecar, AI-sidecar, and rollout-only
  Google compatibility images;
- each image's source revision, SLSA provenance, SBOM, vulnerability report,
  and Sigstore signature-bundle digest;
- lockfile and Railway IaC digests, migration head, capability-policy version,
  Data Cell catalogue version, CI evidence, beta evidence, and provider approval
  evidence.

The workflow builds and pushes every image once. Railway receives
`repository@sha256:digest`; neither a mutable tag nor a local checkout is a
release authority. The service variable `RELEASE_SHA`, manifest variable
`RELEASE_MANIFEST_SHA256`, active Railway image digest, and image-baked
`IMAGE_SOURCE_REVISION` describe the same release. `SOURCE_REVISION` and
`IMAGE_SOURCE_REVISION` must not exist as Railway service overrides because
they could mask the identity baked into an image.

Docker BuildKit publishes the SLSA attestation attached to the image, and the
workflow extracts and binds it using Docker's documented provenance inspection
surface. Sigstore bundles retain the signature, certificate, and transparency
log proof. See [Docker provenance attestations](https://docs.docker.com/build/metadata/attestations/slsa-provenance/)
and [Sigstore blob signing](https://docs.sigstore.dev/cosign/signing/signing_with_blobs/).

## One-time prerequisites

Do not dispatch or apply until all of these are true:

1. GitHub `main` protection requires the repository CI workflow, including
   tests, builds, migration checks, action-pin checks, and security gates.
2. The GitHub `release-signing` environment exists with required reviewer
   protection. Only the release workflow may request its OIDC signing token.
3. GHCR packages have controlled visibility and retention. If private, the
   Railway project is on a plan that supports authenticated private registries
   and has read-only pull credentials. Railway documents private-registry
   deployment as a Pro feature: [Private container registry](https://docs.railway.com/guides/private-container-registry).
4. A successful CI run exists for the exact `main` SHA. Record its run ID.
5. The approved beta evidence manifest and Google/provider approval evidence
   are immutable and their lowercase SHA-256 values are recorded.
6. `.railway/railway.ts` has been applied to the target non-production
   `cell-*` environment, the seven serving services exist, and no service has a
   GitHub/local source or legacy source-revision override.
7. The operator workstation has Railway CLI 5.43.3 or newer, Node from
   `.nvmrc`, pnpm, and patched Cosign 3.1.3 or newer. The deploy command refuses
   older Cosign versions.
8. The target cell's backup/PITR preflight is healthy. Until `REG-04` has live
   evidence, this is a blocking manual/platform check rather than a claim made
   by the script.

## Produce the signed release

From GitHub Actions, select **Release Images**, choose the `main` branch, and
provide:

- `ci_run_id` — successful `.github/workflows/ci.yml` run for the selected SHA;
- `beta_evidence_manifest_sha256` — promoted beta-evidence manifest digest;
- `provider_approval_evidence_sha256` — approved provider-evidence digest.

The preflight reads the named CI run, requires the same source SHA, successful
conclusion, and exact CI workflow path, then hashes the run and job outcomes.
The matrix builds seven unique full-SHA GHCR images, generates SBOMs, fails on
High/Critical vulnerability findings, signs and verifies every image, and
captures SLSA provenance. The final job creates and keylessly signs the
canonical manifest. A non-`main` dispatch cannot run.

Download the `promotion-manifest-<sha>` artifact and the seven
`release-image-*` evidence artifacts into the controlled change record. Retain
them together. Verify the checksum before doing anything else:

```bash
sha256sum --check promotion-manifest.json.sha256
MANIFEST_SHA256="$(cut -d' ' -f1 promotion-manifest.json.sha256)"
```

Do not edit or reformat the manifest. Canonical encoding is part of its signed
identity and the parser rejects an equivalent but differently encoded file.

## Dry-run and apply one Data Cell

The same artifacts may be promoted to `us`, `europe`, and `global`; the cell is
always explicit. Start with the isolated non-production mirror and then the
production canary cell approved in the change record.

```bash
pnpm release:beta \
  --manifest promotion-manifest.json \
  --signature-bundle promotion-manifest.sigstore.json \
  --manifest-sha256 "$MANIFEST_SHA256" \
  --cell us
```

Dry-run parses the complete contract and prints the seven exact image references
without invoking Railway or needing application secrets. Review the target
`cell-us`, revision, manifest SHA, images, and order.

For apply, first open the cell-local database tunnel and provide the normal
operator-command environment (`DATABASE_URL`, `OPS_OPERATOR_IDENTITIES`, and
required application configuration). Then run:

```bash
pnpm release:beta \
  --manifest promotion-manifest.json \
  --signature-bundle promotion-manifest.sigstore.json \
  --manifest-sha256 "$MANIFEST_SHA256" \
  --cell us \
  --apply \
  --operator <registered-operator> \
  --reason "<change-record and reason>"
```

Before its first mutation, apply verifies the canonical SHA and Sigstore
identity and reads all seven service environments to reject legacy identity
overrides. It writes only `RELEASE_SHA` and `RELEASE_MANIFEST_SHA256`, with
intermediate deploys disabled, then connects the exact image source.

`web` deploys first and alone because its IaC-owned pre-deploy command is the
single migration authority. It must reach `SUCCESS` before each remaining
service is promoted sequentially. A failed, crashed, removed, skipped, or timed
out deployment stops the release; later services stay on their prior digest.
This is an explicit partial-promotion incident, never a successful rollout.

After settlement, the command requires:

- one expected release SHA and manifest SHA on all seven services;
- no legacy source-revision override;
- every active deployment at the manifest's exact digest and `SUCCESS`;
- `/api/health` with database, Redis, migration, and policy readiness;
- every AI execution-control head enabled and accepting when `DATABASE_URL` is
  available.

There is no unaudited promotion bypass. Emergency releases still require the
normal named operator, reason, durable policy-decision row, and signed-manifest
verification.

## Independent read-back

Re-prove a running cell using the original artifacts:

```bash
pnpm release:beta \
  --manifest promotion-manifest.json \
  --signature-bundle promotion-manifest.sigstore.json \
  --manifest-sha256 "$MANIFEST_SHA256" \
  --cell us \
  --verify-only
```

`--verify-only` does not deploy. Archive its redacted output with the Railway
deployment IDs, remote IaC drift plan, health/journey results, and change
record. Repeat separately for each cell; success in one cell is not evidence
for another.

## Rollback boundary

A rollback target is a previously signed and verified promotion manifest, not
a tag or rebuilt commit. Before attaching its prior digests, prove that the
current database schema and configuration remain backward compatible with
those images. If they are compatible, use the same audited promotion command
with that prior manifest and record the rollback reason.

If a migration removed or reinterpreted data required by the prior images,
image rollback is forbidden. Stop traffic/external effects and use a forward
fix or the `REG-04` isolated PITR/restore-and-cutover procedure. Never reverse
DDL automatically. The rollout-only Google compatibility image is governed by
the separate expand/contract boundary in `runbooks.md` and is never attached to
a serving service.

## Evidence still required before production

The repository implementation does not prove live readiness. Gate E remains
closed until all of the following have real, retained evidence:

- the protected workflow succeeds once for a merged SHA and every package can
  be pulled by Railway;
- the same signed manifest is promoted into every non-production `cell-*`
  environment and exact-digest read-back succeeds;
- migration locking/forward compatibility and prior-manifest rollback are
  rehearsed;
- stale-manifest, mixed-digest, bad-signature, legacy-variable, and partial
  settlement failures are exercised;
- cell-local backup/PITR, isolated restore, recovery fence, critical journeys,
  wrong-cell denial, and one-cell-down behavior pass;
- the redacted remote IaC plan is approved and no legacy Config-as-Code owner
  remains.

Until then the implementation is fail-closed deployment machinery, not a claim
that multi-region production is operational.
