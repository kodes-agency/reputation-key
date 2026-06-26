# ADR 0020 — The Goal Model Is Progress-Only; Level and Ratio Goals Deferred

**Status:** Accepted  
**Date:** 2026-06-25

## Context

The `goal` context tracks progress toward a numeric target via **single-metric aggregation over `metric_readings`** (`sum` / `count` / `max` / `avg`), computed by `computeProgressValue`. All four goal types (`open` / `one_shot` / `rolling` / `recurring`) are _progress goals_: progress is monotonic — it only accumulates as `metric.recorded` events arrive.

A goal-setting redesign surfaced two high-value reputation KPIs that do **not** fit this model:

1. **The overall Google rating** — e.g. "reach a 4.5★ overall rating." This is a _level/snapshot_ target: the current value is Google's authoritative rating, not a recomputation over a period. Progress is non-monotonic (a 1★ review moves it backward) and there is no meaningful "70% there."
2. **Review response rate / SLA** — e.g. "reply to 90% of reviews within 48h." This is a _ratio_ of two metrics (replies within SLA ÷ judgable reviews) joined by a time relationship. It cannot be derived from `metric_readings`, whose rows carry scalar values with no link between a review reading and the reply reading that answers it.

Shipping either naively would deceive the operator: a windowed average of _new_ reviews masquerading as the overall rating, or a reply _count_ masquerading as a response rate (hittable by answering easy 5★ reviews while ignoring 1★s).

## Decision

1. **The goal model supports only progress goals for now** — monotonic, single-metric accumulation over `metric_readings`.

2. **External review rating ships only as the windowed average of new reviews.** `property.review`'s valid aggregations expand from `['sum', 'count']` to `['count', 'avg', 'max']` (default `avg`). The metric already stores the per-review star value, so no data-model change is required — only the validation map and UI metadata. It is labeled honestly as the average of reviews received in the period, not the overall Google rating.

3. **Level goals and ratio goals are deferred as one shared "non-monotonic goals" workstream.** Both need current-state-goal machinery that the progress-only model lacks: a `currentValue` recomputed from live state, non-monotonic progress, and completion defined as `currentValue >= threshold` rather than accumulated-past-target. Building them together avoids implementing that machinery twice.

4. **Ratio goals will query the review/reply domain directly** (the `review` ↔ `Reply` timestamp join, evaluated against the org's `Response SLA`), not `metric_readings`. A response-rate goal's denominator is "reviews received this period whose SLA window has elapsed" — reviews still inside the SLA grace period are not yet judgable and must not count against the operator.

5. **Goal metric eligibility is narrowed to outcomes.** `portal.feedback` and `portal.review_link_click` are revoked from goals (they are a process metric and a lever respectively) but remain valid statistics in badges, leaderboards, and the dashboard. See the _Goal-eligible metric_ glossary entry. Scans are grandfathered as a top-of-funnel engagement outcome.

## Consequences

- **No "overall Google rating" goal and no "response-rate/SLA" goal exist until the non-monotonic goals workstream lands.** Both are tracked in the goal context's flagged ambiguities.
- `property.review` aggregation set expands to `['count', 'avg', 'max']`; it becomes dual-purpose (count = review volume, avg/max = rating), presented in the create flow like `portal.rating`.
- Portal- and portal-group-scoped goals are now limited to scans and private guest ratings; `property.review` is the only property-scoped external metric.
- Goal-eligible surfaces (`VALID_SCOPE_METRIC_KEYS`, `METRIC_META`, the goal mapper's valid-key list, the create-flow tiles, seed data) no longer list feedback or review-link clicks. The shared `MetricKey` type retains them for badges/leaderboard/dashboard.
- The leaderboard composite still weights feedback (30%) and review-link clicks (10%). This is a **known, conscious inconsistency** — the leaderboard has not caught up to the outcomes-not-levers rule. Re-weighting the composite is a separate leaderboard-scoped decision, deferred.

## Rejected Alternatives

- **Ship the windowed average labeled as the overall Google rating** — deceptive. An operator whose monthly new-review average hits 4.5 while their real Google rating sits at 4.2 would feel lied to.
- **Ship a reply-count goal labeled as response rate** — measures reply volume, not rate; hittable by ignoring difficult reviews.
- **Build ratio goals now, level goals later** — duplicates the current-state-goal machinery across two passes.
- **Remove feedback and review-link clicks from the leaderboard too** — a real inconsistency, but a separate leaderboard-redesign decision with its own product judgment (what should ranking optimize for?). Deferred rather than bundled into the goals pass.
