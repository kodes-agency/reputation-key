# Deterministic Property Trend definition v1

Status: repository contract implemented; beta activation remains gated by
AI-02, REV-01, and live rollout evidence.

## Purpose

Property Trends summarize material changes in completed Review Analysis for one
Property. They are a deterministic derivative, not another AI-provider call.
They do not make causal claims, recommendations, confidence claims, or claims of
statistical significance.

## Exact population and periods

- Resolve calendar dates with the current Property timezone and
  `property-calendar-v1`.
- Exclude the current, potentially partial, local day.
- Current window: the 30 complete local days ending yesterday.
- Baseline window: the immediately preceding 30 complete local days.
- Obtain the authoritative Review population through Review's public,
  content-free trend-population port.
- A text candidate is a current, eligible Review revision with analyzable text.
- A star-only Review is counted separately and does not enter the coverage
  denominator.
- An analyzed candidate must match the Review ID, current source revision, and
  current analysis sequence and must have a successful completed analysis.
- Any unresolved sequence/head/cursor/aggregate gap prevents completion.
- The exact current authorization generation must also have one durable Review
  Analysis enrollment in `caught_up`. This is checked when selecting a schedule,
  again in the atomic outcome commit, and at read delivery; head alignment alone
  does not prove that the first-enablement snapshot was exhaustive.

## Readiness and selection

Each window must have at least 20 successfully analyzed text candidates and at
least 90% analysis coverage (`floor(analyzed * 10000 / candidates)`). If coverage
is incomplete, the outcome is `Updating`; if coverage is sufficient but either
window has fewer than 20 analyses, it is `Not enough review data`.

Sentiment, attention, and category shares are compared using exact integer
numerators and denominators. A candidate requires at least a 15 percentage-point
absolute change. A category is eligible only when it accounts for at least 10%
of analyzed Reviews in either window. Candidates are ranked deterministically,
with stable signal-ID tie-breaking, and at most four are selected. No candidate
means `No notable change`.

## Evidence and presentation

Every outcome stores the definition and render versions/digests, timezone,
data-through date, exact periods, candidate/analyzed/excluded/star-only counts,
coverage basis points, Review Analysis profile/provider-deployment/model
lineage, exact selected-signal counts, change magnitude, and bounded content-free
supporting Review links.

The API and UI call the number `changeMagnitudeBasisPoints` or “largest change.”
They never call it confidence. When a newer head is pending, readers preserve the
latest compatible complete outcome and display `Data through … · Updating`.
No compatible complete outcome produces an explicit preparing/updating state.

## Fences, scheduling, and retention

Read delivery requires current caller access, AI authorization, source epoch,
Review Analysis and Property Trends epochs, active Property processing profile,
and a valid delivery lease. A failed fence hides retained results.

The cell-local scheduler is bounded to 100 candidates per lease pass and keys a
schedule by due local date plus terminal analysis sequence and aggregate
revision. Replays are idempotent; corrections create a new exact-head schedule.
Outcome commits recheck Property lifecycle, authorization, profile, Review head,
fully consumed cursor, and aggregate head. New deterministic outcomes expire 24
calendar months after recording and remain independently erasable.

## Residual activation gates

- AI-02 must prove exhaustive Review Analysis enrollment and caught-up coverage.
- REV-01 must prove stable Review identity, material revision sequencing, source
  cutover, and content-lifecycle behavior across corrections.
- Shadow parity, sufficient/insufficient/partial-coverage canaries, rebuild and
  correction recovery, lifecycle hiding/erasure, retention, and Railway cell
  rollout drills still need recorded production-like evidence.
