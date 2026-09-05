# Data Inventory and Lineage Map — Beta

**Date:** 2026-07-14
**Accountable owner:** Bozhidar Denev (product, privacy, security)
**Scope:** All data classes across the Reputation Key beta deployment.
**Beta target subprocessors/boundaries:** Railway-hosted PostgreSQL and private
object storage in the single US Data Cell, Resend (email), and Sentry (error
monitoring). Neon and AWS S3 are not part of the ADR-0057 target topology.
Actual vendor activation, contracts, and regions must be reverified in retained
release/legal evidence before launch; this inventory is not a substitute for
that approval. OpenAI remains governed by its separate capability and provider
approval record.

## Data classes by sensitivity

### 1. User Identity Data (PII)

| Field               | Table                | Source               | Purpose                                                           | Retention                                                            | Deletion                  |
| ------------------- | -------------------- | -------------------- | ----------------------------------------------------------------- | -------------------------------------------------------------------- | ------------------------- |
| User name           | `user.name`          | Sign-up / invitation | Display, greeting                                                 | Account lifetime                                                     | Cascade on user delete    |
| User email          | `user.email`         | Sign-up / invitation | Auth, notifications                                               | Account lifetime                                                     | Cascade on user delete    |
| Email verified flag | `user.emailVerified` | Auth flow            | Access control                                                    | Account lifetime                                                     | Cascade on user delete    |
| User avatar URL     | `user.image`         | OAuth / upload       | Display                                                           | Account lifetime                                                     | Cascade on user delete    |
| Session IP address  | `session.ipAddress`  | Auth middleware      | Written by Better Auth; no reader in the application (write-only) | Cascade on session delete; candidate for non-collection under CNV-01 | Cascade on session delete |
| Session user agent  | `session.userAgent`  | Auth middleware      | Written by Better Auth; no reader in the application (write-only) | Cascade on session delete; candidate for non-collection under CNV-01 | Cascade on session delete |

**Subprocessors:** Railway-hosted PostgreSQL and application services in
`cell-us`.
**Region:** US beta authority in Railway US West/California (`us-west2`). All
supported-country Properties, including European Properties, explicitly route
to this US cell for beta. RepKey makes no EU-residency claim; a future EU cell
requires a new accepted policy/ADR and its own live evidence, not a hidden
fallback.

### 2. Google OAuth Credentials (Secret)

| Field                | Table                                      | Encryption                 | Purpose                   | Retention                        |
| -------------------- | ------------------------------------------ | -------------------------- | ------------------------- | -------------------------------- |
| Access token         | `account.accessToken`                      | None (ephemeral)           | Google API calls          | Token expiry (Google-controlled) |
| Refresh token        | `account.refreshToken`                     | None (Better Auth managed) | Token refresh             | Connection disconnect            |
| Google access token  | `google_connections.encryptedAccessToken`  | AES-256-GCM                | GBP API calls             | Token expiry                     |
| Google refresh token | `google_connections.encryptedRefreshToken` | AES-256-GCM                | Token refresh             | Connection disconnect            |
| Google account ID    | `google_connections.googleAccountId`       | None                       | Account identification    | Connection disconnect            |
| Google email         | `google_connections.googleEmail`           | None                       | Account identification    | Connection disconnect            |
| OAuth scopes         | `google_connections.scopes`                | None                       | Authorization scope audit | Connection disconnect            |

**Subprocessors:** Google Business Profile API.
**Deletion:** Connection disconnect purges tokens; account deletion cascades.

### 3. Google Review Content (Google-sourced PII, 30-day TTL)

| Field              | Table                                               | Purpose                | Retention                                 | Deletion                                                      |
| ------------------ | --------------------------------------------------- | ---------------------- | ----------------------------------------- | ------------------------------------------------------------- |
| Reviewer name      | `review_source_contents.reviewer_name`              | Inbox display          | 30 days from fetch (`content_expires_at`) | Field-level erasure                                           |
| Reviewer photo URL | `review_source_contents.reviewer_profile_photo_url` | Inbox display          | 30 days from fetch                        | Field-level erasure                                           |
| Review text        | `review_source_contents.text`                       | Triage, reply drafting | 30 days from fetch                        | Field-level erasure                                           |
| Rating             | `review_source_contents.rating`                     | Aggregation, display   | 30 days from fetch                        | Field-level erasure                                           |
| Language code      | `review_source_contents.language_code`              | Display                | 30 days from fetch                        | Field-level erasure                                           |
| Google review ID   | `review_source_contents.external_id`                | Sync dedup             | 30 days from fetch                        | Field-level erasure; HMAC subject mapping reconnects identity |
| Review snippet     | `inbox_items.snippet`                               | Inbox preview          | 30 days from source                       | TTL purge job                                                 |

