# POST-BETA-3 — Metrics, Goals, and Property Dashboards

**Status:** Proposed  
**Depends on:** POST-BETA-1 attribution; POST-BETA-2 if portal events are enabled; PRE17 durable events/read models; written Google disposition for any Google-derived measure  
**Contexts:** Metric, goal, dashboard, property, portal, review, integration, staff, activity, notification  
**Effort:** 13–20 engineering days

## 1. Goal

Create one governed, replayable measurement system that can safely power transparent property goals and fast property-local dashboards. Eliminate independent formulas scattered across contexts and make source eligibility, policy, attribution, data quality, correction, time, and retention part of every metric's contract.

Actual reviews remain the operational core of the product, but Google's current published policy blocks persistent/aggregated Google review measures under the conservative interpretation. The architecture should be ready to enable specifically approved review measures later without letting code infer permission. Until then, property dashboards may show current authorized review workflow data where permitted, but long-lived Google-derived metrics, trends, goals, badges, and rankings remain off.

No organization-wide AI summary is added. Dashboard summaries are property-local.

## 2. Scope

### In

- Versioned metric registry with provenance, source-policy class, units, aggregation/window, attribution, privacy, data-quality, retention, and consumer eligibility.
- Idempotent metric readings with stable source IDs and append-only corrections/retractions.
- Event-time portal-group attribution and explicit attribution-quality markers.
- Incremental daily property/portal-group/portal rollups and repair/backfill paths.
- Property and portal-group goals on approved metrics.
- Separate progress, level, and ratio goal semantics.
- Goal definition/period/evaluation history, property timezone/DST, recurrence, pause/cancel/supersede/correction behavior.
- Property-local manager dashboard and staff scorecard with formula/evidence/freshness states.
- Authorization, performance, accessibility, fairness, lifecycle, and scale gates.

### Deferred/conditional

- Portal/individual goals: implemented only after worker-use, sample/opportunity, visibility, and correction gates pass.
- Google review count/rating/reply metrics: source capability remains `blocked` until exact written permission.
- Historical Google backfill: only after policy and retention design permit it.
- Team goal UI: teams remain administrative; a department goal targets a portal group, not a mutable team membership join.

### Out

- AI sentiment/priority/category/theme metrics.
- Organization AI summaries or cross-property employee rankings.
- External review-link clicks, review-request scans, Google review volume/rating, named staff mentions, or conversion-to-review as goal/badge/leaderboard inputs.
- Pay, scheduling, promotion, discipline, or termination decisions.
- Arbitrary customer-written formulas or SQL.
- A general analytics warehouse; use PostgreSQL/read models at the stated scale.

## 3. Current-state findings to resolve

| Finding                                                                                              | Consequence                                                                           |
| ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `metric_readings` stores a string key and `real` value without definition version or source event ID | Formula/policy drift and duplicate consumption cannot be proved or replayed.          |
| No provenance, privacy, retention, eligibility, or quality state                                     | Any recorded fact can accidentally fan out to goals/badges/leaderboards.              |
| Metric handlers use in-memory delivery and may catch/swallow errors                                  | A committed source fact can be missing permanently from measurement.                  |
| Failed group lookup records `groupId = null`                                                         | A transient lookup failure becomes silent historical truth.                           |
| Current readings capture group ID while ADR 0013 says live membership                                | Implementation and documented semantics conflict.                                     |
| Aggregate API is sum/count/max with caller-computed average                                          | Consumers can implement incompatible denominators, floors, and missing-data behavior. |
| Goals lack full DB checks and tenant-consistency constraints                                         | Invalid type/scope/target/status relations can enter through bugs or manual SQL.      |
| Recurring goal uniqueness lives in sidecar SQL, not migration authority                              | Fresh databases and production can diverge.                                           |
| Goal event updates are not idempotent/atomic with completion event                                   | Duplicate progress/completion or lost notification is possible.                       |
| Global reconciliation loads every active goal                                                        | Work grows without partition/checkpoint/backpressure.                                 |
| Recurrence uses UTC                                                                                  | Property-local dates and DST produce incorrect periods.                               |
| Goal UI suggests trajectory without canonical history                                                | Visual history can be fabricated from a snapshot rather than facts.                   |
| Dashboard adapters query contexts/raw data directly; materialized views are unused                   | Latency, policy, and formula ownership are inconsistent.                              |

## 4. Governed metric contract

### 4.1 Definition and version

Create a closed, code-reviewed registry rather than arbitrary organization formulas in v1.

`metric_definitions`

- stable ID/key, product name/description, owner, lifecycle status;
- value kind: `counter`, `duration`, `level`, `ratio`, `average`, or other explicitly implemented type;
- worker-data flag and privacy class;
- default retention/data-region class;
- approval and policy owner.

