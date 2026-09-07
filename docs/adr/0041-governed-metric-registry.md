# ADR 0041 — Governed Metric Registry

**Status:** Accepted
**Date:** 2026-07-15

## Context

The current `metric_readings` table stores a string key and `real` value without a definition version or source event ID. There is no provenance, privacy class, retention, or consumer eligibility. Any recorded fact can accidentally fan out to goals, badges, or leaderboards. Metric handlers use in-memory delivery and may swallow errors, meaning a committed source fact can be permanently missing from measurement.

## Decision

A centralized **governed metric registry** is the only route from source facts to goals, badges, leaderboards, and governed dashboard metrics.

### Structure

`METRIC_DEFINITIONS` in `src/contexts/metric/domain/metric-registry.ts` is the frozen, code-reviewed catalogue. Each entry carries its stable ID/key, name, entity/value kind, privacy and retention classes, lifecycle/approval facts, plus immutable versions with exact formula, effective dates, scopes, attribution, minimum-sample behavior, source-policy allowlist, permitted consumers, correction behavior, and `employmentDecisionEligible = false`.

### Rules

1. Application code references a version ID, not an ad-hoc formula.
2. Material rule changes create a new version with an effective date; they never mutate historical meaning.
3. The registry **fails closed**: an unknown source/version produces no reading. Invalid events are rejected explicitly, not silently recorded.
4. Every reading carries a stable `source_event_id` for idempotency and a `definition_version_id` for provenance.
5. Corrections are append-only; they never overwrite the original fact.
6. `employment_decision_eligible` is permanently `false` in post-beta v1.

## Consequences

- Goals, badges, leaderboards, and dashboards consume versioned definitions — never raw SQL or ad-hoc joins.
- Google-derived property analytics appear in the dashboard only when ADR 0031 and the metric-definition version permit; they never enter goals/badges/leaderboards.
- Review-solicitation analytics (link clicks, scans) are never goal/badge/leaderboard inputs.
- Existing `metric_readings` require migration to add definition version, source event ID, and attribution quality.

## Rejected Alternatives

- **Let each context implement its own formula** — incompatible denominators, missing-data behavior, and policy enforcement.
- **Allow arbitrary customer formulas** — impossible to audit for fairness, privacy, or source-policy compliance.
