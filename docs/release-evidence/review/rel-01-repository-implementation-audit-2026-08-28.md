# REL-01 repository implementation audit — 2026-08-28

Status: **repository implementation remains incomplete; no live-readiness claim**

Scope: repository-owned REL-01 release machinery only

Authority: `docs/comprehensive-beta-implementation-program-2026-08-25.md` §11,
REL-01 and Gate F

Live actions performed: **none**

## Executive conclusion

The immutable single-US Railway promotion core is substantial and internally
consistent. The repository has fail-closed primitives for one `us` Data Cell,
two isolated deployment profiles (rehearsal and production), source-less
Railway foundation, production domain registration, Google Content approval
activation, exact-digest migration, staged serving promotion, independent
read-back, and dormant-cell denial. Those primitives are covered by a strong
focused test suite.

REL-01 is not locally complete, however. The release builder gap found by this
audit is now closed: the runner label, Docker, Buildx and BuildKit are pinned,
the BuildKit image is digest-bound, and the observed runner image revision plus
all eight release-metadata bytes are signed into promotion manifest v4. The
repository also now has strict candidate-bound result contracts for deployed
journeys, canary observation and both recovery paths, and Gate F parses those
artifacts instead of accepting generic “passed” files. It still lacks the safe
live producers/orchestration that create those results, the agreed canary
duration, live-provider and telemetry-content producers, and authenticated
human approval authority. The validator intentionally cannot manufacture any
of those proofs.

No candidate has been designated or verified by this audit. No Railway,
GitHub, GHCR, DNS, Google, monitoring, backup, legal, or cohort state was read
or changed.

## Scope and status boundaries

This audit keeps three kinds of completion separate:

| Boundary                                | Meaning                                                                                                                                        | Status                                            |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| Repository implementation               | Code, workflow, schema, tests, and runbooks required to perform and validate REL-01                                                            | **Incomplete** for the exact gaps below           |
| Candidate-bound repository verification | A clean merged `main` SHA runs the implemented gates and produces the exact artifacts                                                          | **Not performed**; no candidate was selected      |
| External/live gates                     | GitHub protection, GHCR access, Railway resources, DNS, backups, live providers, monitoring, counsel/operating approvals, and cohort readiness | **Not assessed and not satisfied by local tests** |

## REL-01 traceability