**ADR 0031 compliance:** During the rolling expand phase, writers atomically dual-write `review_source_contents` and nullable compatibility fields on `reviews`. Expiry/provider deletion deletes the source-content row and nulls every raw compatibility field; the stable Review ID and RepKey-owned Replies remain. Reader cutover and compatibility-column contraction require the governed parity seal.

### 4. User-Authored Content

| Field                              | Table                                                     | Purpose                                                                                                                                                                    | Retention                                                                                                                     | Deletion                                                                                                                                              |
| ---------------------------------- | --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Reply text                         | `replies.text`                                            | Published to Google                                                                                                                                                        | Published or rejected                                                                                                         | Property archive/purge                                                                                                                                |
| Reply rejection reason             | `replies.rejectionReason`                                 | Audit                                                                                                                                                                      | 90 days                                                                                                                       | Hard delete                                                                                                                                           |
| Inbox note text                    | `inbox_notes.text`                                        | Internal triage notes                                                                                                                                                      | Property lifetime                                                                                                             | Property archive/purge                                                                                                                                |
| Notification title/body            | `notifications.title/body`                                | In-app display                                                                                                                                                             | 90 days                                                                                                                       | Hard delete                                                                                                                                           |
| Legacy feedback comment            | `feedback.comment`                                        | Read-only migration source                                                                                                                                                 | Property lifetime                                                                                                             | Property archive/purge                                                                                                                                |
| Private feedback text              | `guest_response_private_feedback.body`                    | Manager feedback workflow                                                                                                                                                  | 90 days maximum                                                                                                               | Immediate guest withdrawal or retention deletion                                                                                                      |
| Recent Activity transition         | `recent_activity_entries.payload`                         | Manager convenience feed                                                                                                                                                   | Exactly 90 days from source occurrence                                                                                        | Bounded retention sweep                                                                                                                               |
| Recent Activity replay fact        | `recent_activity_replay_facts.transition_payload`         | Identifier/code-only rebuild authority; not audit evidence                                                                                                                 | Exactly 90 days from source occurrence                                                                                        | Bounded retention sweep with evidence                                                                                                                 |
| Recent Activity actor fence        | `recent_activity_actor_label_redactions.actor_subject_id` | Content-free tenant/subject privacy fence preventing delayed delivery or rebuild from restoring an anonymized actor label                                                  | 90 days from the latest bounded redaction application                                                                         | Bounded retention sweep at `expires_at`; no name, avatar, email, or source content                                                                    |
| Recent Activity vocabulary receipt | `recent_activity_vocabulary_reconciliations`              | Content-minimal evidence binding one reviewed source-code group, exact fingerprint, canonical destination, actor, and support reference; no projection row IDs or payloads | Retained through reconciliation retry/recovery and the compatibility audit window                                             | Export/restore/retention/erasure proof is required before contraction; apply is only through the report-first, ticketed Organization operator command |
| Operational action attribution     | `operational_action_history_records.actor_id/resource_id` | Restricted tenant/resource/actor attribution for the explicit ADR 0056 action vocabulary; no generic payload or source content                                             | Proposed 365-day horizon is report-only pending counsel; active holds override it                                             | One-way, hold-aware identifier redaction in batches of at most 100; no destructive retention apply exists                                             |
| Operational history legal hold     | `operational_action_history_legal_holds`                  | Identifier/reason-code-only placement and release evidence                                                                                                                 | Retained while active and while lifecycle policy remains pending counsel                                                      | Placement is append-oriented; only a one-time release transition is permitted                                                                         |
| Beta feedback report               | Restricted Sentry project only                            | Beta debugging/improvement                                                                                                                                                 | Pending approved Sentry event-retention configuration; blocks external beta                                                   | Provider/project retention deletion                                                                                                                   |
| Optional masked Bug layout         | Restricted Sentry attachment only                         | Consented layout diagnosis without pixels or page content                                                                                                                  | Server carries an expiry no later than 30 days; matching provider deletion setting and live expiry proof remain release gates | Provider/project attachment-retention deletion; no product copy                                                                                       |
| Beta feedback triage receipt       | `beta_feedback_triage`                                    | Content-free delivery state, controlled diagnostics, classification, dedupe, ownership, response, and safe provider/issue linkage                                          | Pending approved support-metadata horizon; no automated destructive path                                                      | Not implemented; retention approval and restore/erasure evidence required first                                                                       |
| Beta feedback transition evidence  | `beta_feedback_triage_transitions`                        | Append-only content-free revision, classification, owner, ticket, and operator-pseudonym evidence                                                                          | Recoverable support/audit window pending approval                                                                             | Update/delete/truncate guarded; future contraction requires explicit retention and restore policy                                                     |

