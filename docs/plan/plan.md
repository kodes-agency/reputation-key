# Neon Reputation — Phased Build Plan

> **Completed phases (1–9) archived in** `docs/plan/archive/phases-1-9-completed.md`.
> **Original full plan preserved in** `docs/plan/archive/plan-full-original.md`.

## Philosophy

This plan is a sequence of small, verifiable increments. Each phase ends with a **gate** — a set of concrete checks you can perform to decide whether the phase is actually done, not just "I think it's done." You don't move on until the gate passes.

**Priorities in order:** correctness, testability, cleanliness, speed. Never trade the first three for the fourth.

**Rule of thumb:** a phase that takes 50% longer than expected because you're doing it right is fine. A phase that ships with unknown behavior is not.

**Every phase produces:** working code, passing tests, a git commit. No phase ends with half-working code or "we'll fix that later" todos.

---

## Completed

**Arc 1 — Foundation (Phases 1–4):** Repo setup, auth, organizations, testing infrastructure.
**Arc 2 — Core Domain (Phases 5–6):** Property context, teams + staff.
**Arc 3 — Portal & Guest (Phases 7–9):** Portal builder, public portal + scan tracking, rating + feedback.

See `docs/plan/archive/phases-1-9-completed.md` for details.

---

## Arc 4 — Reviews (Phases 10-12)

The product becomes a reputation management tool. Reviews come in from Google, managers see them in an inbox, they can reply.

### Phase 10 — Review schema and GBP sync (read-only)

**Goal.** Reviews are automatically imported from Google Business Profile every 15 minutes. They appear in the database with sentiment fields blank (Arc 7 adds AI). No inbox UI yet — just the sync mechanism.

**Why now.** Reviews are the product's core data. The inbox depends on them. AI features operate on them. Metrics depend on review events.

**Scope (in).**

