# Immutable release build and Railway promotion

Status: immutable build/promotion core landed; REL-01 completion orchestration and live evidence pending

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
  evidence; and
- `contract.releaseControllerSha256`, the deterministic digest of the local
  release-authority source set.

The workflow builds and pushes every image once. Railway receives
`repository@sha256:digest`; neither a mutable tag nor a local checkout is a
release authority. The service variable `RELEASE_SHA`, manifest variable
`RELEASE_MANIFEST_SHA256`, active Railway image digest, and image-baked
`IMAGE_SOURCE_REVISION` describe the same release. `SOURCE_REVISION` and
`IMAGE_SOURCE_REVISION` must not exist as Railway service overrides because
they could mask the identity baked into an image.

Each promoted role is restricted to its one
`ghcr.io/kodes-agency/repkey-*` repository. Before manifest creation, the
workflow re-hashes every downloaded role SBOM, provenance statement, Sigstore
bundle, and vulnerability report against that role's index. A missing,
substituted, or differently hashed companion artifact blocks signing.

`.railway/railway.ts` is the only service-source owner. It receives an explicit
canonical source map and declares either the one-time source-less foundation or
the manifest's exact digest references. Never use `railway service source
connect`, a dashboard source edit, GitHub source, mutable tag, or local upload
for `reputation-key-us-beta` or `reputation-key-us-beta-rehearsal`. Source
changes use private saved plans applied unchanged. The source-less setup must go
through `pnpm infra:railway:foundation`: it proves the exact project and sole
`cell-us` environment, plus zero pre-existing services, service instances,
buckets, volume instances, and unmerged changes, before planning and again
before applying the reviewed plan SHA-256. It accepts only the frozen exact
16-create graph, verifies all apply operations, and proves the complete
source-less readback followed by a fresh exact no-drift plan against the frozen
placement/configuration graph. It also independently checks the saved plan's exact
`.railway` source-tree identity. The proof rejects environment-scoped
`RAILWAY_TOKEN` and requires a logged-in user or account/workspace-scoped
`RAILWAY_API_TOKEN`. Candidate planning, migration, domain registration, and
serving promotion enforce the same credential rule before their first Railway
call because each depends on full-project isolation.
If foundation apply returns ambiguously, its explicit verify mode does not
repeat the create: it reproduces the same exact resource inventory and fresh
read-only source-less no-drift proof required after an ordinary successful
apply.
Revalidate
this procedure
against Railway's [Infrastructure as Code documentation](https://docs.railway.com/infrastructure-as-code)
and [official CLI release](https://github.com/railwayapp/cli) before the live
change.

Opaque Railway project and environment IDs remain mandatory, but an ID-pinned
IaC evaluation may omit the human-readable project name. The foundation
controller therefore derives and injects the reviewed exact name:
`reputation-key-us-beta-rehearsal` for `rehearsal`, or
`reputation-key-us-beta` for `production`, then proves the remote inventory has
that name before either command. The release planning controller likewise reads
the linked target first and passes that reviewed name alongside the IDs. IaC
refuses a name that conflicts with Railway's evaluation context or with the
selected deployment profile.

Reviewed IaC is necessary but not sufficient: the local controller chooses the
target, validates evidence, invokes Cosign, enters the operator audit path, and
applies the graph. Manifest v4 signs its explicit authority set—`.railway`,
package/lock/toolchain inputs, all release scripts, the operator-command entry
point, Identity, Property, and Team authority, and shared policy/runtime code—as
`contract.releaseControllerSha256`. Railway plan evidence v5 copies it to
`release.controllerSha256`; bootstrap authorization v2 records the same signed
digest in its release record.

The planner and both controllers recompute this digest and fail before Cosign,
Railway, or audit actions if signed, retained, and local values differ. The
migration and serving controllers recheck after Cosign; serving promotion
checks again immediately before dynamically importing the operator authority.
Any covered local edit requires a newly built/signed manifest and new plan,
even if the IaC digest did not change.

Docker BuildKit publishes the SLSA attestation attached to the image, and the
workflow extracts and binds it using Docker's documented provenance inspection
surface. Sigstore bundles retain the signature, certificate, and transparency
log proof. See [Docker provenance attestations](https://docs.docker.com/build/metadata/attestations/slsa-provenance/)
and [Sigstore blob signing](https://docs.sigstore.dev/cosign/signing/signing_with_blobs/).

The release workflow uses the fixed `ubuntu-24.04` runner label, Docker
29.7.2, Buildx 0.32.1, and BuildKit 0.30.0 from the digest-pinned
`moby/buildkit` image. Each matrix role records the actual GitHub runner image
revision plus those tool versions. Manifest creation refuses split runner
revisions or any tool mismatch and signs the common observation plus the
digest of all eight build-metadata files. `ubuntu-24.04` still receives
GitHub-managed image updates; the observed `ImageVersion` is therefore part of
candidate identity rather than an unstated mutable input.

## Release prerequisites

The candidate-migration stage requires items 1–6 and 8–10 below. On the first
rollout, item 7 is deliberately impossible until that stage has installed
migration `0140`; it becomes mandatory before any serving `release:beta` apply
or verification. Do not collapse the two stages or treat a signed manifest as
permission to serve before item 7 is complete.

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
   are immutable and their lowercase SHA-256 values are recorded. A prepared
   Google Content re-signing bundle is not installed approval evidence. If the
   production candidate needs a new approval version, retain the reviewed
   `infra:railway:google-content-approval` intent and SHA-256, successful apply
   or recover audit decision, and final verify output. Run that ceremony only
   after the source-less production foundation and target database exist and
   before serving sources are attached. Do not install rows or copy either
   shared value manually.
6. The source-less `.railway/railway.ts` foundation has been applied once to
   dedicated project `reputation-key-us-beta-rehearsal` and environment
   `cell-us` through `infra:railway:foundation`, with both live-isolation
   preflights and the reviewed plan SHA-256 retained. It is the project's only
   environment. The seven serving services and non-serving one-shot
   `schema-migrator` each have exactly one source-less instance there, alongside
   exactly three managed databases, three database volumes, and one object
   bucket; no service has another source owner or legacy source-revision
   override. Production repeats this in dedicated project
   `reputation-key-us-beta`, then registers `us.reputationkey.app` with the
   reviewed `infra:railway:domain` ceremony. That ceremony creates
   and returns the Railway probe origin first, supports exact-state recovery,
   and requires a later verify pass for ACTIVE sync, DNS ownership, a valid
   certificate, and the exact retained `web` custom-domain graph on port 8080.
   Every domain mode first proves the full California source-less foundation is
   no-drift. Railway does not support creating that custom domain through
   IaC; the first promotion graph must retain the exact registered hostname
   without a domain diagnostic.
7. The bounded `single-us-beta-v3` database cutover is completed and its
   canonical evidence artifact is retained. Migration `0140` only installs the
   coordination/fence authority; it does not perform a deploy-time bulk update.
8. A retained full-candidate Railway plan for the explicit `production` or
   `rehearsal` profile names the exact linked project and `cell-us` environment
   IDs and is bound to the promotion-manifest digest. The controller passes
   that reviewed project name alongside the opaque IDs; any disagreement with
   Railway's context or the profile's required exact name blocks. Its IaC
   digest must match the signed manifest, and its
   `release.controllerSha256` must match the manifest's
   `contract.releaseControllerSha256` and the recomputed local controller
   digest. Either a no-drift (`0`) or reviewed pending (`2`) outcome is valid at
   this stage; all other exits block.
   Railway includes the canonical evaluated IaC path in its JSON, so promotion
   must run from the same controlled checkout path used to capture this
   byte-bound evidence. A moved checkout requires recapture and review.
9. The operator workstation has Railway CLI exactly 5.45.2 for the one-time
   foundation/domain ceremonies (their JSON contracts are version-pinned), and
   5.45.2 or newer for ordinary promotion; Node comes from `.nvmrc`, with pnpm
   and patched Cosign 3.1.3 or newer. The commands refuse incompatible
   Railway/Cosign versions.
10. The target cell's backup/PITR preflight is healthy. Until `REG-04` has live
    evidence, this is a blocking manual/platform check rather than a claim made
    by the script.

### Activate a required Google Content approval

For the initial production `cell-us` activation, follow the exact ceremony in
`railway-data-cells.md` before the signed serving promotion. The preparation
signer emits all four private bundles and the complete public-key file; it never
installs them. The activation controller requires one reviewed mode-0600 intent,
the exact production project/environment IDs, Railway CLI 5.45.2, full-project
visibility, all four Google Content capabilities killed, and zero active or
cleanup work.

Apply/recover installs and re-reads missing exact approval candidates before
one Railway edit containing only the complete runtime-binding and public-key
shared variables. It verifies the entire configuration and proves unrelated
configuration unchanged. Because each insertion advances the global policy
version, the complete drain is mandatory and existing permits are intentionally
fenced; retained exact-runtime rows support old/new process lookup but are not
an uninterrupted-permit promise. A final read-only `verify` must pass before
`release:beta` may attach or start serving sources. If apply exits ambiguously,
use `recover` with the same intent bytes and SHA-256; never create a replacement
intent to conceal partial state.

## Produce the signed release

From GitHub Actions, select **Release Images**, choose the `main` branch, and
provide:

- `ci_run_id` — successful `.github/workflows/ci.yml` run for the selected SHA;
- `beta_evidence_manifest_sha256` — promoted beta-evidence manifest digest;
- `provider_approval_evidence_sha256` — approved provider-evidence digest.

The preflight reads the named CI run, requires the same source SHA, successful
conclusion, and exact CI workflow path. It also requires the supplied beta
evidence digest to name at least one non-expired
`beta-local-smoke-<digest>` artifact produced by that exact run, and includes
the matching artifact identity in the hashed CI evidence. It downloads that
one artifact, requires exactly one smoke manifest checksum, and re-hashes the
manifest bytes before accepting the supplied digest. A syntactically valid
caller-supplied digest, a duplicate artifact identity, or an artifact whose
content does not match its digest cannot enter the signed manifest.
The matrix builds eight unique full-SHA GHCR images, generates SBOMs, fails on
High/Critical vulnerability findings, signs and verifies every image, and
captures SLSA provenance. The final job creates and keylessly signs the
canonical manifest. A non-`main` dispatch cannot run.

Download the `promotion-manifest-<sha>` artifact and the eight
`release-image-*` evidence artifacts into the controlled change record. Retain
them together. Verify the checksum before doing anything else:

```bash
sha256sum --check promotion-manifest.json.sha256
MANIFEST_SHA256="$(cut -d' ' -f1 promotion-manifest.json.sha256)"
```

Do not edit or reformat the manifest. Canonical encoding is part of its signed
identity and the parser rejects an equivalent but differently encoded file.

## Migrate every signed candidate

This stage breaks the first-rollout dependency deliberately: migration `0140`
must exist before the Data Cell cutover can produce the evidence required by
`release:beta`. It is also the mandatory migration authority for every later
signed candidate. It is not a manual migration and never executes a
working-tree build. After the one-time source-less foundation, capture a fresh
full-candidate plan for the reviewed exact project name, opaque
project/environment IDs, and manifest:

```bash
RAILWAY_PLAN_EVIDENCE="docs/release-evidence/beta/<release-id>/raw/cell-us-plan.json"
pnpm infra:railway:plan-cell \
  --cell=us \
  --deployment-profile=production \
  --manifest=promotion-manifest.json \
  --manifest-sha256="$MANIFEST_SHA256" \
  --evidence-out="$RAILWAY_PLAN_EVIDENCE"
