# ADR 0021 — Leaderboard: Remove Composite Score; Per-Metric Leaderboards + Comparison Matrix

**Status:** Accepted  
**Date:** 2026-06-25

## Context

The leaderboard composite "overall" score was a weighted sum — 40% average rating, 30% feedback, 20% scans, 10% review-link clicks — of metrics each normalized to [0,1] by the property max. A review during a goal-setting redesign surfaced three problems:

1. **Dimensionally meaningless.** A weighted sum of "fraction-of-max scans" + "fraction-of-max average rating" + "fraction-of-max feedback" has no common unit. The resulting score (e.g. 0.73) is not a measurement of anything real; it is pseudo-precision. Recalibrating the weights would not fix this — the form itself is invalid.

2. **The 40% rating component was statistically broken.** It used _average_ rating normalized by the property max, which rewards low-volume portals: a portal with one 5★ rating (avg 5.0, normalized 1.0) outranks a portal with 120 ratings averaging 4.7 (normalized 0.94). The dominant weight actively punished high-volume portals — the opposite of rewarding engagement, and actively misleading for the stated goal of pinpointing underperforming portals.

3. **Structural framing.** The leaderboard ranks portals and portal groups _within a property_. External Google reviews attach to the property/location, not to individual portals, so they cannot differentiate portals. The leaderboard is therefore an **internal portal-performance** view, not a public-reputation ranking — and the average-rating component is the _only_ portal-granular quality signal available (private guest ratings), which makes it worth keeping _if_ made reliable.

## Decision

1. **Remove the composite "overall" score entirely** — `OVERALL_WEIGHTS`, `compositeScore`, the `'overall'` metric key, and `refreshOverall`. No weighted blend of normalized heterogeneous metrics.

2. **The leaderboard becomes two surfaces:**
   - **Per-metric leaderboards** — rank portals by a single metric (Scans / Ratings / Feedback / Clicks). Descending (best-first). Default metric: Ratings. The competitive view.
   - **Comparison matrix** — portals as rows, metrics as columns; each cell shows raw value + per-column rank, color-coded (heatmap). Default landing view. Default sort: rating ascending (worst-first) to surface struggling portals. The diagnostic view.

3. **Rating floor.** The average-rating metric requires **≥5 private ratings in the period** to be ranked or scored on quality; sub-threshold portals show "insufficient data". Count metrics (scans, feedback, clicks) have no floor — a low count is the engagement signal, not statistical noise. Only averages are unstable at low N.

## Consequences

- `'overall'` is removed from the `LeaderboardMetricKey` union, the DTO enum, the route search schema, the repository refresh path, and the event handler. `compositeScore`, `OVERALL_WEIGHTS`, and `PORTAL_METRICS` are removed from `scoring.ts`.
- The DB `score_key` column (default `'overall'`) and any stale `'overall'` snapshot rows remain **harmlessly** — no destructive migration. New writes simply stop producing `'overall'` snapshots.
- New work: a comparison-matrix API/view (fetch all metrics per portal in one call, or fan-out), per-column ranking, heatmap color logic, and rating-floor logic in scoring.
- **Loss of the single "overall champion" ranking.** Replaced by per-metric champions. Accepted: the composite was meaningless, and per-metric competition is both honest and still motivating.
- The change is **self-contained to the leaderboard context and its route** (`routes/_authenticated/leaderboard.tsx`). No badge, dashboard, or other context references `'overall'` — ADR 0014's separation held.
- Short-period rating leaderboards (today / this week) will often be sparse ("insufficient data" for most portals). This is honest: there is genuinely too little data to rank by quality over a day.

## Rejected Alternatives

- **Keep the composite with recalibrated weights.** Does not fix dimensional meaninglessness or the average-rating flaw; only changes the arbitrary numbers.
- **Bayesian shrinkage for rating instead of a hard floor.** More statistically "correct" (low-sample averages regress toward the property mean continuously), but harder to explain to a manager who asks "why is my 4.8 showing as 4.3?". A hard threshold + "insufficient data" was chosen for transparency in a diagnostic tool.
- **Pure engagement frame (drop rating as a quality dimension).** Rejected: portal performance needs a quality pillar, and `portal.rating` average is the only portal-granular quality signal that exists. The fix is to make it reliable, not remove it.
- **Pure reputation frame.** Impossible at portal granularity — external Google reviews do not vary by portal, so they cannot rank portals.