### 5. Pseudonymous Identifiers

| Field                            | Table                                           | Purpose                                                                                            | Hashing                                                           | Retention                                                                                                       |
| -------------------------------- | ----------------------------------------------- | -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Guest network-pressure pseudonym | `guest_network_pressure_records.pseudonym`      | Portal-scoped pressure checks for rating, private feedback, destination action, and qualified scan | Organization + Portal + action + UTC-day-scoped keyed HMAC-SHA256 | Unusable at exact 7-day expiry; bounded complete-row cleanup with content-free evidence                         |
| Guest session ID                 | `scan_events.session_id`                        | Visit integrity                                                                                    | Random UUID                                                       | 24 hours (then redacted)                                                                                        |
| Legacy rating IP-hash slot       | `ratings.ip_hash`                               | Nullable schema compatibility only                                                                 | No active writer                                                  | Cleared by migration 0142; legacy sweep remains as restore/backfill defence                                     |
| Rating session ID                | `ratings.session_id`                            | Legacy response integrity                                                                          | Random UUID                                                       | 24 hours (then redacted)                                                                                        |
| Legacy feedback IP-hash slot     | `feedback.ip_hash`                              | Nullable schema compatibility only                                                                 | No active writer                                                  | Cleared by migration 0142; legacy sweep remains as restore/backfill defence                                     |
| Feedback session ID              | `feedback.session_id`                           | Legacy response integrity                                                                          | Random UUID                                                       | 24 hours (then redacted)                                                                                        |
| Legacy scan IP-hash slot         | `scan_events.ip_hash`                           | Nullable schema compatibility only                                                                 | No active writer                                                  | Cleared by migration 0142; legacy sweep remains as restore/backfill defence                                     |
| Destination action session ID    | `guest_destination_action_receipts.session_id`  | First-action integrity                                                                             | Random signed-session UUID                                        | Until signed-session expiry (max 24 hours; row deleted)                                                         |
| Guest Response session ID        | `guest_response_session_bindings.session_id`    | Response recovery/integrity                                                                        | Random signed-session UUID                                        | Re-signed only to the committed rating/feedback withdrawal deadline (24 hours; row deleted)                     |
| Beta feedback actor/Organization | Sentry feedback tags and `beta_feedback_triage` | Abuse control and private support correlation                                                      | Audience-separated HMAC-SHA256                                    | Provider event follows the approved Sentry setting; local content-free receipt horizon remains pending approval |
| Beta feedback triage owner       | `beta_feedback_triage` and transition evidence  | Named internal ownership without storing the operator/owner identity                               | Audience-separated HMAC-SHA256                                    | Same as the approved content-free triage-evidence horizon                                                       |

**Note:** Raw guest IP addresses are never stored. Guest network pressure uses a
versioned `GUEST_SESSION_SALT` derivation separated by Organization, Portal,
action class, and UTC day. Its content-free rows contain no session, destination, source, content,
staff, or analytics identity and are never used for staff attribution or metric
segmentation. The row becomes unusable at its exact seven-day expiry and the
bounded sweep deletes it independently, so managerial visit/rating/feedback facts remain without a network pseudonym. Audit
log IP addresses (`audit_logs.ip_address`) store the derived client IP for security
audit — these are operator-accessible only.

Migration 0142 does not import v1 hashes because they lacked Portal and action
separation. It clears the old columns, and Guest persistence mappers cannot
repopulate them. Signed-session correctness and Redis pressure stay active while
the v2 authority begins accumulating independently separated records.

### 6. Operational Metadata (non-PII)

