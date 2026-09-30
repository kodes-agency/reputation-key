---
status: accepted
date: 2026-07-15
---

# 0041 — Governed Metric Registry

## Context

The current `metric_readings` table stores a string key and `real` value without a definition version or source event ID. There is no provenance, privacy class, retention, or consumer eligibility. Any recorded fact can accidentally reach an ineligible report or Goal. Metric handlers use durable outbox delivery so a committed source fact can be reconciled.

## Decision

A centralized **governed metric registry** is the only route from source facts to Goal Programs and governed reporting.

### Structure

`METRIC_DEFINITIONS` in `src/contexts/reporting/domain/metric-registry.ts` is the frozen, code-reviewed catalogue. Each entry carries its stable ID/key, name, entity/value kind, privacy and retention classes, lifecycle/approval facts, plus immutable versions with exact formula, effective dates, scopes, attribution, minimum-sample behavior, source-policy allowlist, permitted consumers, correction behavior, and `employmentDecisionEligible = false`.

### Rules

1. Application code references a version ID, not an ad-hoc formula.
2. Material rule changes create a new version with an effective date; they never mutate historical meaning.
3. The registry **fails closed**: an unknown source/version produces no reading. Invalid events are rejected explicitly, not silently recorded.
4. Every reading carries a stable `source_event_id` for idempotency and a `definition_version_id` for provenance.
5. Corrections are append-only; they never overwrite the original fact.
6. `employment_decision_eligible` is permanently `false` in post-beta v1.

## Consequences

- Goal Programs and dashboards consume versioned definitions — never raw SQL or ad-hoc joins.
- Google-derived Property analytics appear in reporting only when ADR 0031 and the metric-definition version permit; they never enter a Goal unless that exact version allows it.
- Review-solicitation analytics are never Goal inputs.
- Existing `metric_readings` require migration to add definition version, source event ID, and attribution quality.

## Rejected Alternatives

- **Let each context implement its own formula** — incompatible denominators, missing-data behavior, and policy enforcement.
- **Allow arbitrary customer formulas** — impossible to audit for fairness, privacy, or source-policy compliance.

## Amendment 2026-09-30 — the Portal results measures at group and property scope

Owner decision 2026-09-30: Portal group rows, group pages and totals show all five Portal
results measures, not the three Goal measures alone.

`portal.rating` (…1202), `portal.feedback` (…1203) and `portal.review_link_click` (…1204) were
admitted at `portal` scope only. Their versions now admit `property`, `portal_group` and
`portal`, as the qualified-scan and rating-count/average versions already did. Nothing else
about them moves:

- The versions keep their ids, effective dates, source-policy allowlists and
  `permittedConsumers: ['portal_analytics']`. Widening the scope is not widening the audience:
  no Goal, dashboard, notification or export consumer gains the private-response or
  solicitation measures.
- Readings are unchanged. Every reading is still recorded at `portal` scope and already carries
  the Portal's group at event time (ADR 0040). A group figure is the sum of the readings tagged
  with that group, so a Portal that moves keeps its earlier results with its old group.
- The attribution text of the three versions now says "portal and group", which is what the
  reading always recorded.

Rule 2 stays intact. This is not a new formula: the same readings are read, over a wider
grouping, and no historical meaning changes.

**An exception to "immutable versions", and its limit.** The Structure section calls a version's
scopes and attribution immutable, and this amendment changes both on three existing versions in
place. That is allowed only for a change of this kind: it widens `allowedScopes` (and corrects the
attribution text to say what the reading always recorded), adds no permitted consumer, and leaves
every reading, source-policy allowlist and effective date as it was. Anything else, such as a new
consumer, a different formula, a moved effective date or a narrowed scope, still needs a new
version under rule 2.