RAILWAY_PLAN_EVIDENCE_SHA256="$(cut -d' ' -f1 "$RAILWAY_PLAN_EVIDENCE.sha256")"
```

Dry-run the signed migration job:

```bash
pnpm release:migrate-cell \
  --manifest promotion-manifest.json \
  --signature-bundle promotion-manifest.sigstore.json \
  --manifest-sha256 "$MANIFEST_SHA256" \
  --railway-plan-evidence "$RAILWAY_PLAN_EVIDENCE" \
  --railway-plan-evidence-sha256 "$RAILWAY_PLAN_EVIDENCE_SHA256" \
  --cell us
```

Review the signed web-image digest, exact project name, and opaque target IDs.
Choose a new retained authorization-evidence path, provide
`OPS_OPERATOR_IDENTITIES`, and add:

```bash
  --apply \
  --operator <registered-operator> \
  --reason "<change-record and candidate-migration reason>" \
  --audit-evidence docs/release-evidence/beta/<release-id>/raw/candidate-migration-authorization.json
```

Apply verifies the canonical manifest/digest and Sigstore bundle, rejects stale
or mismatched plan evidence, pins every Railway command to the reviewed exact
project name plus opaque project/environment IDs, and proves `cell-us` is the
project's only environment and all eight managed services have exactly one
instance there. It creates a
private saved plan that changes only
`schema-migrator` to the manifest's exact web image, validates that
non-destructive change, and applies that same plan. Railway must report the
one-shot restart-`NEVER` deployment as `SUCCESS` with the same image digest.
On the first rollout the image then binds `0140`'s open control row to
Railway's built-in IDs; only after this succeeds may the Data Cell cutover
below begin. The job has no domain or serving credentials and is part of the
same `cell-us`, not another Data Cell.

The target database can be empty at this point, so bootstrap authorization does
not use its not-yet-created `policy_decision_audit` table. Before any Railway
command, the existing operator harness validates the named operator and reason,
then exclusively creates the canonical `--audit-evidence` artifact plus its
SHA-256 sidecar. Retain both with the manifest and plan; an existing path blocks
the run. Version 2 of that authorization also records the signed controller
digest. This exception is limited to the migration controller:
`release:beta` keeps its normal database-backed durable decision row unchanged.
Use a new authorization artifact for every candidate.

On the first rollout, after the signed migration, connect `DATABASE_URL` to that
cell and create its people-authority cutover artifact. Report first, resolve
every anomaly, then apply. The apply command refuses to overwrite an existing
path and emits no passing artifact unless every supported People/Portal
relationship is visible through the canonical effective-dated model. Retained
Team relationships are opaque quarantine evidence and are neither mapped nor
written:

```bash
PEOPLE_EVIDENCE="docs/release-evidence/beta/<release-id>/raw/people-cutover-us.json"
pnpm ops:reconcile-people-team --operator <registered-operator>
pnpm ops:reconcile-people-team \
  --operator <registered-operator> \
  --reason "<change-record and reconciliation reason>" \
  --apply \
  --evidence "$PEOPLE_EVIDENCE"
