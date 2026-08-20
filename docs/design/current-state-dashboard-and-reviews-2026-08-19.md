# Current state: dashboard and reviews page

Date: 2026-08-19. Scope: what the dashboard surfaces and the reviews three-panel page render today, what data exists in the database with no UI consumer, and which primitives are already available. Facts only — no proposals.

All paths are relative to the repository root. Line numbers were resolved by direct read/grep at the time of writing.

---

## 1. Route topology

There is no single "dashboard". Three routes divide the surface, and `/dashboard` renders its own content only for multi-property orgs.

| Route                             | File                                                           | Renders                                    | Notes                                                                                                                                                                                                      |
| --------------------------------- | -------------------------------------------------------------- | ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/dashboard`                      | `src/routes/_authenticated/dashboard.tsx`                      | `FleetOverview`                            | Gated on `dashboard.fleet_read` (`:33-37`). 0 properties → `FleetOverviewEmpty`; 1 property → `useEffect` redirect to `/properties/$propertyId` and `return null` (`:60-70`); 2+ → `FleetOverview` (`:73`) |
| `/properties/$propertyId/`        | `src/routes/_authenticated/properties/$propertyId/index.tsx`   | `PropertyDashboard`                        | The deep-dive. This is where a single-property org actually lands                                                                                                                                          |
| `/properties/$propertyId/metrics` | `src/routes/_authenticated/properties/$propertyId/metrics.tsx` | `EmptyState` "Metrics coming soon" (`:35`) | Hardcoded placeholder. No loader, no query, no data                                                                                                                                                        |
| `/home`                           | `src/routes/_authenticated/home.tsx`                           | Staff home                                 | Staff surface; `getStaffDashboardDataFn` returns `{ kpis, hasAssignments }` only                                                                                                                           |

The fleet time range is hardcoded: `getFleetOverviewFn({ data: { timeRange: '30d' } })` at `dashboard.tsx:26`. There is no range control on the fleet page.

---

## 2. Dashboard widget inventory

### 2.1 `/dashboard` — `src/components/features/dashboard/fleet-overview.tsx`

Single data source for every widget: `getFleetOverviewFn` (`#/contexts/dashboard/server/fleet-overview`), query key `dashboardKeys.fleet()`, `staleTime` 60 s, primed by the route loader via `ensureQueryData` (`dashboard.tsx:38-41`).

| Widget                      | Component / line                                       | Data displayed                                                                                                           | Source field                                                 | Real or placeholder                    | State coverage                                                   |
| --------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------ | -------------------------------------- | ---------------------------------------------------------------- |
| Page shell + header         | `Shell` `:27-34`                                       | Static title "Dashboard"                                                                                                 | —                                                            | Real (chrome)                          | n/a                                                              |
| Strip stat: Properties      | `StripStat` `:91-95`, `:125`                           | Count                                                                                                                    | `totals.propertyCount`                                       | Real                                   | No own states; inherits route boundary                           |
| Strip stat: Needs action    | `:96-101`                                              | Count, destructive tint when > 0                                                                                         | `totals.totalAttention`                                      | Real                                   | Same                                                             |
| Strip stat: Avg rating      | `:102-106`                                             | 1-dp rating, `—` when 0                                                                                                  | `totals.overallAvgRating`                                    | Real                                   | Same                                                             |
| Property row (per entry)    | `FleetRow` `:111`, `:170-212`                          | Name, stars, avg rating, review count, rating trend arrow + %                                                            | `entry.name`, `avgRating`, `reviewCount`, `avgRatingTrend`   | Real                                   | No per-row skeleton                                              |
| Row: scan / response counts | `:196-211`                                             | `N scans`, `N responses`                                                                                                 | `entry.scanCount`, `feedbackCount`                           | Real; conditional on evidence presence | Renders nothing when `scanEvidence` / `feedbackEvidence` is null |
| Row: evidence badges        | `EvidenceBadge` `:154`, mounted `:195`, `:201`, `:209` | Freshness word; `title` tooltip carries definition version, completeness %, watermark, correction count, source policies | `entry.reviewEvidence` / `scanEvidence` / `feedbackEvidence` | Real                                   | n/a                                                              |
| Row: attention badge        | `:213-217` (approx., end of `FleetRow`)                | `N needing action` or `All clear`                                                                                        | `entry.totalAttention`                                       | Real                                   | Always renders one of the two                                    |

Route-level states (all three are wired):

| State   | Component                    | Wired at                              | Behaviour                                                                                      |
| ------- | ---------------------------- | ------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Loading | `FleetOverviewLoading` `:38` | `dashboard.tsx:41` `pendingComponent` | `LoadingState` — sr-only label, 1 header + 4 card + 1 large skeleton (`page-states.tsx:10-24`) |
| Error   | `FleetOverviewError` `:46`   | `dashboard.tsx:42` `errorComponent`   | `ErrorState` + "Try again" that invalidates `dashboardKeys.fleet()`                            |
| Empty   | `FleetOverviewEmpty` `:58`   | `dashboard.tsx:72`                    | "No properties yet" `:63` + import CTA gated on `property.import_gbp_v2`                       |

Computed and delivered to the browser but not rendered:

| Field                                           | Type location                   | Evidence of non-use                                                                                                                            |
| ----------------------------------------------- | ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `FleetEntry.attentionSignals` (5-way breakdown) | `dashboard/domain/types.ts:171` | Grep across `src/routes` + `src/components` matches only `fleet-overview-stories-data.ts:43,65,87,114`. `FleetRow` reads `totalAttention` only |
| `FleetEntry.slug`, `FleetEntry.timezone`        | `types.ts:158-160`              | Not referenced in `fleet-overview.tsx`                                                                                                         |
| `FleetOverviewData.nextCursor`                  | `types.ts:186`                  | `FleetOverview` destructures `{ entries, totals }` only (`:82`). No pagination control exists                                                  |

### 2.2 `/properties/$propertyId/` — `src/components/features/property/property-dashboard.tsx`