| Field                            | Table                                                                                                                            | Purpose                                                                                                                                                                                               | Retention                                                                                                                               |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Outbox events                    | `outbox_events`                                                                                                                  | Event delivery tracking                                                                                                                                                                               | 30 days (published), 7 days (unpublished errors)                                                                                        |
| Consumer receipts                | `event_consumer_receipts`                                                                                                        | Idempotency                                                                                                                                                                                           | 30 days                                                                                                                                 |
| Sync state                       | `review_sync_state`                                                                                                              | Incremental sync cursor                                                                                                                                                                               | Property lifetime                                                                                                                       |
| Sync run history                 | `review_sync_runs`                                                                                                               | Operational audit                                                                                                                                                                                     | 30 days                                                                                                                                 |
| Webhook receipts                 | `inbound_webhook_receipts`                                                                                                       | Dedup                                                                                                                                                                                                 | 30 days                                                                                                                                 |
| Digest batch evidence            | `notification_digest_batches` / members                                                                                          | Exact email membership, idempotency and outcome (identifiers/digests only; no rendered content)                                                                                                       | 90 days after terminal outcome                                                                                                          |
| Guest Response fact/tombstone    | `guest_responses`                                                                                                                | Rating lineage, correction integrity, managerial analytics                                                                                                                                            | 24 calendar months from initial submission                                                                                              |
| Guest observation-loss aggregate | Cache Redis hash `ops:guest-observation-loss:v1:aggregate`                                                                       | Global completeness signal for suppressed scan/review-link analytics; continuity epoch plus fixed bucket/class counters only, no identifiers or content                                               | Stale fields pruned on access; single key refreshed with 24h05m TTL                                                                     |
| Inbox Response Target policies   | `inbox_response_target_organization_policies` / `inbox_private_feedback_target_property_overrides`                               | Content-free current duration/version authority and updater identifier; no guest or manager-authored content                                                                                          | Organization/Property lifecycle; Property override cascades with Property, Organization policy requires Organization lifecycle deletion |
| Inbox Response Target history    | `inbox_handling_cycle_response_targets` / `inbox_response_target_reminders`                                                      | Content-free cycle timing/result and one-shot reminder evidence; no feedback text, rating, note, or review content                                                                                    | Retained with the owning Inbox Handling Cycle for scoped analytics/export/restore; cascades only when the owning cycle is deleted       |
| Rollup watermarks                | `_rollup_watermarks`                                                                                                             | Incremental refresh                                                                                                                                                                                   | Permanent                                                                                                                               |
| Capability decisions             | (env vars)                                                                                                                       | Feature gating                                                                                                                                                                                        | Not persisted in DB                                                                                                                     |
| Organization lifecycle authority | `organization_lifecycle_authority`                                                                                               | Content-free state/revision/deadline/actor/reason-code/support-reference closure fence; no customer text, export, or provider payload                                                                 | Retained through closure; final evidence horizon requires lifecycle/legal approval                                                      |
| Organization lifecycle receipts  | `organization_lifecycle_command_receipts`, `identity_organization_lifecycle_receipts`, `organization_export_retrieval_issuances` | Append-only content-free idempotency results for request/cancel operation UUIDs and transaction-bound Identity phases; digest-only history permanently retires each issued export retrieval authority | Retention not yet activated; must cover the recovery/retry horizon and approved evidence policy                                         |

### 7. Cached Google API Responses

| Field              | Table                         | Purpose                     | Retention                           |
| ------------------ | ----------------------------- | --------------------------- | ----------------------------------- |
| GBP cache payload  | `gbp_cache.payload`           | Rate-limit-friendly caching | `expires_at` (Google cache-control) |
| Google attribution | `gbp_cache.googleAttribution` | Display compliance          | Same as payload                     |

### 8. Governed AI data classes — local implementation, deployment held

The AI schema and local authorization/derivative lifecycles are implemented;
that code presence is not provider or beta activation evidence. Provider use
and real-data release remain held to the approval and deployed-evidence gates
below. The implementation separates:

