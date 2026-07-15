# ADR 0043 — Worker Recognition Boundary

**Status:** Accepted
**Date:** 2026-07-15

## Context

The existing badge and leaderboard contexts are gated but have structural issues: definitions are global with effectively default-on enablement, "First Review" is awarded from private portal rating (misleading), award FK cascades can erase history, and awards can never be visibly invalidated.

## Decision

Recognition features are **coaching/recognition tools, not employment-decision systems**.

### Boundaries

1. **AI fields never enter recognition.** Sentiment, priority, categorization, themes, trends, and summaries are excluded from badges, leaderboards, goals, and rankings by architectural test.
2. **Google-derived review/rating/count, review-link clicks, scans, named-staff mentions, and conversion are never recognition inputs** — independent of property analytics permission.
3. **Off by default.** Recognition requires an explicit workforce activation record per property with policy/version, audience, jurisdiction, notice/consultation status, and acknowledgement that it will not drive employment decisions.
4. **Positive only.** No negative badges, bottom-performer lists, or scarcity mechanics.
5. **Correctable.** Awards have visible `invalidated`/`superseded` status with neutral reason and preserved evidence. Invalidation is factual, not punitive.
6. **Property-local.** No cross-property, cross-organization, or public employee board.
7. **Snapshotted.** Award display captures definition name/icon/criteria/rule/metric version at award time; it never depends on a mutable definition join.

### Product form

- Portal-group recognition board is the preferred initial subject (recognizes an area, not a person).
- Individual ranking is optional, off by default, and requires a distinct capability and workforce review.
- Staff view: own position + anonymized peers, never a public bottom list.

## Consequences

- Badge definitions move from global to versioned with per-property activation.
- "First Review" badge is removed or renamed; private guest rating is not a recognition criterion.
- Award cascade deletes are replaced by lifecycle-aware behavior.
- Architectural test prohibits AI/review-solicitation/Google-restricted sources from entering recognition.

## Rejected Alternatives

- **Default-on recognition** — workforce monitoring appears without deliberate activation, creating legal and fairness risk.
- **Uncorrectable awards** — bad attribution or data correction has no truthful visible state.