- `contexts/review/` with full layer structure
- `shared/db/schema/review.schema.ts` with full review table (see features-and-tasks-v2 for exact fields)
- `contexts/review/domain/platform.port.ts` — `ReviewPlatformAdapter` interface
- `contexts/review/infrastructure/platforms/google.adapter.ts` — implements the port using GBP API v1
- Service account authentication for GBP
- `contexts/review/infrastructure/jobs/sync-reviews.job.ts` — BullMQ job that syncs per property
- BullMQ repeatable job: every 15 minutes, enqueue sync job for each property with GBP configured
- Per-organization job fairness (a Marriott tenant doesn't block small tenants)
- GBP rate limit handling: respect `Retry-After`, exponential backoff, spread syncs across the 15-min window
- Deduplication on `(platform, external_id)`
- `review.received` event emitted for new reviews
- Manual sync trigger on property settings page
- GBP connection status indicator on property settings
- Tests: adapter in integration test with mocked GBP responses, sync job with mock adapter, dedup behavior

**Scope (out).**

- Inbox UI (Phase 11)
- Reply publishing (Phase 12)
- Sentiment analysis (Arc 7)
- TripAdvisor sync (out of scope — TripAdvisor has no public API)

**Gate criteria.**

- Property configured with GBP place ID syncs reviews automatically every 15 minutes
- New reviews appear in the database with all fields mapped correctly
- Duplicate reviews are not re-inserted
- `review.received` events fire for new reviews only
- Manual sync trigger works
- GBP rate limit errors are handled gracefully — job retries with backoff, doesn't fail the whole queue
- Multiple tenants' syncs run in parallel but don't starve each other
- Tests: mock GBP returns, verify correct DB state; mock GBP returns 429, verify retry behavior; mock GBP returns malformed data, verify graceful handling

**Open questions to resolve during this phase.**

- Exact GBP API authentication flow (service account vs OAuth — service account is simpler for MVP)
- Where GBP service account credentials are stored (secrets in Railway, never in code)
- How to bootstrap a property's GBP connection (UI flow: user pastes place ID, we verify by calling GBP API)

**Rough effort.** 7-10 days. GBP API has quirks, rate limiting is non-trivial, and the sync job needs real care to handle failure modes.

**Phase after this.** Inbox.

---

### Phase 11 — Unified inbox (reviews + feedback)

**Goal.** Managers see all reviews and all private feedback in a single unified list. They can filter, sort, mark as read, escalate, and open individual items to see details.

**Why now.** The inbox is where managers spend most of their time. It's the core value delivery. It has to feel good.

**Scope (in).**

- Inbox server functions: `getInboxItems` (paginated, filtered), status update functions
- Unified query: reviews + feedback joined into one list with a discriminator column
- Filtering: property, rating range, status, platform, date range, source
- Sorting: date, rating, status
- Bulk actions: mark read, mark addressed, assign to team member (assignment to user ID)
- Review detail view: full text, reviewer name, platform, date, quick reply input (reply flow in Phase 12)
- Feedback detail view: rating, comment, category, portal, date, internal notes
- Status workflow: new → read → replied → escalated → archived
- Tests: unit tests for filter/sort logic, integration tests for the combined query, E2E for a manager reviewing their inbox

**Scope (out).**

- Reply creation/approval/publishing (Phase 12)
- Sentiment badges (Arc 7 — placeholder until then)
- Priority score (Arc 7 — placeholder)
- Export to CSV (Arc 8)

**Gate criteria.**

- Manager can see all reviews and feedback in one list, sortable and filterable
- Status transitions work correctly (can't go from "new" to "published" directly, must go through intermediate states)
- Bulk actions work on multiple selected items
- Pagination handles 1000+ items without performance issues (cursor-based pagination, tested)
- Tenant isolation: inbox only shows items from current organization
- Role check: Staff sees only items related to their assigned properties; PropertyManager sees their assigned properties; AccountAdmin sees all
- E2E test: manager logs in, sees inbox with test data, filters to 2-star reviews, marks one as read, escalates another

**Open questions to resolve during this phase.**

- Default sort (suggest: newest first)
- Default filters on first load (suggest: status = new, all properties visible to role)
- Whether to show unread count badge on the nav (yes, polls or uses cache)

**Rough effort.** 5-7 days. UI-heavy but architecturally straightforward.

**Phase after this.** Reply flow.

---

### Phase 12 — Reply flow

**Goal.** Managers can draft, submit, approve, reject, and publish replies to reviews. Published replies are pushed to Google via the GBP adapter. The approval workflow is enforced.

**Why now.** Without reply publishing, we're just a read-only review viewer. This completes the core review management loop.

**Scope (in).**

- `replies` table schema
- Full reply lifecycle use cases: create draft, edit, submit for approval, approve, reject, publish
- CHECK constraint: exactly one of review_id or feedback_id is set
- Reply UI: inline editor in inbox detail view, approval queue for managers, reply history timeline
- Character counter (Google limit: 4096)
- Publish to Google via `replyToReview` method on the Google adapter (added in Phase 10, now fully exercised)
- Publish error handling: retry with exponential backoff via BullMQ job, notify manager on final failure
- `reply.published` event emitted on success
- Tests: full lifecycle test (draft → approved → published → verified pushed to Google mock), rejection path, error handling

**Scope (out).**

- AI reply drafting (Arc 7)
- Reply templates (later, if needed)

**Gate criteria.**

- AccountAdmin or PropertyManager can draft a reply
- Reply status transitions are enforced: can only approve from pending_approval, can only publish from approved
- Only PropertyManager+ can approve
- Approved reply publishes to Google within 1 minute (via job)
- Publish failures retry up to 3 times with exponential backoff, then notify the manager
- Published timestamp is recorded
- Character limit enforced at domain level
- AI-generated replies are flagged (field exists; Arc 7 sets it to true when applicable)
- All tests pass
- E2E test: PropertyManager drafts a reply → submits → AccountAdmin approves → reply publishes (verified via mock GBP) → reply appears as "published" in UI

**Open questions to resolve during this phase.**

- Whether rejected replies can be edited and resubmitted (yes — draft status again)
- Whether approvers can be notified of pending approvals (yes — Phase 16.1)
- Auto-approval for AccountAdmins (i.e., their drafts skip approval) — suggest no, keep the workflow uniform for clarity

**Rough effort.** 5-6 days.

**Phase after this.** Metrics foundation.

---

## Arc 5 — Metrics and Dashboard (Phases 13-14)

Now we have events flowing. Metrics captures them into structured data that the dashboard can visualize.

### Phase 13 — Metrics foundation

**Goal.** Guest and review events are captured as raw metric readings. Aggregations are pre-computed via materialized views. The metrics pipeline is tenant-isolated and testable.

**Why now.** The dashboard depends on metrics. Goals and gamification depend on metrics. Conversion analytics depends on metrics.

**Scope (in).**

- **Metric context: `contexts/metric/`** with standard layer structure
  - `domain/types.ts` — `MetricKey`, `EntityLevel`, `ValueType` types
  - `application/ports/metric.repository.ts` — insert reading, query aggregates
  - `application/use-cases/record-metric.ts` — validates metric_key against definitions, inserts reading
  - `infrastructure/event-handlers/` — 5 handlers subscribing to guest + review events
  - `infrastructure/jobs/` — 3 refresh jobs for materialized views
  - `infrastructure/repositories/metric.repository.ts` — Drizzle implementation
  - `build.ts` — wires deps, returns public API

- **Schema: `shared/db/schema/metric.schema.ts`**
  - `metric_definitions` table: `id, metric_key (unique), display_name, entity_level ('portal'|'property'), value_type ('count'|'rating'), description`
  - `metric_readings` table: `id, organizationId, propertyId, portalId (nullable), groupId (nullable), metric_key, value (real), recorded_at (timestamptz)`
  - Index on `(organization_id, metric_key, recorded_at)` for dashboard queries
  - No partitioning at MVP scale (deferred to Phase 21)

- **Seed: 5 built-in metric definitions**

| `metric_key`               | `display_name`            | `entity_level` | `value_type` |
| -------------------------- | ------------------------- | -------------- | ------------ |
| `portal.scan`              | Portal Scans              | portal         | count        |
| `portal.rating`            | Portal Ratings            | portal         | rating       |
| `portal.feedback`          | Portal Feedback           | portal         | count        |
| `portal.review_link_click` | Portal Review Link Clicks | portal         | count        |
| `property.review`          | Property Reviews          | property       | rating       |

- **5 event handlers** (raw readings only, aggregates computed by materialized views):

| Event `_tag`          | `metric_key`               | Raw `value`      |
| --------------------- | -------------------------- | ---------------- |
| `scan.recorded`       | `portal.scan`              | `1`              |
| `rating.submitted`    | `portal.rating`            | star value (1-5) |
| `feedback.submitted`  | `portal.feedback`          | `1`              |
| `review-link.clicked` | `portal.review_link_click` | `1`              |
| `review.created`      | `property.review`          | star value (1-5) |

- **3 materialized views** (raw SQL migrations):
  - `mv_daily_metrics` — one row per `(org_id, property_id, portal_id, metric_key, date)` with `count, sum_value, avg_value`
  - `mv_weekly_metrics` — same shape aggregated by ISO week
  - `mv_daily_inbox_metrics` — computed directly from `inbox_items` table (no metric readings): `new_count, addressed_count, avg_response_hours`

- **3 background jobs:**
  - `refreshDailyMetrics` (hourly) — `REFRESH MATERIALIZED VIEW mv_daily_metrics`
  - `refreshWeeklyMetrics` (daily) — `REFRESH MATERIALIZED VIEW mv_weekly_metrics`
  - `refreshDailyInboxMetrics` (hourly) — `REFRESH MATERIALIZED VIEW mv_daily_inbox_metrics`

- **Wire in `composition.ts`** — build metric context, register event handlers, register jobs

- **Tests:**
  - Unit: 5 event handler tests (mock event → verify correct `insertReading` call)
  - Unit: `record-metric` use case (validates metric_key, inserts reading)
  - Integration: seed readings → refresh view → verify aggregates
  - Integration: inbox view from `inbox_items` → verify counts and response times
  - Integration: tenant isolation (two orgs → refresh → verify no cross-contamination)
  - Integration: background jobs register and run without error

**Design decisions (resolved).**

- **Raw readings, not pre-computed metrics.** Event handlers insert one row per event. Materialized views compute all aggregates (count, avg, conversion rate, distribution). Keeps handlers trivial, moves math to refresh jobs.
- **No partitioning at MVP.** Good indexes + materialized views handle performance. Deferred to Phase 21 or when 500+ properties.
- **Plain `REFRESH MATERIALIZED VIEW`** (not `CONCURRENTLY`). View stays readable enough for MVP. `CONCURRENTLY` with unique index added in Phase 21.
- **No metric readings for inbox events.** Inbox KPIs computed directly from `inbox_items` table in `mv_daily_inbox_metrics`.
- **No admin/lifecycle events.** Only guest journey events (scan, rate, feedback, click) and review arrival produce metric readings.
- **Custom metric registration deferred.** Schema supports it; CRUD API and UI come later.

**Scope (out).**

- Dashboard UI (Phase 14)
- `CONCURRENTLY` refresh upgrade (Phase 21)
- Table partitioning (Phase 21)
- Custom metric registration UI
- E2E tests spanning full pipeline (Phase 14)
- Analytics page (Arc 8)
- Leaderboards (Arc 6)

**Gate criteria.**

- Each of the 5 events produces a metric reading with correct key and value
- Materialized views refresh on schedule and produce correct aggregates
- Inbox materialized view produces correct counts and response times from `inbox_items`
- Tenant isolation: no cross-org contamination in readings or views
- All unit and integration tests pass
- Build order: migration → schema → seed → handlers → views → jobs → wiring → tests

**Rough effort.** 5-7 days. Materialized view SQL and event handler wiring are straightforward.

**Phase after this.** Dashboard.

---

### Phase 14 — Dashboard

**Goal.** Managers see a property-scoped dashboard with KPI cards, charts, and actionable metrics. Data comes from raw metric readings and reviews table, cached via Redis.

**Why now.** First user-visible moment of "this product shows me something valuable at a glance."

**Scope (in).**

- New `contexts/dashboard/` bounded context (read-only aggregation layer, no domain rules/events/writes)
- Replace current property index page (`/properties/$propertyId/index.tsx`) with real dashboard
- 7 dashboard sections:
  1. **KPI strip** — Reviews, Avg Rating, Scans, Feedback. Each with trend vs prior period.
  2. **Rating distribution** — horizontal bar chart (1★–5★ counts)
  3. **Google rating trend** — line chart, daily avg
  4. **Review volume trend** — bar chart, reviews per day/week
  5. **Reply performance** — reply rate (%) + avg reply time (hours from `reviewedAt`)
  6. **Engagement funnel** — Scans → Ratings → Review Link Clicks (portal-scoped only; hint when no portal selected)
  7. **Recent reviews** — last 5 with rating, snippet, date, reply status
- Time range selector: 3 presets (7d / 30d / 90d), default 30d. No custom range.
- Scope selector: property (from URL) + portal group + portal (cascading dropdowns)
- Charts: Recharts, lazy-loaded (not in initial bundle)
- Cache: single Redis key per `(propertyId, timeRange, portalId)`, 5-minute TTL
- Manager-only (Staff home deferred to Phase 15)
- Tests: use case tests, integration test for cache behavior, E2E for dashboard loading

**Scope (out).**

- Staff home page (Phase 15)
- Team/staff scope filter (Phase 15)
- Org-level dashboard (Phase 20)
- Custom date range (Phase 20)
- Comparison mode (Phase 20)
- Per-section caching (Phase 20)
- Drill-down from KPIs (later)
- Export dashboard (Arc 8)

**Gate criteria.**

- Dashboard loads in under 2 seconds with meaningful data
- KPI cards show correct values with accurate trend indicators
- Time range and portal selectors update all sections correctly
- Cache is hit for repeat queries within 5 minutes
- Engagement funnel appears when portal is selected, hint when not
- Recent reviews show real data with reply status
- Reply performance shows accurate rate and avg time
  +- All 7 sections render with real data from test fixtures
- E2E test: manager logs in → dashboard renders → switches time range → KPIs update

**Resolved decisions.**

- Dashboard is property-centric, lives at `/properties/$propertyId`. No org-level dashboard for now (deferred to Phase 20).
- New `contexts/dashboard/` bounded context. Read-only aggregation layer — composes data from metric, review, inbox contexts. No domain rules, no events, no writes. Has use cases, repo ports, Drizzle repo impls, server functions. `domain/types.ts` for response shapes only.
- Scope selector: property (from URL) + portal group + portal (cascading dropdowns).
- Four KPI cards: Reviews (count), Average Rating (avg of Google stars), Scans (count), Feedback (count). No computed rates for MVP. Each card shows trend indicator vs previous equal-length period (e.g. "↑12% vs prior 30d").
- Data source: raw `metric_readings` with SQL aggregation. Migration to materialized views deferred to Phase 21.
- 7 dashboard sections (all in Phase 14 scope):
  1. **KPI strip** — 4 cards with trend vs prior period
  2. **Rating distribution** — horizontal bar chart (1★–5★ counts from reviews table)
  3. **Google rating trend** — line chart, daily avg Google rating over time
  4. **Review volume trend** — bar chart, reviews received per day/week
  5. **Reply performance** — reply rate (% reviews with published reply) + avg reply time (hours)
  6. **Engagement funnel** — Scans → Ratings → Review Link Clicks (conditional: only when portal selected in scope dropdown; when no portal selected, show inline hint "Select a portal to see the engagement funnel")
  7. **Recent reviews** — last 5 reviews with rating, snippet, date, reply status
- Reply time uses `reviews.reviewedAt` (customer's review date), not `reviews.createdAt` (import date). Reflects customer-facing reality.
- Caching: single Redis key per `(propertyId, timeRange, portalId)`, 5-minute TTL. Per-section caching deferred to Phase 20.
- Phase 14 builds the **manager** dashboard only. Staff home (`/home`) stays a placeholder until Phase 14.5 when portal access control makes staff-viewable metrics possible.

**All open questions resolved.** No remaining unknowns.

**Rough effort.** 6-8 days (expanded from original 5-7 due to 7-section scope).

**Phase after this.** Goals + gamification, or AI first — discuss at the gate.

---

## Arc 6 — Gamification (Phases 14.5-16.2)

Goals, portal groups, and badges motivate teams. Leaderboards create healthy competition.

### Phase 14.5 — Staff Dashboard (Portal Access Control)

**Goal.** Staff members get a personalized dashboard: KPIs for their assigned portals, goal progress, recent activity. Managers assign staff to specific portals via an edit modal with multi-select. No referral codes, no `?ref=`, no per-staff metric attribution.

**Why now.** Portal access control is the foundation for staff-facing dashboards. Without it, staff have no personalized view. Also a hard prerequisite for Phase 16 (leaderboards and badges) — leaderboards rank portals, staff need to see their portals' metrics before they can compete.

**Resolved decisions (grilling session 2026-06-06).**

1. **Assignment model** — one row per (user, portal) in `staff_assignments`. Team is inherited on each row. Form submission creates N rows (one per selected portal).
2. **Explicit portal selection** — manager picks portals from a multi-select. "Select all, deselect exceptions" pattern. No null-portal shortcut.
3. **No new bounded context** — server functions live in existing contexts (`goal`, `dashboard`, `review`). Staff home is a view composition, not a domain.
4. **`/home` = scorecard** — KPI strip (4 cards: Reviews, Avg Rating, Scans, Feedback) aggregated across assigned portals. Portal filter to drill in. Goal progress summary (top goals with mini progress bars). Recent activity (last 5 reviews/feedback).
5. **`/progress` = full goal detail** — all active/completed goals for assigned portals, detailed progress, filters by portal or metric. "View all goals" from `/home` links here.
6. **`/team` deferred** — placeholder stays. Teams are not a scope level; page has no meaningful content until teams get metrics.
7. **Assignment editing** — staff tab shows one row per user with portal count badge. "Edit" opens modal with portal multi-select (pre-filled). Save diffs: creates new rows, removes deleted. "Remove" deletes all assignments for that user.
8. **KPI aggregation** — aggregate across all assigned portals by default. Portal selector dropdown to scope to a single portal.
9. **Goal visibility** — portal-scoped goals + group-scoped goals (where staff's portals belong to the group). No property-wide goals.
10. **Property picker** — shared state between manager and staff sidebars. Auto-hidden when staff has one property. When selected property has no assignments, show empty state message.
11. **Empty state** — "Your manager hasn't assigned you to any portals yet" when on a property with no portal assignments. "Welcome! Ask your manager to assign you" when no properties at all.
12. **Staff sidebar** — gains property picker. Nav items: Home, Progress, Leaderboard (placeholder), Team (conditional).
13. **Time range** — 7d / 30d / 90d presets, matching manager dashboard. Default 30d.
14. **Multi-team display** — if a user has assignments across multiple teams, show "Multiple" in staff tab. Full breakdown in edit modal.

**Scope (in).**

- People page UI: portal multi-select on staff assignment form (create + edit modal)
- Staff tab: one row per user with portal count badge, edit modal, remove-all button
- Staff sidebar: property picker (shared state with manager sidebar)
- `/home`: KPI strip (aggregated, with portal filter), goal progress summary, recent activity
- `/progress`: full goal list with progress bars, filters, detail
- Server functions: `listStaffGoals` (wired), `getStaffKpis` (new), `getStaffRecentActivity` (new)
- Empty states for no-assignments scenarios
- Tests: server functions, assignment diff logic, KPI aggregation

**Scope (out).**

- Column drops (`referralCode`, `staffId` on readings, `teams.portalId`) — already done in Phase 15.5
- Referral code generation/resolution
- `?ref=` query param handling
- Guest session staff attribution
- Per-staff QR codes
- `/team` page content
- `/leaderboard` page content (Phase 16)

**Gate criteria.**

- Manager can assign staff to specific portals via multi-select form (create + edit)
- Staff tab shows one row per user with portal count badge
- Edit modal diffs correctly: adds new rows, removes deleted
- Staff property picker appears when multiple properties, auto-hides for single
- `/home` shows KPI strip aggregated across assigned portals, scoped to selected property
- Portal filter on `/home` correctly scopes KPIs to a single portal
- Goal progress shows portal + group goals only (no property-wide)
- `/progress` shows full goal list with progress bars
- Empty states render correctly (no portals, no properties)
- `tsc --noEmit` passes
- All existing tests pass
- New tests: server functions, KPI aggregation, assignment diff

**Rough effort.** 3-4 days. Staff UI (1.5d) + server functions + wiring (1d) + testing + review (1-1.5d).

**Phase after this.** Badges and leaderboards (Phase 16).

---

### Phase 15 — Goals

**Goal.** Managers can set performance goals at property, portal, team, or staff level. Goal scope hierarchy: `property → portal → team → staff`. Progress computed automatically from metrics.

**Why now.** Goals give meaning to metrics. Without them, metrics are just numbers.

> **Status:** This phase is **already implemented** (15A Goal Core, 15B Goal Engine, 15C Goal UI). The schema currently has `staffId`/`teamId` columns that will be cleaned up in Phase 15.5.

**Scope (in).**

- `contexts/goal/` with full hexagonal structure
- `goals` and `goal_progress` tables (includes `staffId`, `teamId`, `portalId` scope columns)
- Goal domain: scope validation (at most one FK), metric×aggregation pair validation, scope→metric constraints
- Goal types: `open`, `one_shot`, `rolling`, `recurring`
- Use cases: create, update, cancel, list, get progress
- Progress strategy functions per (goalType × aggregationFunction)
- Event-driven progress updates: `MetricRecorded` handler increments matching active goals
- Periodic reconciliation job (hourly): recompute all active goals from raw metric data
- Recurring instance spawner job (daily)
- Entity removal handlers: staff-unassigned, team-deleted, portal-deleted → cancel goals
- UI: goals list with progress bars, create form, detail view
- Tests: domain, use cases, repository, event handlers, server functions, UI

**Scope (out).**

- Portal groups (deferred to Phase 15.5)
- `groupId` scope (deferred to Phase 15.5)
- Email/push milestone notifications (Phase 16.1)
- Goal templates (later)

**Gate criteria.** (from original Phase 15A/B/C implementation)

- Goal can be created at any entity level (property, portal, team, staff)
- Progress updates in near-real-time when metric events fire
- Hourly reconciliation job runs and matches live-computed progress
- Entity removal cascades to cancel affected goals
- Tests pass for domain, use cases, event handlers, reconciliation

**Rough effort.** Already completed (original: 5-7 days across 15A/15B/15C).

**Phase after this.** Portal groups + goal model reconfiguration.

---

### Phase 15.5 — Portal Groups + Model Reconfiguration

**Goal.** Introduce portal groups for department-level aggregation. Reconfigure the goal model to the new scope hierarchy (`property → portal_group → portal`). Drop all vestigial columns (`staffId`, `teamId`, `referralCode`) and clean up dead code paths. Update the metric pipeline to carry `groupId`.

**Why now.** The Phase 15 implementation carries vestigial staff/team scope columns that don't match the portal-centric model. Portal groups unlock department-level goals (e.g., "Reception: 1000 scans/month across 3 portals").

**Scope (in).**

- **New entity — PortalGroup:**
  - `portal_groups` table: `id, organizationId, propertyId, name (required), createdAt, updatedAt`
  - `portals.groupId` nullable FK — a portal belongs to at most one group
  - PortalGroup CRUD (server functions + UI in portal management)
  - Lives in Portal context (not a separate bounded context)

- **Schema migrations:**
  - `goals`: drop `staffId`, drop `teamId`, add `groupId` (nullable FK to `portal_groups`)
  - `metric_readings`: drop `staffId`, add nullable `groupId` (resolved from `portals.groupId`)
  - `staff_assignments`: drop `referralCode`
  - `teams`: drop `portalId`

- **Goal scope rework:**
  - Three scope levels: property (both null), portal_group (groupId set), portal (portalId set)
  - Goal constructors: validate at most one scope FK, validate metric×aggregation pairs, scope→metric constraints
  - Remove staff/team validation from constructors

- **Metric pipeline update:**
  - `MetricRecorded` event gains `groupId` field (resolved from `portals.groupId` at recording time)
  - Metric event handlers resolve `portalId → groupId` and include `groupId` in the event

- **Goal engine update:**
  - `findActiveGoalsByMetric` signature: `(metricKey, orgId, propertyId, portalId, groupId)`
  - Match logic: group-scoped goals match on `groupId`, portal-scoped on `portalId`, property-scoped when both null
  - Reconciliation job handles group aggregation

- **Entity removal handlers:**
  - Remove `on-staff-unassigned` (no staff-scoped goals)
  - Remove `on-team-deleted` (no team-scoped goals)
  - Add `on-group-deleted` handler → cancel group-scoped goals

- **Dead code cleanup:**
  - Remove `resolveReferralCode` use case
  - Remove referral code domain module (`src/contexts/staff/domain/referral-code.ts`)
  - Remove `getStaffIdForSession` use case
  - Remove `?ref=` extraction from portal route
  - Remove `staffId` from guest event constructors (always null → drop the field)

- **Server functions:**
  - Update goal create/update input schemas: remove `staffId`/`teamId`, add `groupId`
  - Update goal list filter to include `groupId`, remove `staffId`/`teamId`

- **Tests:**
  - Fix all constructor, use case, repository, event handler, and server function tests
  - Add tests for portal-group-scoped goals + group aggregation
  - Add tests for `on-group-deleted` handler

- **UI:**
  - Portal group CRUD in portal management page
  - Update goal create form scope selector: property / portal group / portal (cascading)
  - Remove staff/team options from goal scope selector
  - Staff home: show portal + group goals (not property-wide goals)

**Scope (out).**

- No new goal types or period models
- No badge/leaderboard changes

**Gate criteria.**

- Portal groups can be created and portals can be assigned to groups
- `findActiveGoalsByMetric` correctly matches property, portal, and group-scoped goals
- `MetricRecorded` events carry `groupId`
- Group-scoped goals aggregate across all member portals
- No `staffId`, `teamId`, or `referralCode` references remain in goal/metric/staff contexts
- No broken imports or dead code paths
- All existing tests pass; new tests cover group scope
- Staff home shows portal + group goals only

**Rough effort.** 5-7 days. PortalGroup CRUD (1-2d) + schema migrations (0.5d) + goal rework (2d) + dead code cleanup + test fixes (2d).

---

### Phase 16.1 — Notifications

**Goal.** Users receive targeted, dismissable notifications about domain events through in-app (polling) and email digest (Resend). Notification context is a BullMQ-backed subscriber, following the Activity pattern. 13 notification types ship; 2 deferred for prerequisite phases.

**Why now.** Notifications are high-value infrastructure. Every subsequent phase (badges, AI, analytics) benefits from notifications being live. Managers need to know about escalations, pending approvals, and new reviews before badges or AI features exist. Shipping notifications before Phase 16.2 means badge-earned notifications work from day one.

**Design decisions (resolved in grilling session 2026-06-07).**

1. **Separate bounded context** — `contexts/notification/`. Distinct from Activity (immutable audit) — notifications carry mutable delivery state, channel routing, and user preferences.
2. **Point-in-time model** — each event produces one notification row per recipient per channel. No state-tracking or grouping. Low volume (5-20/day per manager) makes this sufficient.
3. **In-app + email digest only** — no push (FCM) in MVP. Desktop-first user base. Push deferred until users ask.
4. **Polling for in-app** — 30s interval. `getUnreadCount` endpoint, cached in Redis. No SSE/WebSocket for notifications. (SSE reserved for AI reply streaming in Phase 17.)
5. **BullMQ for delivery** — same pattern as Activity (ADR 0010). Event → in-process handler → enqueue BullMQ job → worker inserts rows. At-least-once, retry, dead-letter queue.
6. **One handler per event tag** — matches Activity/Metric pattern. Handler resolves recipients, enqueues one BullMQ job per user.
7. **Idempotency via eventId** — composite unique on `(user_id, type, resource_id, event_id)`. Never suppresses legitimate notifications.
8. **Single `RecipientResolverPort`** — encapsulates all "who should know?" logic. Notification handlers call one port, not multiple context APIs.
9. **Channel-level preferences** — `notification_preferences` table. Absence of row = enabled. No per-type toggles in MVP.
10. **Priority-based email routing** — `priority` field on email rows. Urgent types send immediately via `sendUrgentEmail` job. Normal types wait for daily digest.
11. **Urgent types** — `reply.publish_failed`, `inbox.escalated`, `reply.pending_approval`. These bypass digest and send immediately.
12. **Daily digest at 8am local** — requires IANA `timezone` column on `organizations` (default `'UTC'`, configurable in org settings). Hourly BullMQ sweep checks which orgs are at ~8am local time.
13. **Three-state in-app lifecycle** — `pending` → `read` → `dismissed`. Email: `pending` → `delivered`.
14. **Denormalized `propertyId`** — on notification rows for click-through routing and property-scoped filtering. Most events already carry it.
15. **Template functions** — centralized `notification-templates.ts` module. Pure functions, testable, decoupled from handler logic.
16. **Pure subscriber** — notification context emits no events. Notification rows are the data source for future analytics.
17. **Email retry** — 3 attempts with exponential backoff. Dead-letter queue on permanent failure. Same as reply publish pattern.

**Prerequisite: organization timezone.**

- Add `timezone` text column to `organizations` table, default `'UTC'`, nullable.
- Add timezone selector in org settings page.
- Not required at registration — default suffices until configured.

**Scope (in).**

- **Context: `contexts/notification/`** with full layer structure:
  - `domain/types.ts` — `Notification`, `NotificationType`, `NotificationChannel`, `NotificationStatus`, `EmailPriority`
  - `domain/errors.ts` — `NotificationError`
  - `application/public-api.ts` — `NotificationPublicApi`
  - `application/ports/notification.repository.port.ts` — insert, query by user/org, mark read, mark dismissed, count unread
  - `application/ports/recipient-resolver.port.ts` — `resolveRecipients(event): UserId[]`
  - `application/ports/preference-lookup.port.ts` — `isEnabled(userId, channel): boolean`
  - `application/use-cases/insert-notification.ts` — idempotency check, insert row(s)
  - `application/notification-templates.ts` — title/body template functions per type
  - `infrastructure/notification.repository.drizzle.ts`
  - `infrastructure/adapters/recipient-resolver.adapter.ts` — calls StaffPublicApi + IdentityPublicApi
  - `infrastructure/adapters/preference-lookup.adapter.ts` — queries notification_preferences
  - `infrastructure/event-handlers/` — one file per event tag (see table below)
  - `infrastructure/jobs/insert-notification.job.ts` — BullMQ worker for `notification-insert` queue
  - `infrastructure/jobs/send-urgent-email.job.ts` — BullMQ worker for immediate email delivery
  - `infrastructure/jobs/daily-digest.job.ts` — hourly sweep, processes orgs at their 8am local
  - `infrastructure/email/resend.adapter.ts` — Resend integration for email sending
  - `queries/get-notifications.ts`, `get-unread-count.ts`
  - `server/notification.ts` — server functions
  - `build.ts`

- **Schema: `shared/db/schema/notification.schema.ts`**
  - `notifications` table: `id (UUID PK)`, `user_id`, `organization_id`, `property_id (nullable)`, `type`, `title`, `body`, `resource_type`, `resource_id`, `event_id`, `channel`, `priority (nullable, email only)`, `status`, `created_at`, `read_at (nullable)`
  - `notification_preferences` table: `id (UUID PK)`, `user_id`, `organization_id`, `channel`, `enabled`, `updated_at`
  - Index on `(user_id, status, created_at)` — unread query
  - Index on `(organization_id, channel, status, created_at)` — digest query
  - Unique on `(user_id, type, resource_id, event_id)` — idempotency

- **Schema migration:** `organizations` table gains `timezone` text column, default `'UTC'`

- **13 event handlers** (subscribe to existing domain events):

| Handler file                  | Event tag                    | Notification type         | Recipients                                             |
| ----------------------------- | ---------------------------- | ------------------------- | ------------------------------------------------------ |
| `on-review-created.ts`        | `review.created`             | `review.created`          | PropertyManagers of property + AccountAdmin            |
| `on-inbox-item-created.ts`    | `inbox.inbox_item.created`   | `feedback.created`        | PropertyManagers + AccountAdmin (when source=feedback) |
| `on-reply-submitted.ts`       | `review.reply.submitted`     | `reply.pending_approval`  | PropertyManagers + AccountAdmin                        |
| `on-reply-approved.ts`        | `review.reply.approved`      | `reply.approved`          | Reply author                                           |
| `on-reply-rejected.ts`        | `review.reply.rejected`      | `reply.rejected`          | Reply author                                           |
| `on-reply-published.ts`       | `review.reply.published`     | `reply.published`         | Reply author                                           |
| `on-reply-publish-failed.ts`  | (detected in reply worker)   | `reply.publish_failed`    | Reply author + PropertyManagers                        |
| `on-inbox-escalated.ts`       | `inbox.inbox_item.escalated` | `inbox.escalated`         | PropertyManagers + AccountAdmin                        |
| `on-inbox-assigned.ts`        | `inbox.inbox_item.assigned`  | `inbox.assigned`          | Assigned user                                          |
| `on-goal-completed.ts`        | `goal.completed`             | `goal.completed`          | Goal creator + PropertyManagers                        |
| `on-goal-progress-updated.ts` | `goal.progress_updated`      | `goal.progress_milestone` | Goal creator (only at 25/50/75% thresholds)            |
| `on-member-invited.ts`        | `identity.member_invited`    | `member.invited`          | Invitee (email only)                                   |
| `on-inbox-note-added.ts`      | `inbox.inbox_note.added`     | `inbox_note.added`        | Note target's assignee (if different from author)      |

- **Background jobs:**
  - `insert-notification` queue — worker inserts notification rows (one job per user per event)
  - `send-urgent-email` — sends immediate email via Resend for urgent priority, marks `delivered`
  - `daily-digest` (hourly repeatable) — checks which orgs are at ~8am local, fetches pending normal-priority email notifications, groups by user, renders digest template, sends via Resend, marks `delivered`

- **Server functions:**
  - `getNotifications` (paginated, filterable by read/unread, type, property)
  - `getUnreadCount` — lightweight, Redis-cached (30s TTL)
  - `markAsRead(id)` — single notification
  - `markAllAsRead` — all pending for user in org
  - `dismissNotification(id)`
  - `getNotificationPreferences` — channel preferences for current user
  - `updateNotificationPreference(channel, enabled)` — upsert preference row

- **UI:**
  - Bell icon in top nav with unread count badge (polls `getUnreadCount` every 30s)
  - Notification panel (popover/dropdown): last 20 notifications, read/unread state, relative time, click-through to resource
  - "Mark all as read" button in panel
  - "View all" link to `/notifications` page
  - `/notifications` page: full paginated list, filters (read/unread, type, property), bulk actions
  - Org settings: timezone selector
  - User settings: notification channel preferences (in-app on/off, email on/off)

- **Email templates (Resend):**
  - Digest template: grouped list of notifications with titles, previews, and click-through links
  - Urgent template: single notification with clear subject line and CTA link

- **Tests:**
  - Unit: domain types, template functions, idempotency logic
  - Unit: recipient resolver with mocked public APIs
  - Unit: event handlers (mock deps → verify correct job enqueued)
  - Integration: notification repository against Postgres
  - Integration: full pipeline (emit event → handler → job → row inserted → verify dedup)
  - Integration: digest job with mock Resend (verify correct orgs processed, correct emails sent)
  - Integration: urgent email sent immediately, not queued for digest
  - E2E: manager receives in-app notification, clicks through to resource

**Scope (out).**

- Push notifications / FCM (deferred)
- Per-type notification preferences (channel-level only for MVP)
- WebSocket / SSE for real-time notification delivery (polling sufficient)
- `review.urgent` notification type (requires AI Phase 17)
- `badge.awarded` notification type (requires Phase 16.2)
- Notification events emitted by the notification context (pure subscriber)
- Localization of notification text
- Notification analytics / engagement tracking

**Gate criteria.**

- Each of the 13 event types produces correct notification rows for correct recipients
- Idempotency: re-delivered event does not produce duplicate notifications
- In-app: bell icon shows correct unread count, polling updates within 30s
- In-app: clicking notification navigates to correct resource
- In-app: mark-as-read, mark-all-as-read, dismiss all work correctly
- Email digest: orgs at 8am local time receive batched digest with all pending notifications
- Email digest: urgent types (publish_failed, escalated, pending_approval) send immediately, not in digest
- Email retry: Resend failure triggers up to 3 retries, dead-letter on exhaustion
- Preferences: opting out of a channel stops notifications for that channel
- Tenant isolation: notifications scoped to user's organization
- Timezone: org timezone setting persists and affects digest timing
- `tsc --noEmit` passes
- All existing tests pass
- New tests: domain, handlers, repository, integration pipeline, digest, urgent email

**Rough effort.** 7-10 days. Context setup + schema + BullMQ wiring (2d) + 13 handlers + templates (2d) + email digest + Resend (2d) + UI (bell, panel, page, preferences) (2d) + timezone prerequisite (0.5d) + testing + review (1.5d).

**Phase after this.** Badges and leaderboards (Phase 16.2).

---

### Phase 16.2 — Badges and leaderboards

**Goal.** Users earn badges automatically based on metric-driven criteria. Leaderboards rank portals and portal groups by metric performance. Staff see rankings of portals they're assigned to.

**Why now.** Completes the gamification loop. Goals give direction; badges and leaderboards give recognition. Notifications (Phase 16.1) already live — badge-earned notifications work from day one.

**Pre-grilling decisions (session 2026-06-06).**

1. **Leaderboards rank portals and portal groups** — not staff, not teams. No per-staff metric attribution. Staff see a filtered view of rankings for their assigned portals.
2. **Blend of scorecard (B) + raw data (A)** — landing page shows a composite scorecard (B primary), with drill-down into per-metric rankings (A).
3. **Weighted composite score (0–100)** — each metric normalized to 0–100, multiplied by a weight, summed. System defaults first, org-configurable weights later.
4. **Calendar time periods** — this week / this month / this quarter (aligns with goal periods and business rhythms), with a rolling "last N days" fallback.
5. **Within-property scope** — all portals/groups in the property ranked against each other. Staff's own portals highlighted. Full ranking visible.
6. **Portal groups as separate tab/toggle** — "rank portals" vs "rank portal groups." Group composite score aggregates member portals' metrics.
7. **Prerequisite: Phase 14.5** — staff must see their own portal metrics before leaderboards are meaningful.

**Scope (in).**

- `badge_definitions` and `badge_awards` tables
- Badge criteria schema (typed JSONB — metric_key, operator, value, time_window, streak_days)
- Criteria evaluation engine as pure domain function
- Seed migration for system-wide default badges ("First Review", "100 Scans", "7-Day Streak", etc.)
- Background job: `evaluateBadges` (hourly) — checks criteria against metric data, awards new badges
- Leaderboard use cases — composite score computation, per-metric drill-down, calendar period aggregation
- UI: badge showcase, leaderboard page with calendar period and scope tabs (portals / portal groups)
- `badge.awarded` event emission
- Tests: criteria evaluation across all types (performance, streak, milestone), leaderboard computation, award idempotency

**Scope (out).**

- Custom badge creation UI (backend supports it; UI can come later)
- Badge notifications via notification context (handler added in this phase — subscribes to `badge.awarded`)
- Cross-property leaderboards (Phase 20)
- Org-configurable weights for composite score (later)

**Gate criteria.**

- All four badge types evaluate correctly (performance, streak, milestone, special)
- Badges are awarded exactly once per portal/group per criteria-met event
- Composite score weights produce reasonable rankings across different metric profiles
- Per-metric drill-down shows correct rankings
- Calendar periods align with goal periods
- Leaderboards load fast (from materialized views)
- Staff see only their assigned portals highlighted in the ranking
- Tests: 100% coverage on criteria evaluation engine

**Open questions to resolve during this phase.**

- Initial badge library (10-15 system badges is a good start)
- Whether badges target portals, portal groups, or both (start with portals)
- Exact composite score default weights

**Rough effort.** 5-7 days.

**Phase after this.** AI.

---

## Arc 7 — AI Features (Phases 17-18)

AI adds differentiation. Sentiment, priority, reply drafting, trend detection.

### Phase 17 — AI v1: sentiment, priority, reply drafting

**Goal.** Every new review is automatically analyzed for sentiment and scored for priority. Managers can generate AI-drafted replies. Feedback is auto-categorized. AI usage is tracked and quota-managed.

**Why now.** Without AI, the product is good. With AI, it's differentiated.

**Scope (in).**

- `contexts/ai/` with full layer structure
- `AIProvider` port with `generateReply`, `analyzeSentiment`, `categorize`
- Anthropic adapter implementation
- `ai_usage` table + per-org quota tracking
- Quota check inside the adapter (not a separate middleware — cannot be bypassed)
- `review.received` event handler: trigger sentiment analysis + priority scoring via BullMQ job
- `feedback.submitted` event handler: trigger categorization
- Priority scoring: pure domain function combining rating + sentiment + recency with configurable weights
- "Generate Reply" button in review detail view → calls use case → returns draft
- AI-generated replies flagged (`ai_generated = true`)
- Sentiment and priority badges in inbox
- Tests: adapter tests with mocked Anthropic API, quota enforcement, priority scoring edge cases

**Scope (out).**

- Trend detection (Phase 18)
- Batch historical analysis (Phase 18)
- Fine-tuning / custom prompts per org (later)

**Gate criteria.**

- New reviews get sentiment + priority within 60 seconds of arrival
- Reply generation works and takes <10 seconds for typical reviews
- Quota enforcement: exceeding quota returns graceful error, doesn't break non-AI features
- AI calls are logged with token counts and estimated cost
- Priority score threshold triggers "urgent review" events (notification handler added when Phase 17 lands — notification context already wired in Phase 16.1)
- Tests pass

**Open questions to resolve during this phase.**

- Initial per-plan quotas (suggest: $10/mo for free tier, $50/mo for pro, $500/mo for enterprise — revisit based on actual costs)
- Whether to support "tone" selection in reply generation (yes — professional / friendly / casual)
- How many previous published replies to include as few-shot examples (start with 3, tune empirically)

**Rough effort.** 7-10 days.

**Phase after this.** AI v2.

---

### Phase 18 — AI v2: trend detection and AI dashboard

**Goal.** Daily trend reports identify recurring themes in reviews. AI dashboard shows sentiment trends, top themes, priority distribution, and weekly summaries.

**Why now.** Second layer of AI value — not just processing individual reviews but surfacing patterns.

**Scope (in).**

- `trend_reports` table
- Background job: `detectTrends` (daily) — sends last N reviews per property + org to AI, gets back top 5 themes with trajectories
- Batch historical sentiment analysis: on-demand job for orgs newly connecting GBP
- AI dashboard page with:
  - Sentiment trend chart over time
  - Top themes from latest trend report
  - Priority score distribution
  - AI-generated weekly summary
- Tests: trend detection pipeline, batch analysis job, dashboard use cases

**Scope (out).**

- Embeddings / topic modeling (post-MVP if ever needed)
- Custom AI dashboards (later)

**Gate criteria.**

- Daily trend detection job runs successfully for all orgs with reviews
- Trend reports are human-readable and identify real themes
- Batch analysis processes historical reviews within quota
- AI dashboard loads fast (uses materialized views + cache)
- Tests pass

**Rough effort.** 5-7 days.

**Phase after this.** Arc 8 polish.

---

## Arc 8 — Polish and Production Readiness (Phases 19-21)

Now we fill in the gaps that make this a real product, not just a collection of features.

### Phase 19 — Compliance: GDPR flows and audit logs

**Goal.** Full audit log coverage. Account deletion (with grace period). Data export (GDPR Article 20). Cookie consent properly integrated.

**Scope.** Audit log event handlers subscribed to all auditable actions. Account deletion flow with 30-day grace period. Data export job (generates JSON archive, stores in S3, signed URL). Hard-delete job for expired grace periods.

**Rough effort.** 5-7 days.

---

### Phase 20 — Conversion analytics and account dashboard

**Goal.** The analytics page from Phase 14's scope-out lands here. Conversion funnel, before/after comparison, rating distribution, top performers, exports. Org-level dashboard. Dashboard caching upgraded to per-section granularity.

**Scope.** Analytics context (or fold into metrics), conversion funnel computation, before/after comparison logic, CSV/PDF export jobs, org-level dashboard page, per-section Redis caching (KPIs at 5 min, recent reviews at 1 min, charts at 5 min) replacing Phase 14's single-cache-key approach.

**Rough effort.** 5-7 days.

---

### Phase 21 — Production hardening

**Goal.** Before real users touch the system: load testing, error handling audit, security audit, observability review.

**Scope.**

- Migrate dashboard queries from raw `metric_readings` aggregation to pre-aggregated `mv_daily_metrics` / `mv_weekly_metrics` (repo impl swap, no use case change)
- `CONCURRENTLY` refresh for materialized views (requires unique indexes)
- Load test against Railway staging — 1000 concurrent guests hitting public portals, 100 managers in dashboard
- Audit error handling: every try/catch, every thrown tagged error, verify graceful degradation
- Security audit: rate limits on all public endpoints, CORS correct, session cookies correctly configured, no secrets leaked
- Sentry fully wired, alerts configured
- Uptime monitoring on `/api/health`
- Runbook for common incidents
- Production environment created on Railway
- Migration of any pilot data from staging
- Go-live checklist

**Rough effort.** 5-7 days.

---

## Summary: remaining phases

|     | Arc  | Phase                    | Name                   | Status    | Rough effort |
| --- | ---- | ------------------------ | ---------------------- | --------- | ------------ |
| 1–3 | 1–9  | Foundation through Guest | Completed              | ~40 days  |
| 4   | 10   | Review schema + GBP sync | Completed              | 7-10 days |
| 4   | 11   | Unified inbox            | Completed              | 5-7 days  |
| 4   | 12   | Reply flow               | Completed              | 5-6 days  |
| 5   | 13   | Metrics foundation       | Completed              | 5-7 days  |
| 5   | 14   | Dashboard                | Completed              | 5-7 days  |
| 6   | 14.5 | Portal Access Control    | Pending                | 2-3 days  |
| 6   | 15   | Goals                    | Completed (needs 15.5) | 5-7 days  |
| 6   | 15.5 | Portal Groups + Reconfig | Completed              | 5-7 days  |
| 6   | 16.1 | Notifications            | Pending                | 7-10 days |
| 6   | 16.2 | Badges + leaderboards    | Pending                | 5-7 days  |
| 7   | 17   | AI v1                    | Pending                | 7-10 days |
| 7   | 18   | AI v2                    | Pending                | 5-7 days  |
| 8   | 19   | Compliance + audit       | Pending                | 5-7 days  |
| 8   | 20   | Analytics                | Pending                | 5-7 days  |
| 8   | 21   | Production hardening     | Pending                | 5-7 days  |

**Remaining: 10 phases, roughly 55-75 working days.**

---

## How to use this plan

**Each phase gets its own session (or a few).** We start a session, load the phase's scope, build and test together, hit the gate, commit.

**Before starting each phase, we revisit.** Is the scope still right? Have we learned something that changes the approach? Should the next phase be reordered?

**The gate is real.** If a phase doesn't pass its gate, we don't start the next one. Either finish the work or consciously reduce scope and document what's deferred.

**Reorder phases freely.** If a customer conversation makes AI (Arc 7) more important than gamification (Arc 6), swap them. If GBP sync is blocked by API access, skip Arc 4 temporarily and build Arc 5-6 on internal review data.

**Each session should produce:** working code, passing tests, a git commit, updated docs if anything changed. No exceptions.