```

Beta produces one global artifact against the `cell-us` database. An
organization-scoped artifact is useful for repair but cannot authorize a
release. The artifact contains counts, a source fingerprint, and the named
operator/correlation identifiers—no names, review content, or feedback. A
future approved cell must produce its own artifact before activation. Evidence
version 2 removes legacy Team-membership parity; version 1 artifacts are refused
and must be regenerated from the current database and reviewed operator command.

Complete the one-time, report-first Data Cell transition before promotion. Each
apply invocation consumes the exact digest printed by the preceding report and
processes at most one bounded batch. Repeat with the newly printed digest until
the state reaches `completed`; provide the evidence path only on that final
completion/read-back invocation:

```bash
DATA_CELL_EVIDENCE="docs/release-evidence/beta/<release-id>/raw/single-us-data-cell-cutover.json"
pnpm ops:cutover-single-us-data-cell --operator <registered-operator>
pnpm ops:cutover-single-us-data-cell \
  <reviewed-verify-report-sha256> \
  "$DATA_CELL_EVIDENCE" \
  --operator <registered-operator> \
  --ticket <change-record> \
  --reason "<reviewed single-US cutover step>" \
  --batch-size 100 \
  --apply \
  --yes ops:cutover-single-us-data-cell
DATA_CELL_EVIDENCE_SHA256="$(shasum -a 256 "$DATA_CELL_EVIDENCE" | cut -d' ' -f1)"
```

If the command reports another bounded phase instead of completion, omit the
evidence path, review the new report, and repeat. Never automate acceptance of
the changing report digest. The fence remains active across interruptions and
refuses new conflicting Property, credential-home, import, permit, cleanup,
and Region Move admissions. See `railway-data-cells.md` for blockers and
recovery semantics.

After `schema-migrator` succeeds, recapture the intended Railway
project/environment's full-candidate plan before serving promotion. The
profile is explicit: production must be project
`reputation-key-us-beta`; rehearsal must be project
`reputation-key-us-beta-rehearsal` and owns no production domain.

```bash
RAILWAY_PLAN_EVIDENCE="docs/release-evidence/beta/<release-id>/raw/cell-us-serving-plan.json"
pnpm infra:railway:plan-cell \
  --cell=us \
  --deployment-profile=production \
  --manifest=promotion-manifest.json \
  --manifest-sha256="$MANIFEST_SHA256" \
  --evidence-out="$RAILWAY_PLAN_EVIDENCE"