Three data sources: `getDashboardDataFn` and `getAttentionSignalsFn` (both primed in the loader, `index.tsx:42-48`), plus two client-side queries owned by their sections.

| #   | Widget                    | Component / line                                                    | Data displayed                                                                                        | Data source                                                              | Real or placeholder               | State coverage                                                                                                              |
| --- | ------------------------- | ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | --------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| 1   | Header + time-range group | `:60-91`                                                            | 7d/30d/60d/90d/all toggle                                                                             | `TIME_RANGE_OPTIONS` (`dashboard.dto.ts:11-17`), value from search param | Real                              | n/a                                                                                                                         |
| 2   | Attention band            | `AttentionBand` `:93`; `attention-band.tsx`                         | Up to 5 deep-linking chips: unanswered, items to triage, goals behind pace, rating dropped, escalated | `getAttentionSignalsFn`                                                  | Real                              | **Returns `null` when no chips** (`attention-band.tsx:132`). No skeleton, no empty state                                    |
| 3   | KPI cards ×4              | `KPICard` `:96,97,103,104`; `property-dashboard-helpers.tsx:41-70`  | Value + trend arrow + % (`—` when trend null)                                                         | `dashboard.kpis.{reviews,avgRating,scans,feedback}`                      | Real                              | **None.** No skeleton, no empty state; renders `0` / `—`                                                                    |
| 4   | Google performance        | `GooglePerformanceSection` `:107`; `google-performance-section.tsx` | 4 headline metrics, 2 area charts, daily-value tables, source status, range presets, refresh          | `getPropertyGooglePerformance` + `renewPropertyGooglePerformanceLease`   | Real                              | **Full.** Skeleton, hard error, retained error, authorization-lost alert, 4 unavailable reasons with CTA, empty-series copy |
| 5   | AI review trends          | `PropertyAiTrendSection` `:113`; `property-ai-trend-section.tsx`    | Direction badge, headline, ≤4 sentences (or summary), supporting review count, "largest change N pts" | `getPropertyAiTrendFn`                                                   | Real                              | **Partial — see 2.3.** No skeleton; two statuses render blank                                                               |
| 6   | Engagement funnel         | `:115-133`                                                          | Scans, Ratings, Review Clicks                                                                         | `dashboard.engagementFunnel`                                             | Real                              | **Renders nothing when null** (`:115`). No empty state                                                                      |
| 7   | Rating distribution       | `RatingDistributionChart` `:135`; helpers `:72-101`                 | 5 hand-rolled proportional bars                                                                       | `dashboard.ratingDistribution`                                           | Real; not built on `ui/chart.tsx` | **None.** Empty array renders a heading with no rows                                                                        |
| 8   | Reply performance         | `:137-158`                                                          | Reply rate %, avg reply time (`—` when null)                                                          | `dashboard.replyPerformance`                                             | Real                              | **None.** Always renders                                                                                                    |
| 9   | Recent reviews            | `:160-180`; `ReviewRow` in `property-dashboard-review-row.tsx`      | Rows + "View all" link to `/inbox`                                                                    | `dashboard.recentReviews`                                                | Real                              | **Empty state present** — dashed panel "No reviews yet." (`:173`). No skeleton                                              |

Route-level gaps for this route:

- `index.tsx:35-49` defines `validateSearch`, `staleTime`, `loaderDeps`, `loader`, `component` — **no `pendingComponent`, no `errorComponent`**. Loading and error fall through to an ancestor boundary.
- `PropertyDashboard` returns `null` when `property` is falsy (`:49`) — a blank page with no message.

Computed and delivered to the browser but not rendered:

| Field                        | Type location                   | Evidence of non-use                                                                                                                           |
| ---------------------------- | ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `DashboardData.ratingTrend`  | `dashboard/domain/types.ts:105` | Grep across `src/routes` + `src/components` matches only `property-dashboard-stories-data.ts:27,73`. No time-series chart exists on this page |
| `DashboardData.reviewVolume` | `types.ts:106`                  | Same grep matches only `property-dashboard-stories-data.ts:32,74`                                                                             |

### 2.3 AI trend section state matrix

`src/components/features/property/property-ai-trend-section.tsx`. The read returns `AiTrendReportRead` (`src/contexts/ai/application/ports/ai-output-store.port.ts:63-101`), a 6-variant union. The component handles four.

| Status                | Handling                   | Line      | Rendered output                                                                                                           |
| --------------------- | -------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------- |
| query `isPending`     | `return null`              | `:29`     | **Blank.** No skeleton                                                                                                    |
| `disabled`            | `return null`              | `:29`     | Blank (intentional)                                                                                                       |
| query `isError`       | Section with copy          | `:31-48`  | "Review trends are unavailable right now. The rest of the dashboard is unaffected." (`:42-43`)                            |
| `preparing`           | Section with copy          | `:50-68`  | "Building a trend after enough current review signals are available." (`:64`)                                             |
| `snapshot_superseded` | Same branch as `preparing` | `:52`     | Same copy                                                                                                                 |
| `insufficient_data`   | Falls to `:71` guard       | `:71`     | **Blank**                                                                                                                 |
| `no_material_change`  | Falls to `:71` guard       | `:71`     | **Blank**                                                                                                                 |
| `ready`               | Full card                  | `:75-107` | Direction badge (`:86`), headline, sentences or summary, "Based on N current reviews · largest change M pts" (`:103-104`) |

Fields present on the `ready` variant and not rendered: `dueLocalDate`, `terminalAnalysisSequence`, `aggregateRevision`, `reportProfileVersion`, `generatedAtEpochMillis`, `sourceEpoch`, `reviewAnalysisEpoch`, `propertyTrendsEpoch`, `propertyProfileVersion`, and `report.signalKey`.

---

## 3. Reviews page — three panels

Route `src/routes/_authenticated/properties/$propertyId/reviews.tsx` renders `InboxPageV2` (`src/components/inbox/inbox-page-v2.tsx`). `/inbox` (`src/routes/_authenticated/inbox/index.tsx`) renders the same component; the only difference is that `/reviews` supplies `activePropertyId` from the path and omits `propertyId` from the search schema (`reviews.tsx:16`).