`metric_definition_versions`

- immutable version/effective dates;
- exact numerator, denominator, exclusions, unit, precision, aggregation and late-arrival rules;
- allowed scopes: property, portal group, portal;
- attribution rule and required dimension completeness;
- calendar/timezone/window semantics;
- minimum sample/opportunity/cohort and insufficient-data behavior;
- source-policy allowlist and source schema versions;
- permitted consumers: dashboard, goal, badge, leaderboard, notification, export, AI;
- correction/retraction behavior and retention version;
- fairness/accessibility review status;
- `employment_decision_eligible = false` fixed for post-beta v1.

Application code references a version ID. Material rule changes create a new version and effective date; they never mutate the meaning of historical values.

### 4.2 Source-policy classification

Every source event maps to a centrally evaluated class, for example:

| Source policy class                  | Example                                     | Default consumers                                                              |
| ------------------------------------ | ------------------------------------------- | ------------------------------------------------------------------------------ |
| `google_api_content_blocked`         | Google review/rating/content-derived fact   | Temporary authorized workflow only; no metric reading under current policy     |
| `review_solicitation_analytics_only` | Review-link click, review-request scan      | Limited operational diagnostics; never goals/badges/leaderboards               |
| `first_party_guest_private`          | Optional private response                   | Property operations; goals only after worker/privacy approval; leaderboard off |
| `first_party_workflow`               | Manager-confirmed internal workflow outcome | Dashboard/property-group goal if definition approved                           |
| `manager_confirmed_recognition`      | Explicit quality/training completion        | Badge/goal if catalog-approved; no automatic ranking                           |

The registry fails closed: an unknown source/version or unavailable policy service does not produce a reading. Persist a rejected/quarantined source receipt and alert rather than silently recording `groupId = null` or generic metric data.

### 4.3 Reading and correction model

`metric_readings`

- ID, definition version, organization/property;
- optional portal group/portal attribution captured as of `occurred_at`;
- value plus type-specific numerator/denominator/duration fields where needed;
- stable `source_event_id`, source type/schema, occurred/recorded time;
- property-local date/timezone version;
- attribution quality and data quality;
- region/retention class;
- unique `(definition_version_id, source_event_id, target_dimension)` or equivalent idempotency key.

`metric_corrections`

- stable correction ID and corrected reading/source;
- `retract`, `replace`, or supported adjustment semantics;
- reason, actor/source event, occurred/recorded time, superseded correction reference;
- never overwrite/delete the original fact during normal correction.

The query service returns value plus sample, opportunity/denominator, completeness, quality, freshness, definition version, effective period, and correction state. Consumers do not compute average/ratio from unrelated calls.

### 4.4 Attribution rule

Use event-time, non-retroactive attribution:

1. Resolve portal, responsibility (when permitted), and portal group at source `occurred_at`.
2. If the history is complete, record the dimension and `attribution_quality = exact`.
3. If an event predates migrated history, use the approved backfill rule and mark `current_state_backfill`.
4. If a required dimension cannot be resolved, quarantine/retry; do not turn it into an unattributed eligible reading.
5. A later assignment/group change affects only future source events. A genuine source error produces a correction.

This supersedes only ADR 0013's live-membership/retroactive-history clause after ADR 0040 is accepted.

## 5. Goal model

### 5.1 Separate definition, period, and evaluation

Prefer three concepts rather than one mutable goal/progress row:

- `GoalDefinition`: owner, audience, scope, metric definition version, target rule, recurrence, timezone policy, visibility, status/version.
- `GoalPeriod`: immutable start/end instantiation, baseline where needed, target snapshot, eligibility cohort, status.
- `GoalEvaluation`: value/sample/completeness/freshness at a point, result, source watermark, evaluation version, correction/supersession link.

Material changes to target, metric, formula, cohort, scope, or recurrence create a new definition version effective in a future period. Title/description copy may be edited with activity history if it does not change meaning.

### 5.2 Measure-kind semantics

| Kind     | Example                                              | Evaluation semantics                                                                                                                           |
| -------- | ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Progress | 20 approved first-party workflow outcomes in a month | Monotonic period accumulation. May achieve early; later source correction visibly invalidates/supersedes the outcome while preserving history. |
| Level    | Maintain an approved current level ≥ X               | Latest eligible snapshot as-of evaluation. It is `met/not_met/insufficient_data`; it does not permanently complete on the first crossing.      |
| Ratio    | Approved response workflow SLA ≥ X% with minimum N   | Numerator/denominator and sample threshold. Evaluate through the period and finalize at close; show insufficient data rather than zero.        |

Do not represent a windowed average of new events as an overall external property rating. If Google later permits the latter, it requires a separately sourced `level` definition.

