---
status: accepted
date: 2026-08-08
---

# 0049 — Local controlled-beta acceptance

## Context

The BQC plan was written around hosted scale, restore, regional-fault, live-provider, and real-property pilot execution. Those checks are not reproducible from a clean developer machine and their absence must not be represented as passed evidence. At the same time, Dashboard, Portals, Goals, Leadership, and Settings need the same durable, authorized, tenant-scoped readiness bar as Inbox before a controlled beta cohort can use them.

The existing capability policy already has organization/property persistence, role and grant checks, suspension, audit, and restore isolation. The dark-context gate is too coarse for the promoted surfaces: it treats an unapproved cohort as a permanent product prohibition, and public Portal work cannot make a scoped decision after resolving an opaque token.

## Decision

1. Beta activation is a persisted organization/property policy decision. Promoted capabilities remain non-core and off by default; an operator must allowlist the organization and target property. Role permissions, `property_access_grant`, purpose/consent, suspension, global kill switches, audit, and delayed-work reauthorization remain first-deny controls.
2. Permanent hard blocks are limited to Google auto-publish, cross-property AI summaries, and review-solicitation gamification. No Portal response, private response, Google, AI, scan, click, or named-mention fact may drive Goals or workforce recognition.
3. Public Portal requests resolve the opaque token to minimal organization/property scope before one authoritative `ExecutionPolicy` decision. Public content and stored redirects remain available when optional analytics or response dependencies are denied; external side effects and private submissions fail closed.
4. `beta-local-1` is the release evidence profile. Required gates are `security-privacy`, `local-scale-recovery`, `source-lifecycle`, `runtime-fault-matrix`, `migration-upgrade`, `product-journeys`, and `release-bundle`. Hosted capacity/PITR, region-fault, live-provider, real-property, and 14-day pilot observations are explicitly post-beta and remain unmeasured until executed.
5. BQC-8 runs the existing deterministic 100-organization/5,000-property/500,000-review catalogue locally, plus a separate one-organization authorized 5,000-property fleet fixture. BQC-9 is the local product journey matrix across Inbox, Dashboard, Portal, Goals, Leadership, and Settings. The application runs from production-profile Docker images; host Playwright owns only the browser.
6. Evidence is digest-keyed, content-minimized, immutable, and non-overwritable. Five approvals bind reviewer identity, role, time, release revision, migration heads, image digests, and the manifest digest. Historical BQC evidence retains its original schema and is never rewritten.

## Consequences

- A green local smoke run proves application, image, topology, authorization, lifecycle, and product behavior under the declared synthetic fixtures. It does not prove Railway capacity, managed PITR, merchant authorization, live Google behavior, or real-property stability.
- Every enabled feature needs a positive P1 journey, a P2/P3 denial journey, delayed-path containment, and an emergency policy switch. A rendered route is not evidence of readiness.
- Forward-only migrations use nullable expansion, checkpointed reconciliation, `NOT VALID`/`VALIDATE`, compatibility fences, and a later contract migration. Applied migration `0011` is immutable.
- The public edge stores keyed token hashes, uses server-minted signed sessions and CSRF, keeps objects private, and propagates withdrawal/deletion to every derived copy.

## Required evidence

- `beta-local-1` manifest and checksum under `test-results/beta-smoke/<release-sha>/<manifest-sha256>/`.
- Clean-install and pre-cutover-upgrade migration runs with quarantine/reconciliation reports.
- Policy, delayed job, tenant-isolation, metric-eligibility, goal-timezone, guest-withdrawal/media-race, dashboard-query-bound, and accessibility results.
- Production-profile Docker image identity, health/readiness, dependency-fault, restart/drain, and teardown logs.
- Exclusive engineering/runtime, product/property, security/privacy, Google-project/integration (sandbox boundary), and operations/on-call approval records.

## Supersession

This ADR supersedes the beta-boundary portions of the earlier BQC-2.6, BQC-6.6, BQC-8, BQC-9, and post-beta product plans. Their historical implementation notes remain immutable; live status and new evidence use this decision.