Desktop layout: `PanelGroup direction="horizontal" autoSaveId="inbox-layout"` at `inbox-page-v2.tsx:144`.

| Panel       | Size                                                 | Component                  | File                                      | Contents                                                                                                                                                  |
| ----------- | ---------------------------------------------------- | -------------------------- | ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 — Folders | `defaultSize 20, min 15, max 30` (`:145`)            | `InboxSidebar` (`:146`)    | `src/components/layout/inbox-sidebar.tsx` | Back link to property dashboard, `PropertyFilterSelect`, Folders group with live counts from `getInboxFolderCountsFn`, Categories group (platform toggle) |
| 2 — List    | `defaultSize 30, min 20, max 50` (`:154`)            | `InboxListPanel` (`:155`)  | `inbox-list-panel-v2.tsx`                 | `InboxListHeader` (folder label, open-count badge, search, AI attention select), `BulkActionBar`, scrollable rows, `LoadMoreButton`                       |
| 3 — Detail  | `defaultSize 50, min 30` (`inbox-page-parts.tsx:69`) | `InboxDetailPane` (`:158`) | `inbox-page-parts.tsx:60-90`              | `InboxDetailPanel` when an item is selected, else `EmptyDetailPlaceholder`                                                                                |

Resize handles between panels at `:153` and `:157` (`ResizeHandle`, `inbox-page-parts.tsx:14-16`).

Mobile branch (`:102-141`): the list fills the viewport, panel 1 moves into a left `Sheet` drawer (`:106-138`), panel 3 becomes `InboxDetailSheet` (`:139`).

Pre-org state: `InboxNoOrgState` (`inbox-page-v2.tsx:52`, defined `inbox-page-parts.tsx:29-37`) — header only, no panels.

### 3.1 What panel 3 contains today

`InboxDetailPanel` (`inbox-detail-panel.tsx`) is a fixed header plus a scroll area:

- Header (`:38-62`): source icon, property name (falls back to the literal `<PropertyName>` at `:47`), platform, `InboxStatusBadge`, close button.
- Scroll area (`:63-88`) chooses one of three: error → message + Retry (`:64-70`); loading or no item → three skeleton bars (`:71-76`); otherwise `InboxDetailContent`.

`InboxDetailContent` (`inbox-detail-content.tsx`) renders, in order:

| Order | Section                                                | Line      | Gate                                                             |
| ----- | ------------------------------------------------------ | --------- | ---------------------------------------------------------------- |
| 1     | `InboxDetailSourceContent`                             | `:66`     | Always                                                           |
| 2     | `InboxReviewAnalysisPanel`                             | `:68`     | `sourceType === 'review'` (`:67`)                                |
| 3     | Timestamps row (reviewed/submitted, closed, escalated) | `:71-91`  | Always                                                           |
| 4     | Status + escalation action buttons                     | `:93-133` | Only when at least one action applies                            |
| 5     | `ReplyEditor`                                          | `:136`    | `sourceType === 'review' && can('reply.manage')` (`:135`, `:63`) |
| 6     | `InboxActivityTimeline`                                | `:146`    | Always                                                           |
| 7     | `InboxNotesThread`                                     | `:152`    | Always                                                           |

Source content (`inbox-detail-source-content.tsx`): reviewer avatar with `onError` fallback, name, date, stars, original review text (`:47-51`), Google translation under a "Translated by Google" divider (`:52-59`), and two content-unavailable panels for `expired` (`:84-90`) and `not_found` (`:93-96`).

### 3.2 AI affordances in panel 3 — exact locations

**A. AI review signals panel** — `src/components/inbox/inbox-review-analysis.tsx`, mounted at `inbox-detail-content.tsx:67-69`.

| Affordance          | Line         | Content                                                                                 |
| ------------------- | ------------ | --------------------------------------------------------------------------------------- |
| Suppressed entirely | `:21`        | `if (!analysis \|\| analysis.status === 'disabled') return null`                        |
| Pending state       | `:26`, `:28` | Heading "AI review signals"; "Analysis is pending for this review."                     |
| Unavailable state   | `:37`, `:39` | Heading; "Analysis is unavailable for this review language."                            |
| Attention badge     | `:49-51`     | `{analysis.attention} attention`; `destructive` variant when `urgent`, else `secondary` |
| Sentiment badge     | `:54`        | `{analysis.sentiment} sentiment`                                                        |
| Category badge      | `:55`        | `CATEGORY_LABELS[analysis.primaryCategory]`; label map at `:5-16`                       |
| Generated timestamp | `:58`        | `Generated {formatDateTime(...)}`                                                       |

The panel consumes only the four fields on the `ready` variant of `InboxReviewAnalysis` (`src/contexts/inbox/application/ports/ai-review-insights.port.ts:5-25`): `sentiment`, `primaryCategory`, `attention`, `generatedAtEpochMillis`.

**B. AI reply suggestion controls** — `src/components/inbox/reply-suggestion-controls.tsx`, mounted at `reply-editor-compose.tsx:56-57`, gated on `onGenerateSuggestion` being passed.