RAILWAY_PLAN_EVIDENCE_SHA256="$(cut -d' ' -f1 "$RAILWAY_PLAN_EVIDENCE.sha256")"
```

Review the exact raw artifact. Exit `0` means every service already matches the
candidate. Exit `2` is the normal first-promotion state: serving source changes
are pending and may authorize `release:beta` only when the live rerun has the
same target, digest, raw hash, and outcome. Any destructive or unrelated change
blocks.

## Dry-run and apply one Data Cell

Beta manifests name only `us`, and the deployer refuses dormant future cells.
Start with the isolated single-cell non-production mirror and then the
production `cell-us` canary approved in the change record.

```bash
pnpm release:beta \
  --manifest promotion-manifest.json \
  --signature-bundle promotion-manifest.sigstore.json \
  --manifest-sha256 "$MANIFEST_SHA256" \
  --people-cutover-evidence "$PEOPLE_EVIDENCE" \
  --data-cell-cutover-evidence "$DATA_CELL_EVIDENCE" \
  --data-cell-cutover-evidence-sha256 "$DATA_CELL_EVIDENCE_SHA256" \
  --railway-plan-evidence "$RAILWAY_PLAN_EVIDENCE" \
  --railway-plan-evidence-sha256 "$RAILWAY_PLAN_EVIDENCE_SHA256" \
  --cell us