### 5.3 Lifecycle

- Definition: `draft → scheduled|active → paused|archived`; replacement uses `superseded`.
- Period: `scheduled → active → closed`; terminal outcome `achieved|not_achieved|insufficient_data|cancelled|invalidated`.
- Pausing records whether the period clock continues, extends, or cancels; default is no silent extension.
- A property timezone change affects future periods only. Existing periods retain their timezone/IANA rules snapshot.
- Calendar generation uses IANA timezone dates and is tested across DST gaps/folds, leap days, month ends, and timezone changes.
- Recurring creation is unique by `(definition_id, period_start, period_end, version)` in the authoritative schema.
- A correction after close appends a new evaluation and may change visible outcome to invalidated/superseded. Notification/badge consumers receive the correction fact.

### 5.4 Scope and permissions

Initial enabled scopes:

- property;
- portal group (the reporting scope for department/area performance).

Portal scope is separately capability-gated because a staff-specific portal can identify an individual. Before enabling it, require workforce activation, sufficient opportunity/sample, staff visibility/correction, and approved metric definition.

Owners/admins/managers with goal-management capability create and materially change organizational goals. Staff view relevant goals, acknowledge/comment if that product feature is accepted, and request correction. Self-created private goals are a later separate aggregate, not a permission branch on the organizational goal.

## 6. Property dashboard contract

### 6.1 Manager property dashboard

Compose versioned read models, not live cross-context joins:

- current authorized review/inbox operational status and attention items;
- connection/sync/reply-publish health;
- approved property metric cards with period, sample, quality, freshness, and formula link;
- approved portal-group comparison without employee rank;
- active/recent goal periods and transparent evaluation;
- notification/action links to source workflow.

Google-derived aggregate sections render `not available under current source policy` until explicitly enabled. They do not fall back to locally accumulated prohibited readings.

### 6.2 Staff scorecard

- current property/team/portal responsibilities;
- goals in the staff audience;
- approved attributed facts and their correction link;
- active private badges after POST-BETA-4;
- no hidden composite score, AI assessment, or cross-property comparison.

### 6.3 Read models and cache

- Incrementally maintain daily rollups per property/definition version/scope/dimension/local date.
- Rollups include value, numerator/denominator, sample/opportunity, quality, source watermark, computed time, and version.
- A correction invalidates/recomputes only affected partitions and dependent goal periods/snapshots.
- Cache property dashboards by property, capability/policy version, audience, period, and projection watermark. Never share manager/staff payloads.
- Return stale-with-visible-freshness for safe reads during repair; do not claim live accuracy. Sensitive or source-policy-disabled sections fail closed.
- Use cursor pagination/bounded intervals for drill-down evidence.
- Benchmark before database partitioning. Add table partitioning only if target-data evidence justifies its operational cost.

## 7. Work packages

### PB3.0 — Freeze unsafe consumers and accept ADRs

1. Add domain tests that external review-link click, review-request scan, Google review/rating/count, named staff mention, and AI fields cannot be goal/badge/leaderboard sources.
2. Put Google-derived metric production behind the executable source-policy capability.
3. Accept ADR 0040 (attribution), 0041 (metric registry), and 0042 (goal kinds).
4. Correct obsolete glossary/plan statements only after acceptance.
5. Choose the first approved metric catalog; start small and first-party.

**Exit:** Unknown/restricted source classes cannot enter any downstream consumer even through direct use-case calls.

### PB3.1 — Registry and metric ingestion

1. Add definition/version schema and seed catalog through reviewed migrations.
2. Add source-policy decision port with an in-process policy adapter initially; persist decision/version with each reading.
3. Add stable source-event idempotency, type-aware values, attribution/quality, property-local date, and retention metadata.
4. Replace in-memory/swallowed handlers with durable idempotent consumers.
5. Quarantine invalid/unknown/unresolved source events with bounded retry and operator status.
6. Add append-only corrections/retractions and data-quality propagation.

### PB3.2 — Incremental rollups and repair

1. Implement daily rollups and type-specific aggregation in the metric context.
2. Use transaction/advisory lock/version checks so concurrent live/correction/replay work is deterministic.
3. Checkpoint backfill by organization/property/date/definition; rate-limit and expose progress/cancel/retry.
4. Build reconciliation that compares source receipts/readings/rollups and repairs through the same service.
5. Remove unused full-fleet materialized-view refresh paths after cutover.
6. Capacity-test normal 500,000 reviews/month shape plus burst, late arrival, correction, and backlog recovery. Restricted Google events must not become stored metric facts in the test.

### PB3.3 — Goal schema and commands