| Affordance              | Line       | Detail                                                                                                                                                                              |
| ----------------------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tone selector           | `:57-77`   | `Select`, `aria-label="Reply suggestion tone"` at `:63`, width `w-32`; options Professional / Friendly / Casual at `:71-73`; disabled while generating, saving, or adopting (`:60`) |
| "Suggest reply" button  | `:78-84`   | `Sparkles` icon `:82`; label toggles `'Suggesting…'` / `'Suggest reply'` at `:83`; `min-h-11`                                                                                       |
| Suggestion container    | `:86-125`  | `<section aria-label="AI reply suggestion">`, muted card                                                                                                                            |
| "AI suggestion" badge   | `:92`      | `variant="outline"`                                                                                                                                                                 |
| Governance status text  | `:94`      | "Review required. Nothing is saved or submitted automatically."                                                                                                                     |
| Suggestion body         | `:97`      | `whitespace-pre-wrap`                                                                                                                                                               |
| Separation status text  | `:100`     | "Suggestion text stays separate until you choose Use suggestion."                                                                                                                   |
| "Use suggestion" button | `:103-111` | Opens the confirm dialog                                                                                                                                                            |
| "Discard" button        | `:112-121` | Calls `clearSuggestion`                                                                                                                                                             |
| Confirm dialog          | `:127-176` | Title "Use this AI suggestion?" `:135`; body `:136-139`; side-by-side current draft vs AI suggestion `:141-153` ("AI suggestion" label at `:149`)                                   |
| Dialog error surface    | `:155-159` | `role="alert"`, `text-destructive`                                                                                                                                                  |
| Dialog confirm label    | `:172`     | `'Using suggestion…'` / `'Use suggestion'`                                                                                                                                          |
| Inline error surface    | `:178-182` | `role="status"`, muted, shown only when the dialog is closed                                                                                                                        |

**C. Error and unavailability vocabulary** — `src/components/inbox/use-reply-suggestion.ts`.

| Trigger                                       | Line     | Message                                                                     |
| --------------------------------------------- | -------- | --------------------------------------------------------------------------- |
| `language_not_supported`                      | `:35-36` | "A suggestion is not available for this review language."                   |
| `not_authorized`                              | `:37-38` | "AI reply suggestions are not enabled for this property."                   |
| `source_changed`                              | `:39-40` | "The review changed. Reload it before requesting a suggestion."             |
| Any other code                                | `:41`    | "A suggestion is unavailable right now. Try again."                         |
| Empty / over-length / already-expired payload | `:102`   | Same generic message                                                        |
| Thrown request                                | `:115`   | Same generic message                                                        |
| Draft changed before opening dialog           | `:131`   | "The draft changed. Request a new suggestion before replacing it."          |
| Draft changed before adopt                    | `:142`   | Same                                                                        |
| Adopt (draft save) failed                     | `:155`   | "The suggestion could not be used. Review the current draft and try again." |

Lifecycle: the suggestion self-clears at `expiresAtEpochMillis` (`:68-72`), on `pagehide` (`:75-78`), and whenever the composer text diverges from it.

**D. Where AI controls do and do not appear.** `resolveReplyView` (`reply-status-view.tsx:33-43`) maps a reply to one of eight views; only `kind: 'compose'` — no reply at all, or `status === 'draft'` (`:34`) — renders `ReplyCompose` (`:73-75`), which is the sole mount point for `ReplySuggestionControls`.

| Reply state                | View        | AI affordance                                               |
| -------------------------- | ----------- | ----------------------------------------------------------- |
| No reply / `draft`         | `compose`   | Tone selector, Suggest reply, adopt/discard, confirm dialog |
| `pending_approval`         | `pending`   | None                                                        |
| `approved`                 | `approved`  | None                                                        |
| `source === 'google_sync'` | `mirror`    | None                                                        |
| `published`                | `published` | None                                                        |
| `publish_failed`           | `failed`    | None                                                        |
| `rejected`                 | `rejected`  | None                                                        |

**E. Wiring path.** `inbox-detail-content.tsx:136` → `reply-editor.tsx` → `reply-form.tsx:104-116`, which calls `generateReplySuggestionFn` with `{ reviewId, tone, idempotencyKey: crypto.randomUUID() }` → `reply-status-view.tsx:73-82` → `reply-editor-compose.tsx:56`. The provenance token returned by the suggestion is threaded back into `draftReplyFn` at `reply-form.tsx:86` and `:95`.

**F. Wired-but-inert affordance.** `ReviewReplyRejected` renders an "Edit & Resubmit" button whose handler is `() => {}` (`reply-status-view.tsx:114`); the placeholder is documented at `reply-editor-actions.tsx:108-110`.

**G. AI attention filter (panel 2, not panel 3).** `inbox-list-header.tsx:68-92` — `Select` with `aria-label="Filter by AI attention"` at `:81`, options All signals / Urgent / High / Medium / Low. This is the only place AI analysis influences the list.

**H. Dead filter surface.** `InboxFilters` (`inbox-filters.tsx`) declares `attention` in `InboxFilterValues` (`:25`) but renders no control for it. The component is never mounted: grep for `inbox-filters` across `src` returns only its own story (`inbox-filters.stories.tsx:7`) and two type-only imports (`use-inbox-page.ts:7`, `use-inbox-state.ts:10`).

### 3.3 Panel state coverage

| Panel                     | Loading                                                          | Error                               | Empty                                                                                   |
| ------------------------- | ---------------------------------------------------------------- | ----------------------------------- | --------------------------------------------------------------------------------------- |
| 1 — Sidebar               | None; counts fall back to `DEFAULT_COUNTS`                       | None                                | n/a                                                                                     |
| 2 — List                  | `InboxListSkeleton`, 8 rows (`inbox-list-panel-parts.tsx:41-57`) | `InboxListError` + Retry (`:59-68`) | `InboxListEmpty` via `EmptyState` (`:70-80`)                                            |
| 3 — Detail, no selection  | n/a                                                              | n/a                                 | `EmptyDetailPlaceholder` (`inbox-page-parts.tsx:38-49`), "No message selected" at `:44` |
| 3 — Detail, item selected | 3 skeleton bars (`inbox-detail-panel.tsx:71-76`)                 | Message + Retry (`:64-70`)          | n/a                                                                                     |
| 3 — Activity timeline     | `TimelineSkeleton`, 3 rows                                       | `TimelineError`                     | `TimelineEmpty`, "No activity recorded yet."                                            |
| 3 — AI signals            | None (returns null while absent)                                 | None                                | "Analysis is pending" doubles as the empty state                                        |
| 3 — Reply editor          | `"Loading reply..."` text (`reply-form.tsx:69-75`)               | Toasts via `useActionMutation`      | Compose box is the empty state                                                          |

---

## 4. Data that exists in the database with no UI consumer

### 4.1 Proof method

