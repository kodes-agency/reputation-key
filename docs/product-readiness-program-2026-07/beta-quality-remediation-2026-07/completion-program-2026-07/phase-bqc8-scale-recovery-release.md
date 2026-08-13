# BQC-8 — Local Scale, Recovery, and Release Evidence

**Status:** `evidence_pending` — `beta:smoke` passed; five post-evidence approvals remain
**Evidence profile:** `beta-local-1`
**Dependencies:** BQC-6 and BQC-7 implementation complete; BQC-1…5 production paths complete
**Unlocks:** BQC-9 local product acceptance

## 1. Outcome

Execute the target-scale, lifecycle, runtime-fault, migration-upgrade, security/privacy, product-journey, and release-bundle gates against the production-profile local Docker application stack. Produce one digest-keyed immutable evidence manifest proving the same revision, migration heads, image identities, policy versions, fixtures, and results.

Hosted Railway capacity/PITR, regional-infrastructure failure, live Google publication, real-property observation, and the 14-day cohort are post-beta operations. This phase never labels those unexecuted checks passed.

## 2. Findings owned

- SPEC-P1-04 — BQR-6 templates instead of proof.
- SPEC-P2-02 — incomplete release evidence.
- Final evidence for SPEC-P1-05 and SPEC-P1-06.
- Target-scale and recovery closure for every P0 runtime/data/policy finding.

## Ownership mode

- Scale/fault/recovery harnesses and immutable evidence validation: `IMPLEMENTS`.
- Product behavior, policy, lifecycle, runtime, routing, testing, and operations controls from BQC-1…7: `RE_EXECUTES`.

## 3. Test environment and datasets

Use `compose.local.yml` with production web/worker images, PostgreSQL 16, Redis 7, private MinIO, GBP/mail sandboxes, migrator, seed, two web origins, worker, and perf runner. Browser traffic enters only through loopback; DB/Redis remain internal.

Run two deterministic synthetic datasets:

1. the existing 100 organizations / 5,000 properties / 500,000 reviews fixture for throughput, lifecycle, queue, and fault catalogues;
2. one organization with one authorized manager and 5,000 properties, mixed P1/P2 cohort policy, governed readings, and real Dashboard repository instrumentation.

Seed manifests record generator revision, counts, relationship checks, policy distribution, and content-free hashes. Results are labelled synthetic local evidence, not production capacity.

The seed tool records deterministic seed/version/hash and validates counts/relationships. It must not only generate SQL; it must load, verify, and clean up the environment safely.

## 4. Implemented local gates

### BQC-8.1 — Production-profile stack and identity

`compose.local.yml` runs digest-pinned PostgreSQL, Redis, and MinIO dependencies
with production web/worker images, provider sandboxes, a migrator, deterministic
seed, locked and allowlisted web origins, and a non-root performance runner.
Acceptance binds source revision, lockfile, migration heads, image IDs, policy
version, stack contract, and both fixture hashes.

### BQC-8.2 — Deterministic scale fixtures

The existing 100-organization / 5,000-property / 500,000-review catalogue loads
and verifies exact counts, distribution, and relationship integrity. A separate
one-organization / 5,000-property fleet fixture proves authorized Dashboard
query bounds and cohort filtering. These are synthetic local budgets, not hosted
capacity measurements.

### BQC-8.3 — Source lifecycle and governed data

The source-lifecycle gate re-executes expiry and retention behavior without
protected content in evidence. Governed metric definitions, exact readings,
provenance, eligibility, corrections, and consumer scopes are bound to the
candidate used by Goals, Recognition, and Dashboard.

### BQC-8.4 — Runtime fault and restart matrix

The local stack injects dependency and process failures across PostgreSQL,
Redis, object storage, web, worker, GBP, and mail boundaries. Readiness fails
honestly, affected work fails closed, durable state converges after recovery,
and external effects remain idempotent.

### BQC-8.5 — Policy and tenant isolation

The security/privacy and product gates prove P1 success, P2/P3 denial,
cross-property nondisclosure, suspension, organization/property kill switches,
public-token scope resolution, delayed-work reauthorization, and withdrawal
cleanup. Local wrong-region and tampered-work checks remain policy tests;
regional infrastructure outage execution is post-beta.

### BQC-8.6 — Clean install and pre-cutover upgrade

Acceptance runs the deploy migrator once against an empty database and once
against a versioned pre-cutover dump. Both converge at
`0028_recognition-beta-seeds`; reconciliation and quarantine reports are bound
into the acceptance index. Managed PITR and provider RPO/RTO remain post-beta.

### BQC-8.7 — Quality, security, privacy, and accessibility

The quality gate records formatting, lint, typecheck, unit, integration, web
and worker builds, Storybook component/a11y checks, blocking Storybook browser
tests, critical browser tests, full browser tests, and scoped teardown. The
security/privacy gate re-executes capability, denial, guest-session, and guest
lifecycle contracts against the same source identity.

### BQC-8.8 — Immutable release evidence

`pnpm beta:smoke` is the only successful manifest producer. It refuses an
existing release path, hashes every gate result, and writes:

`test-results/beta-smoke/f46d2cd690899eace479e6ec9e08d5bbb3fece4c/6ae52200cfcecac772493e1a3af419b1d2a4140225536aa2d1b33ac263b0953f/manifest.json`

The manifest completed at `2026-08-09T08:00:33.003Z`; all eight required gates
passed with exit code zero. Promotion remains impossible until all five named
approval roles submit post-evidence records bound to digest
`6ae52200cfcecac772493e1a3af419b1d2a4140225536aa2d1b33ac263b0953f`.

## 5. Local budgets and claims

Thresholds are fixed before execution. Evidence records exact fixture counts,
query bounds, lifecycle outcomes, queue/retry/quarantine facts, health
transitions, migration convergence, and content-free hashes. A green run proves
the application images and declared Docker topology under those fixtures. It
does not prove Railway capacity, managed PITR, regional infrastructure
failover, merchant authorization, live Google behavior, or real-property
stability.

## 6. Go/no-go review

Required post-evidence approvers:

- engineering/runtime;
- product/property;
- security/privacy;
- Google project/integration sandbox;
- operations/on-call.

No-go conditions include any unresolved P0/P1, missing or mixed-identity
evidence, failed gate, tenant/property leak, post-withdrawal content, duplicate
external effect, unbounded query/job, or approval predating final evidence.

## 7. Exit matrix

| Criterion                                                            | Observed result |
| -------------------------------------------------------------------- | --------------- |
| 100-org / 5,000-property / 500,000-review fixture loads and verifies | Pass            |
| Authorized one-org / 5,000-property fleet fixture loads and verifies | Pass            |
| Clean install and pre-cutover upgrade converge at migration `0028`   | Pass            |
| Quality, security/privacy, lifecycle, fault, and product gates pass  | Pass            |
| Candidate identity and every evidence artifact are digest-bound      | Pass            |
| Required independent approvals postdate and bind the final manifest  | Pending         |

## 8. Post-beta operations

Hosted capacity and managed PITR, regional infrastructure outage/no-fallback,
live Google publication, merchant authorization, real-property observation,
and the 14-day cohort remain unmeasured. Later execution creates separate
immutable evidence and never rewrites `beta-local-1`.
