# Review 2 — Bounded Context Boundaries

**Branch:** feat/phase-15c-goal-ui
**Date:** 2026-05-23

## Cross-context dependency map

| Receiving Context | Source Context | Mechanism                                                              |
| ----------------- | -------------- | ---------------------------------------------------------------------- |
| portal            | property       | `PropertyPublicApi` via public-api                                     |
| inbox             | staff          | `StaffPublicApi` via public-api                                        |
| inbox             | review         | `ReviewCreated`/`ReviewUpdated`/`ReplyPublished` events via public-api |
| inbox             | guest          | `FeedbackSubmitted` event via public-api                               |
| identity          | portal         | `StoragePort` via portal public-api                                    |
| property          | staff          | `StaffPublicApi` via public-api                                        |
| integration       | review         | `ReviewQueuePort` via review public-api                                |
| integration       | property       | `PropertyPublicApi` + events via public-api                            |
| team              | staff          | `StaffPublicApi` via public-api                                        |
| team              | property       | `PropertyPublicApi` via public-api                                     |
| review            | property       | `PropertyCreated` event via public-api                                 |
| guest             | portal         | `LinkResolverPort` + `PortalPublicApi` via public-api                  |
| guest             | staff          | `StaffPublicApi` via public-api                                        |
| metric            | guest          | Events (scan/rating/click/feedback) via public-api                     |
| metric            | review         | `ReviewCreated` event via public-api                                   |
| goal              | metric         | `MetricPublicApi` + `MetricRecorded` event via public-api              |
| goal              | staff          | `StaffUnassigned` event via public-api                                 |
| goal              | portal         | `PortalDeleted` event via public-api                                   |
| goal              | team           | `TeamDeleted` event via public-api                                     |
| dashboard         | metric         | `MetricStatsPort` (cross-context adapter)                              |
| dashboard         | review         | `ReviewStatsPort` (cross-context adapter)                              |

## Findings

### Checks passed (no issues)

- **All cross-context dependencies** expressed through `application/public-api.ts` ✅
- **No direct imports** of another context's internal types, repos, or schemas ✅
- **Event handlers** only import event types from public-api ✅
- **Build functions** receive upstream context deps as typed public-api parameters ✅

## Counts

| Severity | Count |
| -------- | ----- |
| BLOCKER  | 0     |
| MAJOR    | 0     |
| MINOR    | 0     |
| NIT      | 0     |

**No actionable issues found.** Cross-context boundaries are well-enforced.