Routes and components never import Drizzle tables — the hexagonal boundary forbids it. Two greps establish non-consumption:

**Grep A — table symbols**, roots `src/routes` and `src/components`:

```
pattern: aiPropertyDailyAggregates|aiPropertyAggregateContributions|aiPropertyAggregateHeads|
         aiPropertyTrendSchedules|aiPropertyTrendOutcomes|aiPropertyTrendSchedulerHeads|
         aiReviewAnalyses|aiExecutionPermits|aiExecutionPermitSettlements|
         aiOrganizationCostWindows|aiPropertyQuotaWindows|aiAdmissionCostReservations|
         aiAdmissionProductConsumptions|aiProductVolumeConsumptions|aiOperations|
         aiOperationAttempts|rollupDailyMetrics|rollupWeeklyMetrics|rollupDailyInboxMetrics|
         metricReadings|metricCorrections|metricQuarantine|reviewAiAnalysisHeads
result:  No matches found
```

**Grep B — column and DTO field names**, same roots:

```
pattern: sentimentLabel|sentimentScore|urgentCount|highCount|mediumCount|lowCount|
         positiveCount|negativeCount|neutralCount|mixedCount|serviceCount|cleanlinessCount|
         waitTimeCount|atmosphereCount|accessibilityCount|costMicros|inputTokens|outputTokens|
         reasoningTokens|cachedInputTokens|originOperationId|originReplyTemplateId|
         originConcreteLanguageTag|aiDraftExpiresAt|authorship|dueLocalDate|selectedSignalIds|signalKey
result:  1 file — property-dashboard.stories.tsx:39 (dueLocalDate), :44 (signalKey)
         Both are Storybook fixture literals, not rendered UI.
```

There are no database views: grep for `pgView|pgMaterializedView|MATERIALIZED VIEW` across `src/shared/db` returns no matches. Every aggregate is a physical table maintained by application code.

### 4.2 AI analysis output

| Table                                              | Schema line              | Unsurfaced columns                                                                                                                                                                                        | Status                                                                                                                                                                                                                                             |
| -------------------------------------------------- | ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ai_review_analyses`                               | `ai.schema.ts:1455`      | `operationId`, `authorizationLineageId`, `reviewAnalysisEpoch`, `propertyProfileVersion`, `analysisProfileVersion`, `sourceEpoch`, `sourceRevision`, `analysisSequence`, `expiresAt`, `unavailableReason` | Partially surfaced. Only `sentiment` (`:1470`), `primaryCategory` (`:1471`), `attention` (`:1472`), `generatedAt` reach the UI, via `InboxReviewAnalysis`. `unavailableReason` is collapsed into one copy string at `inbox-review-analysis.tsx:39` |
| `ai_review_analysis_outcomes`                      | `ai.schema.ts:469`       | `state`, `dispositionCode` (`source_expired`, `provider_deleted`, `policy_disabled`, `language_not_supported`), `appliedAggregateRevision`, `appliedAt`, `eventEnvelopeId`                                | Not surfaced. Grep A: no match                                                                                                                                                                                                                     |
| `review_ai_analysis_heads`                         | `review.schema.ts:171`   | `headSequence`, `sourceEpoch`                                                                                                                                                                             | Not surfaced. Grep A: no match                                                                                                                                                                                                                     |
| `reviews.sentimentLabel`, `reviews.sentimentScore` | `review.schema.ts:71-72` | Both                                                                                                                                                                                                      | Not surfaced. Legacy per-review sentiment columns, distinct from the AI plane. Grep B: no match                                                                                                                                                    |
| `reviews.languageCode`                             | `review.schema.ts:69`    | The column                                                                                                                                                                                                | Not surfaced anywhere in the UI                                                                                                                                                                                                                    |

### 4.3 Aggregates

| Table                                 | Schema line           | Columns                                                                                                                                                                                                                                                                                                                                                                                               | Status                                                                                                                                                                                                                                                 |
| ------------------------------------- | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ai_property_daily_aggregates`        | `ai.schema.ts:1655`   | `reviewCount`, `ratingSum`; sentiment `positiveCount`/`neutralCount`/`negativeCount`/`mixedCount`; 10 category counts (`serviceCount`, `staffCount`, `qualityCount`, `valueCount`, `cleanlinessCount`, `waitTimeCount`, `atmosphereCount`, `locationCount`, `accessibilityCount`, `otherCount`); attention `urgentCount`/`highCount`/`mediumCount`/`lowCount` — 20 count columns keyed by `localDate` | **Zero UI.** Only consumer is `src/contexts/ai/infrastructure/adapters/ai-property-aggregate-store.adapter.ts` (insert `:451`, select-for-update `:471`, update `:506`, read `:774`). Grep A: no match                                                 |
| `ai_property_aggregate_contributions` | `ai.schema.ts:1531`   | Per-review `sentiment` (`:1542`), `primaryCategory` (`:1543`), `attention` (`:1544`), `rating`, `localDate`, `appliedAggregateRevision`, `appliedAt`                                                                                                                                                                                                                                                  | Zero UI. Grep A: no match                                                                                                                                                                                                                              |
| `ai_property_aggregate_heads`         | `ai.schema.ts:1602`   | `aggregateRevision`, `terminalAnalysisSequence`                                                                                                                                                                                                                                                                                                                                                       | Zero UI. Grep A: no match                                                                                                                                                                                                                              |
| `rollup_daily_metrics`                | `rollup.schema.ts:10` | `metricKey`, `date`, `count`, `sumValue`, `avgValue`                                                                                                                                                                                                                                                                                                                                                  | **Written, never read.** Writer: `src/contexts/metric/infrastructure/incremental-rollup.ts:96-118`. Grep across all of `src` returns only the writer, its idempotency test, `migration-verification.test.ts:102`, the schema file, and the parity test |
| `rollup_weekly_metrics`               | `rollup.schema.ts:29` | `week`, `count`, `sumValue`, `avgValue`                                                                                                                                                                                                                                                                                                                                                               | Written by `incremental-rollup.ts:147-171`, never read                                                                                                                                                                                                 |
| `rollup_daily_inbox_metrics`          | `rollup.schema.ts:48` | `openCount`, `closedCount`, `escalatedCount`, `avgResponseHours`                                                                                                                                                                                                                                                                                                                                      | Written by `incremental-rollup.ts:198-219`, never read. `avgResponseHours` has no reader anywhere                                                                                                                                                      |
| `_rollup_watermarks`                  | `rollup.schema.ts:63` | `name`, `watermark`                                                                                                                                                                                                                                                                                                                                                                                   | Internal to the refresh job                                                                                                                                                                                                                            |