| REL-01 requirement                             | Repository mechanism                                                                                                                | Repository assessment                                                                    | Candidate/live assessment               |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | --------------------------------------- |
| Merged `main` candidate after Gates B–D        | `.github/workflows/ci.yml`; exact selected-run preflight in `release-images.yml`                                                    | Broad gate coverage exists; release builder toolchain is exact-pinned and manifest-bound | No candidate run reviewed               |
| Build/publish/sign images once                 | `release-images.yml`; canonical promotion manifest; exact role repositories; Sigstore, provenance, SBOM and vulnerability artifacts | Implemented and fail-closed at manifest creation                                         | Workflow not run; GHCR pull not proved  |
| Independent high-risk review                   | Gate F gate `candidate.independent_review`                                                                                          | Digest-bound evidence is required, but no authenticated review producer exists           | Review not performed                    |
| Defect disposition/no reachable protected High | Gate F gate plus exact `protectedReachableHighCount: 0` and finding-register reference                                              | Final join is enforced                                                                   | Current candidate register not supplied |
| Exact clean CI gates/no retry-to-green         | CI jobs; selected CI `run_attempt == 1`; release attempt `1`; promotion schema literal attempt `1`                                  | Gate inventory is strong; release runner observation and builder versions are bound      | Exact clean run not supplied            |
| Isolated restore and migration                 | restore preflight/verify surfaces and runbooks                                                                                      | Application-side primitives exist; no REL-01 rehearsal orchestrator/evidence producer    | Railway PITR/restore not performed      |
| Provider-stub journeys                         | local beta smoke/provider sandbox                                                                                                   | Implemented locally                                                                      | Candidate evidence not supplied         |
| Authorized live-provider matrix                | Operational/provider runbooks and Gate F reference                                                                                  | No bounded release evidence producer for the required live matrix                        | Not performed                           |
| Portal/privacy and manager journeys            | local critical browser journeys; Gate F references                                                                                  | Local evidence path exists; deployed-target runner is missing                            | Not performed against Railway           |
| Telemetry prohibited-content inspection        | observability controls and Gate F reference                                                                                         | No candidate-bound inspection artifact producer                                          | Not performed against live telemetry    |
| Railway no-drift and one-cell isolation        | foundation, plan, domain, project-isolation and staged-source controllers                                                           | Implemented for exact production/rehearsal projects and sole `cell-us`                   | Live plans/read-backs absent            |
| Backup/PITR health                             | platform-owned runbook and Gate F reference                                                                                         | Correctly not self-reported by the app; no normalized receipt importer                   | External provider proof absent          |
| Migration integrity and exact digest promotion | schema migrator, deploy controller, signed controller digest, post-apply no-drift plan                                              | Implemented                                                                              | No candidate migration/promotion        |
| Deployed critical journeys                     | local-only runner plus strict `repkey-deployed-critical-journeys-1` result contract                                                 | Contract/validation implemented; **safe deployed runner remains missing**                | Not performed                           |
| Canary window and thresholds                   | strict profile/result contract plus Gate F typed validation                                                                         | Missing agreed duration and executable external/platform observer                        | Not observed                            |
| Restore/rollback evidence                      | immutable boundary plus distinct typed compatible-rollback/incompatible-restore results                                             | Canonical result implemented; **end-to-end report-first orchestration remains missing**  | Not rehearsed                           |
| Europe/Global denied                           | one-cell catalogue, tuple manifest, deploy/plan refusal                                                                             | Implemented                                                                              | Live denial proof absent                |
| Legal/operating approvals and cohort           | new Gate F index, legal-revision digest binding, six exact roles, pseudonymized design-partner record and named owners              | Byte-bound join implemented; signer authority/legal semantics remain external            | Approvals/cohort absent                 |

## Defects corrected during this audit

### 1. Image companion evidence could be substituted after indexing

`create-promotion-manifest.ts` previously trusted the four digest strings in
each role JSON without hashing the downloaded SBOM, provenance, Sigstore bundle,
and vulnerability report. Manifest creation now re-hashes all four artifacts
for all eight roles and stops on a missing or changed byte. A tamper regression
test covers the boundary.

### 2. A valid-looking image repository could point at unrelated bytes

The promotion schema previously accepted any repository matching an allowed
registry syntax. It now maps each promoted role to its one workflow-owned
`ghcr.io/kodes-agency/repkey-*` repository. A role cannot redirect to a
different GHCR owner or sibling repository even when its digest is well formed.

### 3. Caller-supplied beta evidence was not sufficiently bound to selected CI

The release preflight now requires one non-expired artifact with the exact
`beta-local-smoke-<manifest-digest>` name from the selected exact CI run,
downloads that artifact, requires one manifest checksum, and re-hashes the
manifest bytes. Artifact identity is included in hashed CI evidence. Merely
entering a syntactically valid digest no longer works.

### 4. Retry-to-green was not encoded in the immutable manifest contract

Both the selected CI run and the release workflow must be attempt `1`, and the
promotion manifest schema now accepts only literal `runAttempt: 1`. The schema
therefore rejects an otherwise valid signed retry attempt instead of relying
only on workflow convention.

### 5. No exact machine-readable REL-01/Gate F evidence join existed

`src/shared/release/gate-f-evidence.ts` now defines a canonical, strict,
single-US completion index. It requires all 18 REL-01 evidence classes in
canonical order, the promotion manifest and retained signature bundle, zero
protected reachable High findings, the full finding register, six exact
approval roles, and one pseudonymized design-partner cohort with named support
and incident owners. Every reference is SHA-256 bound and re-hashed by the
validator.

Counsel and founder must bind both the promotion-manifest digest and one exact
legal-revision-set digest. Approvals must postdate final decision evidence, and
completion must postdate the retained approval artifacts. The CLI resolves all
references inside one declared evidence root and rejects path/symlink escape.

### 6. Local candidate evidence was described too broadly

