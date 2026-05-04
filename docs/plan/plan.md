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
- Whether approvers can be notified of pending approvals (yes — add to Arc 8 notifications)
- Auto-approval for AccountAdmins (i.e., their drafts skip approval) — suggest no, keep the workflow uniform for clarity

**Rough effort.** 5-6 days.

**Phase after this.** Metrics foundation.

---

## Arc 5 — Metrics and Dashboard (Phases 13-14)

Now we have events flowing. Metrics captures them into structured data that the dashboard can visualize.

### Phase 13 — Metrics foundation

**Goal.** Every domain event that matters is captured as a metric reading. The 12 built-in metrics from the spec are defined. Aggregations are pre-computed via materialized views. The metrics system is tenant-isolated and performant at scale.

**Why now.** The dashboard depends on metrics. Goals and gamification depend on metrics. Conversion analytics depends on metrics.

**Scope (in).**

- `contexts/metric/` with full layer structure
- `shared/db/schema/metric.schema.ts` with `metric_definitions` and `metric_readings` tables
- **Partitioned `metric_readings` table** — by month, on `recorded_at`. This is critical for scale.
- Seed migration for 12 built-in metric definitions
- Event handlers in `contexts/metric/infrastructure/event-handlers/` subscribing to every relevant event:
  - `portal.scanned` → `portal.scan_count`
  - `rating.submitted` → `portal.average_rating`
  - `review.received` → `portal.public_review_count`, `property.total_reviews`
  - `feedback.submitted` → `portal.private_feedback_count`
  - `review-link.clicked` → tracked for `portal.conversion_rate`
  - etc.
- Materialized views: `mv_daily_metrics`, `mv_weekly_metrics`
- Background jobs: `refreshDailyMetrics` (hourly), `refreshWeeklyMetrics` (daily)
- Background job: `createPartitions` (monthly) — creates 3 months of partitions ahead
- Background job: `archiveOldReadings` (monthly) — archives partitions older than 24 months
- Custom metric registration (AccountAdmin can define new metrics)

**Scope (out).**

- Dashboard UI (Phase 14)
- Analytics page (Arc 8)
- Leaderboards (Arc 6)

**Gate criteria.**

- Every relevant event produces a metric reading
- Materialized views refresh on schedule
- Partition creation job runs and creates future partitions correctly
- Tenant isolation on all metric queries
- Performance test: insert 1 million readings across 12 months, verify queries against materialized views return in <100ms
- All 12 built-in metrics produce sensible values when event data exists
- Tests: event handler unit tests, materialized view refresh integration tests, partition management tests

**Open questions to resolve during this phase.**

- Whether to use `pg_partman` extension (check Neon support) or manual partition SQL (suggest manual — more portable)
- Refresh strategy for materialized views under load (CONCURRENTLY with unique index required)
- Whether custom metrics should have their own table or share with built-in (share, via `metric_definitions`)

**Rough effort.** 7-10 days. Partitioning and materialized views need careful testing.

**Phase after this.** Dashboard.

---

### Phase 14 — Dashboard

**Goal.** Authenticated users see a dashboard with KPI cards, time-range filters, and scope selectors. Data is fast (from materialized views and cache).

**Why now.** First user-visible moment of "this product shows me something valuable at a glance."

**Scope (in).**

- Dashboard layout with sidebar navigation (shell, nav, user menu)
- KPI cards: total reviews, average rating, scan count, conversion rate
- Time range selector: 7d, 30d, 90d, custom
- Scope selector: organization, property, team, staff
- Charts: Recharts, lazy-loaded (not in initial bundle)
- Cache dashboard queries via Redis with 5-minute TTL
- `getDashboardKPIs` use case in metric context
- Role-scoped: Staff sees their own metrics, PropertyManager sees assigned properties, AccountAdmin sees org-wide
- Tests: use case tests, integration test for cache behavior, E2E for dashboard loading

**Scope (out).**

- Comparison mode (add in analytics phase)
- Drill-down from KPIs (later)
- Export dashboard (Arc 8)

**Gate criteria.**

- Dashboard loads in under 2 seconds with meaningful data
- KPI cards show correct values from materialized views
- Time range and scope selectors update KPIs correctly
- Cache is hit for repeat queries within 5 minutes
- Role-based data scoping is enforced (Staff can't see other staff's metrics)
- E2E test: user logs in → dashboard renders → switches time range → KPIs update

**Open questions to resolve during this phase.**

- Which specific charts to show initially (start simple: rating over time, scan count over time — add more as product evolves)
- Default time range (suggest 30d)

**Rough effort.** 5-7 days.

**Phase after this.** Goals + gamification, or AI first — discuss at the gate.

---

## Arc 6 — Gamification (Phases 15-16)

Goals and badges motivate teams. Leaderboards create healthy competition.

### Phase 15 — Goals

**Goal.** Managers can set performance goals at org, property, team, or individual level. Goals cascade (child ≤ parent). Progress is computed automatically from metrics.

**Why now.** Goals give meaning to metrics. Without them, metrics are just numbers.

**Scope (in).**