### 4.4 Trend signals and schedules

| Table                               | Schema line         | Unsurfaced columns                                                                                                                                                                              | Status                                                                                                                                                                                                                                         |
| ----------------------------------- | ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ai_property_trend_outcomes`        | `ai.schema.ts:1832` | `selectedSignalIds`, `signalKey`, `renderProfileVersion`, `renderProfileDigest`, `providerSelectionRecordedAt`, `expiresAt`, `disposition`, `operationId`                                       | Partially surfaced. UI shows `direction`, `headline`, `sentences`, `summary`, `supportingReviewCount`, `confidenceBasisPoints`. The table is indexed `recordedAt desc` (`:1884`) but only the current row is ever read — no history is exposed |
| `ai_property_trend_schedules`       | `ai.schema.ts:1774` | `dueLocalDate`, `timezone`, `sourceEpoch`, `reviewAnalysisEpoch`, `propertyTrendsEpoch`, `terminalAnalysisSequence`, `aggregateRevision`, `schedulerGeneration`, `scheduledAt`, `outboxEventId` | Zero UI. Consumers are `ai-property-trend-schedule-store.adapter.ts:181` and `ai-output-store.adapter.ts:702-715`, `:1288-1337`. Grep A: no match                                                                                              |
| `ai_property_trend_scheduler_heads` | `ai.schema.ts:1760` | `generation`, `cursorOrganizationId`, `cursorPropertyId`, `leaseOwner`, `claimedAt`, `leaseExpiresAt`                                                                                           | Zero UI. Lease/cursor state is entirely invisible                                                                                                                                                                                              |

### 4.5 Reply provenance

`replies` (`review.schema.ts:444`) carries a 15-column AI provenance block at `:461-484`:

`authorship`, `aiGenerated`, `originOperationId`, `originSourceEpoch`, `originSourceRevision`, `originBaseReplyStateRevision`, `originReplyDraftingEpoch`, `originPropertyProfileVersion`, `originAiProfileVersion`, `originReplyTemplateId`, `originReplyTemplateCatalogueVersion`, `originReplyTemplateCatalogueDigest`, `originConcreteLanguageTag`, `originTemplateGroup`, `aiDraftExpiresAt`.

None of it reaches the UI. Both read-only reply view modules narrow the reply to a three-field shape:

- `reply-editor-views.tsx:10-13` — `type ReplyView = { text, publishedAt, rejectionReason }`
- `reply-editor-actions.tsx:8-11` — identical shape

Grep for `aiGenerated|ai_generated|ai_assisted|AI-assisted` across `src/components` and `src/routes` matches only Storybook fixtures (`reply-editor.stories.tsx:30`, `reply-form.stories.tsx:37`) and unrelated settings copy (`settings/ai.tsx:60`). Consequence of record: a published AI-assisted reply renders identically to a human-written one.

Publication machine columns are also unsurfaced: `publicationState`, `publicationAttempts`, `publicationLastErrorClass`, `reconcileDueAt` (`review.schema.ts:493-497`). The failure UI shows one fixed sentence — "Failed to publish to Google. You can retry." (`reply-editor-actions.tsx:96`) — regardless of `publicationLastErrorClass`.

### 4.6 Permit, settlement, cost and token accounting

Every table below has zero UI consumer (Grep A and Grep B both return no match). The AI settings pages surface none of it either: grep for `quota|cost|token|analysisCount|replyCount|remaining|Micros` across `src/components/features/settings` returns no matches.

| Table                               | Schema line         | Notable columns                                                                                                                                                                                                                                                                                |
| ----------------------------------- | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ai_execution_permits`              | `ai.schema.ts:967`  | `route`, `state` (issued/consumed/settled/released/ambiguous), `admittedAt`, `consumedAt`, `concurrencyExpiresAt`, `expiresAt`, `maximumCostMicros`                                                                                                                                            |
| `ai_execution_permit_settlements`   | `ai.schema.ts:1044` | `inputTokens`, `cachedInputTokens`, `outputTokens`, `reasoningTokens`, `costMicros`, `disposition` and `reportedDisposition` (11 values each), `usageKnown`, `providerRetryable`, `retryAfterSeconds`, `settlementState`, `terminalState`, `settledAt`                                         |
| `ai_property_quota_windows`         | `ai.schema.ts:1129` | `analysisCount` (CHECK caps at 500), `replyCount` (caps at 100), `reservedCostMicros`, `settledCostMicros`, `localDate`, `timezone`, `generation`, pending-transition columns                                                                                                                  |
| `ai_organization_cost_windows`      | `ai.schema.ts:1182` | `reservedCostMicros`, `settledCostMicros` per org per `utcDate`                                                                                                                                                                                                                                |
| `ai_admission_cost_reservations`    | `ai.schema.ts:1212` | `maximumCostMicros`, `actualCostMicros`, `state`, `settledAt`, `releaseSha`                                                                                                                                                                                                                    |
| `ai_admission_product_consumptions` | `ai.schema.ts:1099` | `capability` (`review_analysis` / `reply_drafting`), `propertyWindowGeneration`, `accountedAt`                                                                                                                                                                                                 |
| `ai_product_volume_consumptions`    | `ai.schema.ts:932`  | Per-operation volume accounting                                                                                                                                                                                                                                                                |
| `ai_operations`                     | `ai.schema.ts:664`  | The full operation ledger: `state`, `failureCode`, `executionAttempt`, `nextAttemptAt`, `tone`, `evaluatedLanguage`, `concreteReplyLanguageTag`, `replyAdoptionDisposition`, `adoptedReplyRevision`, `deliveredAt`, `expiresAt`, `noticeVersion`, `noticeDigest`, plus ~20 profile/digest pins |
| `ai_operation_attempts`             | `ai.schema.ts:899`  | Per-attempt records                                                                                                                                                                                                                                                                            |

