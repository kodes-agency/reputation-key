# ADR 0042 — Goal Measure Kinds: Progress, Level, and Ratio

**Status:** Accepted
**Date:** 2026-07-15
**Extends:** ADR 0020

## Context

ADR 0020 established that goals are progress-only (monotonic accumulation over `metric_readings`). It deferred level and ratio goals as a shared "non-monotonic goals" workstream. The post-beta program now implements all three measure kinds with explicit lifecycle and evaluation semantics.

## Decision

Three goal measure kinds, each with distinct evaluation rules:

| Kind         | Example                          | Evaluation                                                                                                                            |
| ------------ | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| **Progress** | 20 approved outcomes in a month  | Monotonic period accumulation. May achieve early. Later source correction invalidates/superseds the outcome while preserving history. |
| **Level**    | Maintain approved level ≥ X      | Latest eligible snapshot as-of evaluation. `met`/`not_met`/`insufficient_data`. Does not permanently complete on first crossing.      |
| **Ratio**    | Response SLA ≥ X% with minimum N | Numerator/denominator with sample threshold. Evaluate through the period; finalize at close. Insufficient data ≠ zero.                |

### Separation of concerns

- `GoalDefinition`: owner, audience, scope, metric version, target rule, recurrence, timezone policy, visibility, status/version.
- `GoalPeriod`: immutable start/end instantiation, baseline, target snapshot, eligibility cohort, status.
- `GoalEvaluation`: value/sample/completeness/freshness at a point, result, source watermark, correction link.

### Rules

1. Material changes (target, metric, formula, cohort, scope, recurrence) create a new definition version effective in a future period.
2. Recurrence uses property-local IANA timezone dates, tested across DST gaps/folds, leap days, month ends.
3. Recurring periods are unique by `(definition_id, period_start, period_end, version)` in the authoritative schema.
4. Pausing records whether the clock continues, extends, or cancels; default is no silent extension.
5. A correction after close appends a new evaluation and may change visible outcome to `invalidated`/`superseded`.
6. A property dashboard rating is a separately sourced/versioned `level` definition under ADR 0031 — never a goal/badge/leaderboard input.

## Consequences

- ADR 0020's progress-only limitation is lifted; level and ratio goals are now supported.
- Existing goals migrate to progress definitions/periods.
- Sidecar SQL for recurring uniqueness moves to the authoritative Drizzle schema.
- Goal evaluation, period outcome, activity, notification, and badge trigger are atomic with the source event.

## Rejected Alternatives

- **Windowed average as "overall rating" goal** — deceptive (per ADR 0020's rejected alternatives).
- **Reply count as "response rate" goal** — measures volume, not rate.