1. Add definition/period/evaluation model with DB checks and tenant consistency.
2. Migrate current monotonic goals to progress definitions/periods. Quarantine invalid scope/type combinations and sidecar-only uniqueness drift.
3. Implement draft/schedule/activate/pause/cancel/supersede and version rules.
4. Generate recurrence by property local calendar and idempotent period key.
5. Make source evaluation, period outcome, activity, notification outbox, and later badge trigger atomic.
6. Partition/checkpoint reconciliation; never load every active goal fleet-wide.
7. Retain goal evaluation history for real trajectory UI and evidence drill-down.

### PB3.4 — Goal experience

1. Consolidate duplicate progress visualizations around the semantics, not merely appearance.
2. Show metric definition/version, target, period/timezone, current value, sample/opportunity, quality/freshness, excluded data, and correction link.
3. Distinguish behind target, insufficient data, delayed, reconciling, invalidated, cancelled, and permission-denied states without color alone.
4. Provide accessible key-value/table equivalent for every chart/ring.
5. Add manager create/edit preview stating which future period changes; never silently edit active history.
6. Staff view is read-only by default and explains how attributed data is used.

### PB3.5 — Property dashboard read models

1. Define one property dashboard query contract and explicit sub-read-model ownership.
2. Replace raw/context-specific formulas with metric rollups or canonical operational projections.
3. Add current data/policy/freshness metadata and graceful unavailable states.
4. Remove duplicate calls and empty-property queries; bound every selector and time range.
5. Add cache keys/invalidation and prevent audience/tenant leakage.
6. Meet server/query and Core Web Vital budgets on target data.

### PB3.6 — Lifecycle and rollout

1. Apply retention/correction/deletion to readings, rollups, periods, evaluations, caches, queues, exports, activity, and backups.
2. Add dashboards/alerts for source rejection, ingestion lag, quality degradation, rollup drift, goal evaluator age/failure, repair backlog, and query latency.
3. Roll out property dashboard read-only, then one property goal, then portal-group goals after two full periods of evidence.
4. Keep portal/individual goals disabled until separate worker gate passes.

## 8. Test matrix

### Metric/domain correctness

- every value kind, source-policy allow/deny, unknown schema, idempotent duplicate, out-of-order/late event;
- event-time attribution across team/portal/group move, DST, migration-quality history, unresolved relation;
- correction/retraction chains, replay equivalence, partial/delayed/reconciling/invalidated quality;
- sum/count/average/ratio/level semantics, zero denominator, minimum sample, ties/precision/rounding;
- tenant/property constraints and restricted direct-call bypass attempts.

### Goal correctness

- progress/level/ratio lifecycle and correction after early/closed evaluation;
- property/group/disabled portal scope authorization;
- daily/weekly/monthly/quarterly periods across IANA zones, DST, leap year, month end, timezone change;
- recurrence duplicate/race, pause/cancel/supersede, target/version change, insufficient data;
- source event/progress/outcome/outbox atomicity and consumer idempotency;
- bounded reconciliation/backfill crash/resume/cancel.

### Dashboard/UX

- manager versus staff data scope and cache separation;
- Google-policy-disabled, delayed, stale, partial, no data, high volume, long labels/locales;
- keyboard, semantic table/chart alternative, screen reader, zoom/reflow, contrast, reduced motion;
- p95 query/SSR budgets and target-dataset load/backlog tests.

## 9. Gate criteria

- The registry is the only route from source facts to goals, badges, leaderboards, and governed dashboard metrics.
- Restricted/unknown source classes fail closed and are observable.
- Every reading is idempotent, attributed as-of occurrence, policy/versioned, quality-aware, retained correctly, and correctable.
- Rollups replay to the same result and repairs are bounded/observable at target scale.
- Initial property and portal-group goals have correct measure-kind/timezone/version semantics and explainable evidence.
- No goal or dashboard misrepresents missing/insufficient/restricted data as zero.
- No Google-derived aggregate or gamification input runs without exact written-policy capability.
- Property dashboards meet agreed latency/accessibility targets and expose freshness.
- One property completes two full recurring periods plus a correction/replay drill without unresolved P0/P1 issue.

## 10. Decisions required before PB3.0 exits

| Decision                     | Recommended default                                                                                                                  |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| First goal scopes            | Property and portal group only; individual portal goals off.                                                                         |
| Goal authors                 | Managers only for organizational goals.                                                                                              |
| Personal goals               | Defer as a separate private model.                                                                                                   |
| Group history                | Event-time/non-retroactive.                                                                                                          |
| First metric catalog         | Approved first-party operational outcomes only; no review solicitation/Google-derived measure.                                       |
| Google measures if permitted | Add one by one with exact policy version, beginning with the least content-sensitive operational measure; do not blanket-enable all. |
| Dashboard unit               | Property-local; no organization AI summary.                                                                                          |