A user cannot see how much AI quota they have consumed, how close they are to the 500-analysis or 100-reply daily caps, what any operation cost, or why an operation failed.

### 4.7 Metric plane

| Table                        | Schema line            | Status                                                                                                          |
| ---------------------------- | ---------------------- | --------------------------------------------------------------------------------------------------------------- |
| `metric_definitions`         | `metric.schema.ts:26`  | No UI. The `/properties/$propertyId/metrics` route is a hardcoded `EmptyState` (`metrics.tsx:35`)               |
| `metric_definition_versions` | `metric.schema.ts:65`  | No UI, except that `definitionVersionId` appears inside a badge `title` tooltip at `fleet-overview.tsx:129-143` |
| `metric_readings`            | `metric.schema.ts:124` | No UI. Grep A: no match                                                                                         |
| `metric_corrections`         | `metric.schema.ts:200` | Only `correctionCount` reaches the same tooltip                                                                 |
| `metric_quarantine`          | `metric.schema.ts:251` | No UI at all                                                                                                    |
| `metric_source_watermarks`   | `metric.schema.ts:280` | Only `watermark` reaches the same tooltip                                                                       |

The fleet evidence tooltip (`metricEvidenceTitle`, `fleet-overview.tsx:129-143`) is the single place any metric governance data is visible, and it is a `title` attribute — not keyboard-reachable, not screen-reader-reliable, and truncated by the browser.

### 4.8 Other unsurfaced review tables

| Table                                       | Schema line            | Status                                                           |
| ------------------------------------------- | ---------------------- | ---------------------------------------------------------------- |
| `review_source_provenance_quarantine`       | `review.schema.ts:148` | No UI. `reason` is `missing_property` or `cross_tenant_property` |
| `review_provider_snapshot_runs`             | `review.schema.ts:236` | No UI                                                            |
| `review_provider_subjects`                  | `review.schema.ts:303` | No UI                                                            |
| `review_provider_snapshot_members`          | `review.schema.ts:385` | No UI                                                            |
| `review_provider_deletion_candidates`       | `review.schema.ts:406` | No UI                                                            |
| `review_provider_subject_hmac_key_versions` | `review.schema.ts:202` | No UI                                                            |

### 4.9 Translation versus original text

This is one of the few AI-adjacent fields that **is** surfaced. `reviews.text` holds the guest's original and `reviews.translatedText` holds Google's machine translation (`review.schema.ts:63-69`, with the parsing rationale in the comment above). Both render in panel 3: original at `inbox-detail-source-content.tsx:47-51`, translation under a "Translated by Google" divider at `:52-59`. `reviews.languageCode` (`:69`) is not surfaced.

---

## 5. Performance reporting and trend analysis: UI today versus schema capability

### 5.1 What exists

| Surface                             | Component                               | Visualisation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Source of data                                                                         |
| ----------------------------------- | --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Google Business Profile performance | `google-performance-report.tsx`         | Source-status strip (state badge, source label, retrieved-at, timezone, period, Google data lag, content expiry); "At a glance" card with 4 metrics — `totalProfileImpressions`, `websiteClicks`, `callClicks`, `directionRequests` — each with delta %, complete-day coverage counts and a `Partial` badge; two Recharts `AreaChart` panels ("How people found you", "Customer actions") with legend and tooltip; a `<details>` "View daily values" `Table` per chart; an "Additional interactions" card | Google, via `getPropertyGooglePerformance`. Presets 7d/30d/90d/180d                    |
| AI review trends                    | `property-ai-trend-section.tsx`         | One narrative card: direction badge, headline, ≤4 sentences (or summary), "Based on N current reviews · largest change M pts"                                                                                                                                                                                                                                                                                                                                                                             | `ai_property_trend_outcomes`, current row only                                         |
| Rating distribution                 | `property-dashboard-helpers.tsx:72-101` | 5 hand-rolled proportional `div` bars                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | `dashboard.ratingDistribution`                                                         |
| KPIs                                | `property-dashboard-helpers.tsx:41-70`  | 4 scalars + period-over-period %                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | `dashboard.kpis`                                                                       |
| Reply performance                   | `property-dashboard.tsx:137-158`        | 2 scalars (reply rate %, avg reply hours)                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | `dashboard.replyPerformance`                                                           |
| Engagement funnel                   | `property-dashboard.tsx:115-133`        | 3 scalars                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | `dashboard.engagementFunnel`                                                           |
| Portal analytics                    | `portal-analytics-tab.tsx:117-122`      | `RatingTrendChart` via `ui/chart`                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | `getPortalAnalyticsFn` — a different route (portal detail), not the property dashboard |

The only first-party time series on the property dashboard is the Google-sourced one. Every RepKey-owned number on that page is a scalar or a static 5-bucket bar set.

### 5.2 Aggregates the schema already maintains and no UI reads