- `contexts/gamification/` (or split into `goal` and `badge` contexts — decide during phase)
- `goals` and `goal_progress` tables
- Goal domain: cascade validation, period alignment, circular reference prevention
- Use cases: create, update, delete, list, get progress
- Event-driven progress updates: `metric.recorded` event handler checks affected goals, updates progress
- Periodic reconciliation job (hourly): recompute all active goals from raw metric data
- Milestone notifications at 25%, 50%, 75%, 100% (requires notifications, which we're building in Arc 8 — defer the notification part or build minimal in-app for now)
- UI: goals list with progress bars, create form, cascade visualization
- Tests: cascade validation, progress computation, event-driven updates

**Scope (out).**

- Email/push milestone notifications (Arc 8)
- Goal templates (later)

**Gate criteria.**

- Goal can be created at any entity level
- Child goal target cannot exceed parent (validation enforced)
- Period alignment validated (quarterly parent requires quarterly or monthly children)
- Progress updates in near-real-time when metric events fire
- Hourly reconciliation job runs and matches live-computed progress
- Tests pass, cascade validation is comprehensive

**Open questions to resolve during this phase.**

- Exact period types (start with: weekly, monthly, quarterly)
- What happens when a goal's parent is deleted (suggest: orphan the child, mark it as "orphaned" status)

**Rough effort.** 5-7 days.

**Phase after this.** Badges and leaderboards.

---

### Phase 16 — Badges and leaderboards

**Goal.** Users earn badges automatically based on metric-driven criteria. Leaderboards rank entities by metric performance. Users can see their earned badges.

**Why now.** Completes the gamification loop. Goals give direction; badges and leaderboards give recognition.

**Scope (in).**

- `badge_definitions` and `badge_awards` tables
- Badge criteria schema (typed JSONB — metric_key, operator, value, time_window, streak_days)
- Criteria evaluation engine as pure domain function
- Seed migration for system-wide default badges ("First Review", "100 Scans", "7-Day Streak", etc.)
- Background job: `evaluateBadges` (hourly) — checks criteria against metric data, awards new badges
- Leaderboard use cases — computed from materialized views
- UI: badge showcase per user/team, leaderboard page with time window and scope tabs
- `badge.awarded` event emission
- Tests: criteria evaluation across all types (performance, streak, milestone), leaderboard computation, award idempotency

**Scope (out).**

- Custom badge creation UI (backend supports it; UI can come later)
- Badge notifications via email/push (Arc 8)

**Gate criteria.**

- All four badge types evaluate correctly (performance, streak, milestone, special)
- Badges are awarded exactly once per user/team per criteria-met event
- Leaderboards rank correctly and load fast (from materialized views)
- Tests: 100% coverage on criteria evaluation engine

**Open questions to resolve during this phase.**

- Initial badge library (10-15 system badges is a good start)
- Whether to support team badges (yes — badges can target entity_type = team)

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
- Priority score threshold triggers "urgent review" events (used in Arc 8 for push notifications)
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

## Arc 8 — Polish and Production Readiness (Phases 19-22)

Now we fill in the gaps that make this a real product, not just a collection of features.

### Phase 19 — Notifications

**Goal.** Users receive notifications through three channels (in-app, email digest, push for critical). Preferences are configurable.

**Scope.** Notifications context, Resend for email, FCM for push, in-app bell icon, preferences UI, all notification types from the spec.

**Rough effort.** 5-7 days.

---

### Phase 20 — Compliance: GDPR flows and audit logs

**Goal.** Full audit log coverage. Account deletion (with grace period). Data export (GDPR Article 20). Cookie consent properly integrated.

**Scope.** Audit log event handlers subscribed to all auditable actions. Account deletion flow with 30-day grace period. Data export job (generates JSON archive, stores in S3, signed URL). Hard-delete job for expired grace periods.

**Rough effort.** 5-7 days.

---

### Phase 21 — Conversion analytics and account dashboard

**Goal.** The analytics page from Phase 14's scope-out lands here. Conversion funnel, before/after comparison, rating distribution, top performers, exports.

**Scope.** Analytics context (or fold into metrics), conversion funnel computation, before/after comparison logic, CSV/PDF export jobs.

**Rough effort.** 5-7 days.

---

### Phase 22 — Production hardening

**Goal.** Before real users touch the system: load testing, error handling audit, security audit, observability review.

**Scope.**

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

| Arc | Phase | Name                              | Status     | Rough effort |
| --- | ----- | --------------------------------- | ---------- | ------------ |
| 1–3 | 1–9   | Foundation through Guest           | Completed  | ~40 days     |
| 4   | 10    | Review schema + GBP sync          | Next up    | 7-10 days    |
| 4   | 11    | Unified inbox                     | Pending    | 5-7 days     |
| 4   | 12    | Reply flow                        | Pending    | 5-6 days     |
| 5   | 13    | Metrics foundation                | Pending    | 7-10 days    |
| 5   | 14    | Dashboard                         | Pending    | 5-7 days     |
| 6   | 15    | Goals                             | Pending    | 5-7 days     |
| 6   | 16    | Badges + leaderboards             | Pending    | 5-7 days     |
| 7   | 17    | AI v1                             | Pending    | 7-10 days    |
| 7   | 18    | AI v2                             | Pending    | 5-7 days     |
| 8   | 19    | Notifications                     | Pending    | 5-7 days     |
| 8   | 20    | Compliance + audit                | Pending    | 5-7 days     |
| 8   | 21    | Analytics                         | Pending    | 5-7 days     |
| 8   | 22    | Production hardening              | Pending    | 5-7 days     |

**Remaining: 13 phases, roughly 80-120 working days.**

---

## How to use this plan

**Each phase gets its own session (or a few).** We start a session, load the phase's scope, build and test together, hit the gate, commit.

**Before starting each phase, we revisit.** Is the scope still right? Have we learned something that changes the approach? Should the next phase be reordered?

**The gate is real.** If a phase doesn't pass its gate, we don't start the next one. Either finish the work or consciously reduce scope and document what's deferred.

**Reorder phases freely.** If a customer conversation makes AI (Arc 7) more important than gamification (Arc 6), swap them. If GBP sync is blocked by API access, skip Arc 4 temporarily and build Arc 5-6 on internal review data.

**Each session should produce:** working code, passing tests, a git commit, updated docs if anything changed. No exceptions.