```

Dry-run parses the complete retained contract and prints the seven serving
image references without invoking Railway or needing application secrets. It
does not claim live cutover or target verification; those read-backs occur on
apply/verify-only. Review the profile, exact project name, opaque
project/environment IDs, `cell-us`, revision, artifact digests, images, and
order.

For `rehearsal`, the retained plan selects that profile and every release
invocation must add its explicit non-production `--app-url`; the production
host is refused. Production authentication remains pinned to
`https://us.reputationkey.app`, but before DNS cutover `--app-url` may point the
health probe at the service's separate Railway HTTPS origin returned by the
reviewed production domain ceremony.

For apply, first open the `cell-us` database tunnel and provide the normal
operator-command environment (`DATABASE_URL`, `PROCESSING_CELL=us`,
`OPS_OPERATOR_IDENTITIES`, and required application configuration). Confirm the
Railway target is environment `cell-us`; the logical application value remains
`us`. Then run:

```bash
pnpm release:beta \
  --manifest promotion-manifest.json \
  --signature-bundle promotion-manifest.sigstore.json \
  --manifest-sha256 "$MANIFEST_SHA256" \
  --people-cutover-evidence "$PEOPLE_EVIDENCE" \
  --data-cell-cutover-evidence "$DATA_CELL_EVIDENCE" \
  --data-cell-cutover-evidence-sha256 "$DATA_CELL_EVIDENCE_SHA256" \
  --railway-plan-evidence "$RAILWAY_PLAN_EVIDENCE" \
  --railway-plan-evidence-sha256 "$RAILWAY_PLAN_EVIDENCE_SHA256" \
  --cell us \
  --apply \
  --operator <registered-operator> \
  --reason "<change-record and reason>"
```