| Class                        | Permitted shape                                                                                                             | Planned retention/deletion                                                                                                                                                      |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Transient inference material | One minimized/redacted current review, or aggregate-only deterministic trend candidates; strict provider output             | Request-local only; never jobs/Redis/logs/traces/evidence/backups; discard on every terminal or post-return denial                                                              |
| Derived review metadata      | Property-scoped sentiment/category/attention facts without text, PII, Google IDs, exact replies, or reversible fingerprints | Hidden immediately on authorization/source fence change; exact retired generation physically erased within 24h with content-free evidence                                       |
| AI reply suggestion          | One untrusted, unpublished suggestion adopted only by explicit manager action                                               | Transient until explicit adoption; adopted draft remains AI-labelled and follows draft/deletion rules; publication is separate                                                  |
| Property trend report        | Aggregate-only deterministic values plus bounded narrative and selected opaque signal IDs                                   | Property/profile scoped; previous valid report may survive a failed refresh while authorized; hidden immediately and retired generation erased within 24h on lifecycle triggers |
| AI control/evidence          | Epochs, policy/profile versions, permit/quota states, code-only outcomes, counts, timestamps, digests                       | Content-free; bounded operational retention defined by the AI schema/release profile                                                                                            |

The candidate subprocessor is the exact
[`openai-responses-gpt-5-4-mini-2026-03-17-us-zdr-v1`](../archive/2026-09-lean/product-readiness-program-2026-07/ai-governance/openai-gpt-5-4-mini-us-zdr-assessment.md)
deployment. It remains rejected until contract/DPA, US full-path location,
project-level ZDR/no-sharing configuration, redaction, target-runtime, and
release evidence are approved.

## Data flow map

```
Google GBP API → OAuth (encrypted tokens) → Review sync → PostgreSQL (reviews, 30-day TTL)
                                                            ↓
                                                      Outbox events (identifier-only)
                                                            ↓
                                                      BullMQ (Redis) → Dispatcher → Consumers
                                                            ↓
                                                      Inbox projection → Dashboard (aggregated)
                                                            ↓
                                                      Human reply → Outbox → Google Publish API

Guest browser → Signed session → Rating/Feedback → PostgreSQL (IP hashed)
                                                        ↓
                                                  Portal display (property-scoped)
```

## Backup treatment

- PostgreSQL backups (PITR) contain all tables including PII.
- Review content in backups expires via `content_expires_at` on next TTL purge after restore.
- OAuth tokens in backups are encrypted (AES-256-GCM).
- Backups are region-locked to the same processing region as the primary database.

## Logging and tracing

- Structured logs (Pino) redact: tokens, cookies, authorization headers, review text, reviewer names, emails, presigned URLs.
- Traces (`src/shared/observability/trace.ts`) record operation name + duration only — no payload data.
- Sentry error monitoring (active for beta) uses a Germany-only DSN guard and
  outbound allowlist scrubbers for error events, transactions, and breadcrumbs.
- Native beta feedback sends the manager-entered report, Bug/Suggestion
  classification, controlled route template, broad viewport category, role,
  release/cell/service tags, and audience-separated HMAC actor/Organization
  pseudonyms. Suggestions are text-only. After a separate Bug-only consent and
  explicit capture action on an allowlisted route, a Bug may also send one
  server-rendered masked-layout SVG made solely from quantized rectangle
  geometry and closed block kinds. It sends no name/email, raw tenant/property/
  route identifiers, cookies, request bodies, page text, input values, image or
  media bytes, ordinary screenshot, or replay. User-entered report text can
  still contain personal data despite automated redaction, so the UI warns
  managers not to submit guest/review/contact/credential content and the Sentry
  project remains restricted operator data. PostgreSQL keeps only the
  content-free local receipt and triage evidence.

## Gap remediation (pre-BETA-1)

- [ ] Confirm Pino redaction patterns are active in production (currently configured, needs deployment verification)
- [ ] Verify TTL purge job runs against restored backup (content_expires_at enforcement after PITR)
- [x] Rate limiting on auth endpoints (login, registration) — shared Redis limiter, fails closed in production; raw `/sign-up/email` refused at the boundary
- [x] Initialize Sentry SDK with outbound allowlist scrubbers, a text-only
      Suggestion boundary, and a separately consented Bug-only masked-layout
      boundary; ordinary screenshots and replay remain prohibited (deployment
      uses a mandatory Germany DSN)
- [x] Persist a content-free local feedback receipt and revision-fenced,
      append-only triage evidence without report text or attachment bytes
- [ ] Approve and evidence the exact Sentry event/feedback retention setting,
      attachment expiry (no more than 30 days), operator access, inbound project
      scrubbers, and Germany project in the RC
