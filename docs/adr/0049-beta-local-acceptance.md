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
2. Permanent hard blocks are limited to Google auto-publish, cross-property AI summaries, and review-solicitation gamification. No Portal response, private response, Google, AI, scan, click, or named-mention fact may drive a staff goal (a goal for a person or a team) or workforce recognition; Goal Programs for a Property, a Portal Group or a Portal count only the Portal's own qualified scans, private-rating count and private-rating average, and no Google, AI, click or named-mention fact drives a Goal Program (amended 2026-10-14 and 2026-10-17, below).
3. Public Portal requests resolve the opaque token to minimal organization/property scope before one authoritative `ExecutionPolicy` decision. Public content and stored redirects remain available when optional analytics or response dependencies are denied; external side effects and private submissions fail closed.
4. `beta-local-1` is the release evidence profile. Required gates are `security-privacy`, `local-scale-recovery`, `source-lifecycle`, `runtime-fault-matrix`, `migration-upgrade`, `product-journeys`, and `release-bundle`. Hosted capacity/PITR, region-fault, live-provider, real-property, and 14-day pilot observations are explicitly post-beta and remain unmeasured until executed.
5. BQC-8 runs the existing deterministic 100-organization/5,000-property/500,000-review catalogue locally, plus a separate one-organization authorized 5,000-property fleet fixture. BQC-9 is the local product journey matrix across Inbox, Dashboard, Portal, Goals, Leadership, and Settings. The application runs from production-profile Docker images; host Playwright owns only the browser.

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

## Supersession

This ADR supersedes the beta-boundary portions of the earlier BQC-2.6, BQC-6.6, BQC-8, BQC-9, and post-beta product plans. Their historical implementation notes remain immutable; live status and new evidence use this decision.

## Amendment 2026-10-14 — the Property Google rating goal

Owner decision 2026-10-14, recorded in
[ADR 0067](0067-property-google-rating-goal.md). Rule 2 gains one exception.
Google's own rating and review count for a Property, and counts and star sums of
its cached Google reviews, may drive the Property Google rating goal: one goal
per Property, seen and changed only by AccountAdmins and PropertyManagers with
access to the Property, never split across Portals, Portal Groups or people,
never shown to staff, and never workforce recognition, a quota, a ranking, an
incentive or an employment input. It changes nothing in the public Portal
journey.

The rest of rule 2 stands. No Google fact drives a Goal Program or workforce
recognition, and the permanent hard block on review-solicitation gamification
remains (`gbp.review_solicitation_gamification` is `permanently_denied`). The
goal is offered under the controlled-beta capability `goal.use`, so rule 1's
persisted Organization and Property policy decides where it exists, and it
needs the journeys and the emergency switch every enabled feature needs.

## Amendment 2026-10-17 — rule 2 is about staff goals

Owner decision 2026-10-17 (P-8 of the Monthly portal goal), recorded in
[ADR 0068](0068-monthly-portal-goal.md). Rule 2's first sentence is unchanged;
its second sentence is narrowed to staff goals.

Read literally, the old sentence ("No Portal response, private response, Google,
AI, scan, click, or named-mention fact may drive Goals") forbade the very
measures the product contract permits: `docs/BETA.md` §3 allows exactly three
Goal measures, qualified scans, private-rating count and private-rating average,
at Property, Portal Group and Portal scope, and §6 of the Participation Agreement
says the same. The Google rating goal plan noticed the conflict and left it (its
open question 6). The owner approved the narrowing with the Monthly portal goal.

The narrowed sentence keeps every fact the old one named out of staff goals (a
goal for a person or a team) and workforce recognition, and says what a Goal
Program may count: only the Portal's own qualified scans, private-rating count
and private-rating average, never a Google, AI, click or named-mention fact.

What stands:

- Person- and Team-scoped goals are prohibited (`docs/BETA.md` §3).
- Request scans never drive staff goals, badges or leaderboards: RepKey's own
  disposition of Google's response of 2026-07-14
  (`docs/external/google/google-business-profile-ai-policy-response-2026-07-14.md`,
  the `gbp.review_solicitation_gamification` row) is unchanged.
- `gbp.review_solicitation_gamification` stays `permanently_denied`.
- The 2026-10-14 exception for the Property Google rating goal is unchanged.

It matches the Google Business Profile Access Disclosure as published, which
excludes Google review solicitation, ratings and review volume from competitive
staff goals and says Portal Goals use the Portal's own qualified scans and
private rating metrics (`docs/legal/google-access-disclosure.md`, "Uses the
product does not allow"). No legal document changes.