Current docs and source comments now say explicitly that `beta-local-1` is
candidate evidence, not Gate F and not permission to open the external beta.
Railway, backup/PITR/restore, live-provider, deployed-journey, canary, legal,
operating, and cohort facts remain mandatory.

### 7. Release builds depended on mutable runner tooling

The release workflow now uses `ubuntu-24.04`, installs exact Docker and Buildx
versions through SHA-pinned actions, and starts a digest-pinned BuildKit image.
The workflow stops if the runner OS/architecture, Docker client/server, Buildx,
or BuildKit version differs. Every role emits `repkey-image-provenance-2`; the
manifest creator requires one identical observation across all eight roles and
binds the observed GitHub runner image revision plus the hash of all eight
metadata files into `repkey-promotion-manifest-4`. Policy tests reject
`ubuntu-latest`, a raw unpinned builder, or toolchain drift.

### 8. Gate F accepted opaque placeholders for three live promotion proofs

`promotion.deployed_critical_journeys`, `promotion.canary_window`, and
`promotion.restore_rollback` now require canonical typed first artifacts. Each
binds the exact manifest, release SHA, sole production `cell-us` target and app
origin. The schemas reject retries, missing samples, threshold breaches,
cleanup/redaction failures, candidate drift, reverse DDL, same-database
“restore”, duplicate Redis identities, missed RPO/RTO, and unsafe/data-loss
outcomes. Every nested dependency digest must also resolve to a byte-verified
sibling Gate F reference. This is validation machinery only; it does not claim
the runs exist.

## Exact remaining repository gaps

These are implementation gaps, not requests to perform live deployment.

### R1 — Freeze or bind the release build toolchain (**closed locally**)

The release builder now uses the exact policy described in corrected finding 7. Candidate-bound execution remains required: a protected workflow must prove
that those exact installations work on the selected merged SHA. Scanner and
browser versions remain captured by their owning existing artifacts; the
builder identity is carried by promotion manifest v4.

### R2 — Add a safe deployed critical-journey runner (blocking)

`scripts/beta/run-product-journeys.ts` always starts the local beta Compose
stack and reads `.local-stack/beta/stack.env`. It cannot prove the mandatory
journeys against the promoted Railway origin.

Required closure: a separate no-retry command for the production/rehearsal
origin that is pinned to release SHA/manifest/cell, uses only the approved
synthetic Organization, records exact browser/project/test identities and
redacted results, refuses arbitrary customer targets, writes once, and has
cleanup/partial-failure semantics. Do not overload the local runner in a way
that makes local and deployed evidence indistinguishable.

The result contract and Gate F binding are now implemented. The missing work is
the deliberately separate safe spec/runner and its write-once producer; the
existing mutating local seed suite must not be pointed at production.

### R3 — Make the canary window executable (blocking)

The repository documents signals and runbooks but has no one command that
defines the REL-01 observation duration, samples the agreed health/error/queue/
provider/latency/privacy thresholds, records missing samples, and emits a
candidate-bound canonical pass/fail artifact without retries.

Required closure: version the threshold profile, sample from external and
platform authorities, treat unavailable data as failure, bind every sample
window to release/cell/config heads, and write the artifact consumed by
`promotion.canary_window`.

The versioned, canonical result/profile contract and fail-closed Gate F parser
now exist. The observation duration was not agreed in repository authority, so
this audit did not invent one. A reviewed duration/threshold decision plus the
actual external/platform sampler remain blocking.

### R4 — Orchestrate rollback/restore rehearsal evidence (blocking)

The rollback boundary is sound: only a prior signed manifest may be promoted,
and incompatible schema requires isolation plus PITR/forward-fix. The new
canonical result combines compatibility decision, prior-manifest plan,
settlement, post-rollback journeys, restore generation, RPO/RTO, and forward
recovery, but no report-first orchestrator produces it from the existing
controllers and external platform steps.

Required closure: add report-first orchestration around existing controllers;
preserve the human review point before mutation; never automate reverse DDL;
and populate the implemented distinct compatible-image-rollback or
incompatible-data-restore result for `promotion.restore_rollback`.

The distinct canonical schemas and Gate F parser now exist. The remaining gap
is orchestration around the existing plan/apply/read-back and restore controls,
including the real human review pause and platform receipts.

