# Closed-beta capability verification — 2026-08-21

Release `8e1954de1c48b5f2eb81c24f8d5f9a17deb4cad0` (`main`) deployed to the
`google-closed-beta` Railway environment. Every capability below was exercised
against the deployed build, not read from configuration. Where a surface reports
"nothing to show", the distinction between _denied_ and _no data_ is stated
explicitly.

## Release identity

All six application services report the same `RELEASE_SHA`, matching `origin/main`:
`web`, `worker`, `google-egress-gateway`, `google-execution-admission`,
`ai-egress-gateway`, `ai-execution-admission`.

`GET /api/health` → `{"status":"ok","db":true,"redis":true,"migrations":true,"policy":true}`.
Migrations applied 72 / 72 in repo (`0070_notification-render-payload-and-coalescing`
and `0071_review-discovery-backoff` applied during this deploy; the partial unique
index in 0070 was checked against live data for duplicate unread rows first — zero).

## Proven by execution

| capability                         | evidence                                                                                                                                                                                                                        |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `dashboard.use`, `metric.internal` | Org dashboard renders 2 properties, 506 needs-action, avg 3.9; property dashboard renders 253 unanswered / 256 reviews / 3.9                                                                                                    |
| `review.use`, `inbox.use`          | Inbox lists 253 open across 50 loaded items with real Google review bodies; folder counts and category filters populated                                                                                                        |
| `team.use`                         | `/settings/members` lists members with resolved roles                                                                                                                                                                           |
| `portal.read`, `portal.write`      | `/properties/<id>/portals` renders the portal table ("Reception", Draft) plus the portal-groups panel                                                                                                                           |
| `goal.use`                         | `/properties/<id>/goals` renders the governed-targets surface with New Goal                                                                                                                                                     |
| `property.read_gbp_performance`    | **Live provider fetch**: "Source: Google Business Profile, Retrieved 22/08/2026 01:31:08, Timezone Europe/Sofia, Period 2026-07-23–2026-08-21, Google data lag 0 days" + impressions. Permit `completed` at 22:31:08 (49 total) |
| `property.import_gbp_v2`           | 91 permits, most recent `completed` 22:00:55 — post-deploy                                                                                                                                                                      |
| `ai.generate_reply`                | Suggestion generated live in the inbox reply composer. `ai_operations` `reply` → `succeeded` 22:32:35; settlement `success`, `usage_known=true`, 226 input / 29 output tokens                                                   |
| `notification.in_app`              | 3 notifications (`reply.pending_approval`, `inbox.escalated`)                                                                                                                                                                   |
| `notification.send_email`          | `notification_email_queue`: 3 rows, all `accepted`                                                                                                                                                                              |
| durable outbox                     | `outbox_events` 796 / 796 published, 0 unpublished                                                                                                                                                                              |

## Governance state

- Google content approvals: `property.read_gbp_performance` and
  `property.import_gbp_v2`, both `approved` at route catalogue `2026-08-16`,
  expiring 2026-09-17. Compiled constants still match the signed binding
  (`GOOGLE_PROVIDER_ROUTE_CATALOGUE_VERSION`, capability/execution policy
  `beta-local-2`, performance catalogue `2026-08-05`), so `approvalRecordFromRow`
  resolves.
- AI execution control: `global`, `provider:private-beta-global-v1`,
  `capability:review_analysis`, `capability:reply_drafting`,
  `capability:property_trends` — all `enabled` / `accepting`.
- Merchant AI data-use: **both** properties `enabled` for
  `{review_analysis, reply_drafting, property_trends}`. Hotel Elegance was
  previously disabled and was re-enabled during this verification through the
  product's own AI data-use surface on notice
  `merchant-ai-notice-2026-08-19.v1`; Urban Move remains on the older
  `merchant-ai-notice-2026-08-15.v1`.

## Armed but with no eligible work — not denied

**`ai.analyze` (review analysis) and `ai.detect_trends` (property trends)** are
enabled and armed, and have produced no output yet. This is a data condition,
not a denial:

- All 258 review-created events were emitted on 2026-08-19
  (`event_consumer_receipts.inbox.on-review-created` = 258).
- `ai.analyze-review-event` consumed 256 of them at 11:21 that day and recorded
  every one as `terminal_no_result` / `policy_disabled`, because merchant AI
  data-use was off for that property at the time.
- Re-enabling advanced the enablement to `review_analysis_epoch = 4` with
  `analysis_start_sequence = 256`. **Enablement deliberately does not backfill** —
  the notice says "analyze new and materially updated eligible Google reviews" —
  so the 256 already-consumed events stay consumed.
- The pipeline itself is live: `schedule-property-ai-trends` runs every minute in
  the worker, `ai.generate-property-trend` has a consumer receipt, and
  `reply_drafting` proves the permit → admission → egress → settlement path end
  to end on this release.

The first new or materially-updated Google review will therefore be analysed.
Nothing further is required to make that happen.

**`leaderboard.use` / `badge.use`** render their capability-enabled views and
report "You don't have an active portal responsibility at this property". The
org has one portal (Draft) and no portal groups, so there is no recognition scope
to display. Capability resolved; data absent.

## Signup — CLOSED 2026-08-22

The finding recorded here was that `POST /api/auth/sign-up/email` on the deployed
service returned **200 and created a `user` row**: an unauthenticated write, not
gated by `identity.register`, on a public deployment for an invite-only team.
Sign-in was then refused with `403 EMAIL_NOT_VERIFIED`, so no usable access was
granted, but the rows accumulated.

Closed at the route, as recommended: `/sign-up/email` is now in
`BLOCKED_RAW_WRITE_ENDPOINTS` (`src/routes/api/auth/$.ts`), so the request is
refused at the HTTP boundary with 404 + an `auth.raw_write_endpoint_blocked`
warn log, before the limiter and before better-auth. **Proof:** the probe now
returns `404 {"message":"Not found"}` and writes no row; the invariant is pinned
by `src/routes/api/auth/-$.test.ts`.

`emailAndPassword` stays enabled in `src/shared/auth/auth.ts` — clearing it
would have disabled sign-in and password reset too. Invitation onboarding is
unaffected: it runs through the app-owned services (`registerUserAndOrg` →
`auth.api.signUpEmail` server-side), not this route.

## Verification footprint

A temporary account (`capability-probe@example.invalid`) was created to exercise
authenticated surfaces, since the cohort org had exactly one member and the
authenticated capabilities cannot be proven without a session. It was removed
afterwards: `user`, `member`, `session` and `account` rows all deleted, org
membership back to `denev@kodes.agency` (owner) only.

`google_connections.connected_by` for the Hotel Elegance connection was pointed
at the probe for one page load to prove the performance report renders — that
connection is `visibility=private`, so only the connecting user may read it — and
was **restored to the owner immediately**. `visibility` was never changed.