| Available dimension                  | Physical location                                                                                                                | Granularity                                                         |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Review volume and rating sum per day | `ai_property_daily_aggregates.reviewCount`, `.ratingSum`                                                                         | Property-local date                                                 |
| Sentiment mix per day                | `.positiveCount`, `.neutralCount`, `.negativeCount`, `.mixedCount`                                                               | Property-local date; CHECK guarantees the four sum to `reviewCount` |
| Category breakdown per day           | 10 columns, `.serviceCount` … `.otherCount`                                                                                      | Property-local date; CHECK guarantees the ten sum to `reviewCount`  |
| Attention distribution per day       | `.urgentCount`, `.highCount`, `.mediumCount`, `.lowCount`                                                                        | Property-local date; CHECK guarantees the four sum to `reviewCount` |
| Per-review attributed signal         | `ai_property_aggregate_contributions` (`sentiment`, `primaryCategory`, `attention`, `rating`, `localDate`)                       | Per review                                                          |
| Generic metric rollups               | `rollup_daily_metrics`, `rollup_weekly_metrics` (`count`, `sumValue`, `avgValue` by `metricKey`)                                 | Day and ISO week, by org / property / portal                        |
| Inbox throughput                     | `rollup_daily_inbox_metrics` (`openCount`, `closedCount`, `escalatedCount`, `avgResponseHours`)                                  | Day                                                                 |
| Trend history                        | `ai_property_trend_outcomes`, index `ai_property_trend_outcomes_property_idx` on `(organizationId, propertyId, recordedAt desc)` | Per scheduled run                                                   |
| Quota and cost burn                  | `ai_property_quota_windows` (`analysisCount`/500, `replyCount`/100, `settledCostMicros`), `ai_organization_cost_windows`         | Property-local day; org UTC day                                     |
| Token accounting                     | `ai_execution_permit_settlements` (`inputTokens`, `cachedInputTokens`, `outputTokens`, `reasoningTokens`, `costMicros`)          | Per settled permit                                                  |

Also computed and shipped to the browser today but discarded by the render: `DashboardData.ratingTrend` and `DashboardData.reviewVolume` (both `dashboard/domain/types.ts:105-106`).

---

## 6. shadcn/ui primitive inventory

`src/components/ui/` — 29 component modules plus 11 story files.

| Primitive                                                                                                                             | File                |
| ------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| Alert                                                                                                                                 | `alert.tsx`         |
| Alert dialog                                                                                                                          | `alert-dialog.tsx`  |
| Badge                                                                                                                                 | `badge.tsx`         |
| Breadcrumb                                                                                                                            | `breadcrumb.tsx`    |
| Button                                                                                                                                | `button.tsx`        |
| Card                                                                                                                                  | `card.tsx`          |
| Chart (Recharts wrapper: `ChartContainer`, `ChartTooltip`, `ChartTooltipContent`, `ChartLegend`, `ChartLegendContent`, `ChartConfig`) | `chart.tsx`         |
| Checkbox                                                                                                                              | `checkbox.tsx`      |
| Color picker                                                                                                                          | `color-picker.tsx`  |
| Copy button                                                                                                                           | `copy-button.tsx`   |
| Dialog                                                                                                                                | `dialog.tsx`        |
| Dropdown menu                                                                                                                         | `dropdown-menu.tsx` |
| Empty state                                                                                                                           | `empty-state.tsx`   |
| Field                                                                                                                                 | `field.tsx`         |
| Input                                                                                                                                 | `input.tsx`         |
| Label                                                                                                                                 | `label.tsx`         |
| Popover                                                                                                                               | `popover.tsx`       |
| Select                                                                                                                                | `select.tsx`        |
| Separator                                                                                                                             | `separator.tsx`     |
| Sheet                                                                                                                                 | `sheet.tsx`         |
| Sidebar                                                                                                                               | `sidebar.tsx`       |
| Skeleton                                                                                                                              | `skeleton.tsx`      |
| Sonner (toast)                                                                                                                        | `sonner.tsx`        |
| Switch                                                                                                                                | `switch.tsx`        |
| Table                                                                                                                                 | `table.tsx`         |
| Tabs                                                                                                                                  | `tabs.tsx`          |
| Textarea                                                                                                                              | `textarea.tsx`      |
| Tooltip                                                                                                                               | `tooltip.tsx`       |

Story files present: `simple-visual`, `overlays`, `inputs-nav`, `form-controls`, `data-display`, `complex`, plus per-component stories for `skeleton`, `alert`, `badge`, `button`, `card`.

Notes of record:

- `src/components/CONTEXT.md:79` states all charts use `src/components/ui/chart.tsx`. Three modules comply: `google-performance-chart.tsx:11`, `portal-analytics-charts.tsx:19`, `goal-trajectory-graph.tsx:7`. `RatingDistributionChart` (`property-dashboard-helpers.tsx:72-101`) does not — it is hand-rolled `div` bars.
- Panel resizing uses `react-resizable-panels` directly (`inbox-page-v2.tsx:12`); there is no `ui/resizable.tsx` wrapper.
- Not present in `src/components/ui/`: accordion, avatar, calendar, carousel, collapsible, command, context-menu, drawer, form, hover-card, input-otp, menubar, navigation-menu, pagination, progress, radio-group, resizable, scroll-area, slider, toggle, toggle-group.

---

## 7. Summary of placeholder and blank-render sites

| Location                                             | File:line                                                                  | Behaviour                                             |
| ---------------------------------------------------- | -------------------------------------------------------------------------- | ----------------------------------------------------- |
| Metrics route                                        | `metrics.tsx:35`                                                           | Entire page is "Metrics coming soon" `EmptyState`     |
| Rejected reply "Edit & Resubmit"                     | `reply-status-view.tsx:114`; documented `reply-editor-actions.tsx:108-110` | Button renders, handler is `() => {}`                 |
| Detail header property name                          | `inbox-detail-panel.tsx:47`                                                | Falls back to the literal string `<PropertyName>`     |
| AI trend, loading                                    | `property-ai-trend-section.tsx:29`                                         | Blank; no skeleton                                    |
| AI trend, `insufficient_data` / `no_material_change` | `property-ai-trend-section.tsx:71`                                         | Blank                                                 |
| Attention band, all-clear                            | `attention-band.tsx:132`                                                   | Blank                                                 |
| Engagement funnel, null                              | `property-dashboard.tsx:115`                                               | Blank                                                 |
| Property dashboard, no property                      | `property-dashboard.tsx:49`                                                | Blank page                                            |
| Property dashboard route boundaries                  | `index.tsx:35-49`                                                          | No `pendingComponent`, no `errorComponent`            |
| KPI cards, rating distribution, reply performance    | `property-dashboard.tsx:96-104`, `:135`, `:137-158`                        | No skeleton and no empty state; render zeroes and `—` |