Before its first Railway mutation, apply checks the canonical evidence digests,
verifies the signed manifest and exact retained full-candidate plan, proves that
the manifest's controller digest equals plan evidence and the recomputed local
release authority, and proves that
the currently linked Railway project/environment names and IDs equal the
reviewed target, and binds the Data Cell artifact to a freshly locked live
`us`/policy-3 topology read-back. It inventories the whole dedicated project
and refuses an additional environment or a missing/duplicate instance for any
of the eight source-managed services. Inside the audited path it repeats that topology
check, recomputes global people-authority parity, requires the matching
artifact, and rejects legacy identity overrides. It writes only `RELEASE_SHA`
and `RELEASE_MANIFEST_SHA256`, with intermediate deploys disabled.

The controller advances the canonical source map one service at a time. For
each service it saves a private IaC plan, proves that the plan changes exactly
that non-destructive source, applies that same plan, and waits for the manifest
digest to reach `SUCCESS`. The ephemeral provider Redis image settles first.
`web` then deploys alone because its IaC-owned pre-deploy command rechecks the
already-migrated schema through the same idempotent signed binary. A failed,
crashed, removed, skipped, or timed-out deployment stops the release; later
services stay on their prior digest. If a source already matches and Railway
creates no deployment, the controller permits one bounded explicit redeploy of
that exact IaC-owned source. This is an explicit partial-promotion incident,
never a successful rollout. `railway service source connect` is never used.

After settlement, the command requires:

- one expected release SHA and manifest SHA on all seven services;
- no legacy source-revision override;
- every active deployment at the manifest's exact digest and `SUCCESS`;
- `/api/health` with database, Redis, migration, and policy readiness;
- live completed Data Cell state still matching the retained evidence, with no
  Property or credential-home topology drift;
- current global people-authority parity matching the audited artifact;
- every AI execution-control head enabled and accepting when `DATABASE_URL` is
  available.

The final full-candidate plan must be no-drift. Retain a new immutable
no-drift plan artifact after the apply; use that artifact for independent
`--verify-only` read-back:

```bash
RAILWAY_PLAN_EVIDENCE="docs/release-evidence/beta/<release-id>/raw/cell-us-post-apply-plan.json"
pnpm infra:railway:plan-cell \
  --cell=us \
  --deployment-profile=production \
  --manifest=promotion-manifest.json \
  --manifest-sha256="$MANIFEST_SHA256" \
  --evidence-out="$RAILWAY_PLAN_EVIDENCE"
RAILWAY_PLAN_EVIDENCE_SHA256="$(cut -d' ' -f1 "$RAILWAY_PLAN_EVIDENCE.sha256")"
```

Exit `0` is mandatory here. Do not reuse the pre-apply pending-plan artifact for
verification.

There is no unaudited promotion bypass. Emergency releases still require the
normal named operator, reason, durable policy-decision row, and signed-manifest
verification.

## Independent read-back

Re-prove a running cell using the original signed/cutover artifacts and the
post-apply no-drift plan artifact:

```bash
pnpm release:beta \
  --manifest promotion-manifest.json \
  --signature-bundle promotion-manifest.sigstore.json \
  --manifest-sha256 "$MANIFEST_SHA256" \
  --people-cutover-evidence "$PEOPLE_EVIDENCE" \
  --data-cell-cutover-evidence "$DATA_CELL_EVIDENCE" \
  --data-cell-cutover-evidence-sha256 "$DATA_CELL_EVIDENCE_SHA256" \
  --railway-plan-evidence "$RAILWAY_PLAN_EVIDENCE" \
  --railway-plan-evidence-sha256 "$RAILWAY_PLAN_EVIDENCE_SHA256" \
  --cell us \
  --verify-only
```