### R5 — Normalize the remaining live evidence producers (blocking)

The authorized Google Business Profile matrix, prohibited-content inspection,
backup/PITR provider facts, external availability/sidecar replacement receipts,
and dormant-cell live denial currently rely on prose/manual retention. The Gate
F index can hash their files but cannot verify their minimum fields.

Required closure: small versioned schemas/importers for each evidence class,
with candidate, target, capture time, authority, redaction, pass/fail and expiry
fields. Keep provider/platform acquisition external where necessary; repository
code should validate the normalized receipt rather than pretend to query a
source it cannot trust.

### R6 — Authenticate the final approval envelope (blocking policy decision)

The Gate F index prevents byte drift and self-inconsistent joins, but an
`approverIdentity` remains a claimed string and the final index itself is only
hashed, not signed. This is not sufficient proof that counsel/founder/operating
owners actually approved it.

Required closure: choose the approval authority (for example protected GitHub
environment attestations, organization-managed signatures, or a controlled
change-record system), verify it in repository tooling, and sign/retain the
final index digest. Engineering must not invent legal signer authority.

### R7 — Validate LEG-01 semantics in its owning package (external/legal blocker)

The final index now binds one legal revision-set artifact and requires counsel
and founder to bind its digest. It does not interpret whether that artifact
contains every LEG-01 fact: effective versions/revision process,
controller/processor roles, lawful bases, DPIA/CCPA decision, retention/data
rights, subprocessors/regions/transfers, Google confirmation scope/conditions/
expiry/monitoring owner, employee-metrics framing, and beta support wording.

Required closure belongs to the legal workstream: define its signed checklist
schema and authority, then make the Gate F validator consume that validated
result. No legal draft was edited in this audit.

## Candidate-bound repository verification still required

After R1–R7 are closed, repository completeness still does not equal release
completion. One merged candidate must produce, without retry:

1. a clean protected CI run and exact beta evidence artifact;
2. eight published/pullable signed images and the canonical signed manifest;
3. independent review and current defect disposition;
4. isolated pre-production restore/migration, stub and live-provider journeys;
5. rehearsal then production plan/migration/promotion/read-back;
6. deployed critical journeys, canary observation, restore and rollback proof;
7. a canonical Gate F index whose every digest validates.

## External/live gates still required

- GitHub branch protection, `release-signing` reviewer protection, and artifact/
  GHCR access and retention must be confirmed.
- The dedicated rehearsal and production projects must each have one sole
  `cell-us` environment; production must own `us.reputationkey.app`. This audit
  created neither project. These are two isolation profiles for one logical US
  Data Cell, not multiple beta cells.
- California compute and `sjc` bucket placement, source-less foundation,
  database/Redis/bucket inventory, domain/DNS/certificate, and no-drift must be
  proved live.
- Backup policy, WAL/PITR range, isolated sibling restore, fresh Redis recovery,
  RPO/RTO, and rollback must be proved with provider receipts.
- Authorized non-customer Google, monitoring/Sentry Germany, email, AI, and
  sidecar configuration must be proved without customer content in evidence.
- Counsel/founder/operations/product/security/support approvals and first-cohort
  ownership must be authenticated against the exact candidate and legal set.

## Verification performed

- Focused release and release-schema suite: **20 files / 172 tests passed**.
- Railway foundation/domain/approval/isolation/environment suite:
  **9 files / 186 tests passed**.
- `tsconfig.railway.json`: passed.
- Container image policy: passed — 10 Dockerfiles, 8 promoted, 2 CI-only.
- Action/image pin policy: passed — 76 pinned references.
- Focused ESLint and Prettier checks: passed.

The repository-wide typecheck was not green, for concurrent non-REL changes:

- root TypeScript reports missing `storage` on the composition result in
  `src/composition.characterization.test.ts` and
  `src/contexts/identity/server/organizations.upload.ts`;
- scripts TypeScript reports missing `replyRepo` in
  `scripts/ops/reconcile-publication.ts`.

Those files are outside this audit's authorized response/lifecycle/legal/CNV
boundaries and were not changed. Consequently this report does not claim a
clean full-CI candidate.