`--verify-only` does not deploy. It requires the retained full-candidate plan to
still be no-drift. Archive its redacted output with the Railway deployment IDs,
remote IaC plan, health/journey results, and change record. This is the complete
beta read-back. A future approved cell must pass its own independent read-back
before activation.

## Join the Gate F evidence

After every REL-01 proof has been produced against the same immutable candidate,
create a canonical `gate-f-index.json` under that candidate's evidence root and
run:

```bash
pnpm release:validate-evidence -- \
  --gate-f-index=docs/release-evidence/beta/<release-id>/gate-f-index.json \
  --evidence-root=docs/release-evidence/beta/<release-id>
```

The strict contract and required gate identifiers live in
`src/shared/release/gate-f-evidence.ts`. The validator re-hashes every referenced
artifact, including the retained Sigstore bundle, parses the exact promotion
manifest, enforces the single production
`cell-us` target and source SHA, requires zero protected reachable High
findings, and requires the exact approval/cohort join. Counsel and founder must
bind both the promotion-manifest digest and the digest of the exact legal
revision set. Approvals must follow final decision evidence; completion must
follow the retained approval artifacts.

This is validation, not evidence production or identity authentication. A
passing local `beta-local-1` bundle, successful deployment, self-entered role
name, or placeholder file cannot establish a live Railway/provider/backup/legal
fact. Retain the validated index digest with the change record and keep Gate F
closed until every referenced artifact and approval is real.

For the three live promotion gates, the first referenced file has a strict
candidate-bound contract rather than an arbitrary attachment:

- deployed journeys use `repkey-deployed-critical-journeys-1` and the dedicated
  deployed-spec identity; the schema requires an approved synthetic
  Organization, exactly one attempt, zero retries, exact authorized test order,
  completed cleanup, and content-safe network/redaction results;
- the canary uses `repkey-canary-window-1` with an approved
  `repkey-canary-threshold-profile-1`; every approved signal reconciles
  expected, observed, and missing samples, and any missing/breached sample,
  observer read error, release drift, or configuration drift prevents pass; and
- recovery uses `repkey-recovery-rehearsal-1`, which distinguishes a compatible
  prior-manifest image rollback from an incompatible-data isolated restore.
  The latter binds its sibling Postgres, three fresh Redis identities,
  recovery generation, RPO/RTO, routing cutover/rollback read-backs and forward
  recovery. Reverse DDL is structurally forbidden.

The schemas and final validator do not run these operations. The safe deployed
runner, external/platform canary observer, and report-first recovery
orchestrator must still produce the real artifacts; missing producers are a
closed gate, not permission to hand-author a passing result. Every dependency
digest named inside a typed summary must also be retained and byte-verified as
a sibling reference under that same Gate F gate.

## Rollback boundary

A rollback target is a previously signed and verified promotion manifest, not
a tag or rebuilt commit. Before attaching its prior digests, prove that the
current database schema and configuration remain backward compatible with
those images. If they are compatible, create and review the prior manifest's
full-candidate plan, run its signed migration authority, and use the same
staged audited promotion command with a recorded rollback reason.

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
- both dedicated projects pass the full-project service-instance isolation
  check, with no managed service instance outside `cell-us`;
- the signed manifest is promoted into non-production `cell-us` and
  exact-digest read-back succeeds;
- migration locking/forward compatibility and prior-manifest rollback are
  rehearsed;
- stale-manifest, mixed-digest, bad-signature, legacy-variable, and partial
  settlement failures are exercised;
- `cell-us` backup/PITR, isolated restore, recovery fence, critical journeys,
  and dormant-cell denial pass;
- the redacted remote IaC plan is approved and no legacy Config-as-Code owner
  remains.

Until then the implementation is fail-closed deployment machinery, not a claim
that the single-US beta production topology is operational.
