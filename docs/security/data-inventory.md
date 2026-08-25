# Data Inventory and Lineage Map — Beta

**Date:** 2026-07-14
**Accountable owner:** Bozhidar Denev (product, privacy, security)
**Scope:** All data classes across the Reputation Key beta deployment.
**Active subprocessors:** Neon (PostgreSQL), Resend (email), AWS S3 (eu-west-3), Sentry (error monitoring). OpenAI is an unapproved candidate and receives no RepKey data.

## Data classes by sensitivity

### 1. User Identity Data (PII)

| Field               | Table                | Source               | Purpose             | Retention                | Deletion                  |
| ------------------- | -------------------- | -------------------- | ------------------- | ------------------------ | ------------------------- |
| User name           | `user.name`          | Sign-up / invitation | Display, greeting   | Account lifetime         | Cascade on user delete    |
| User email          | `user.email`         | Sign-up / invitation | Auth, notifications | Account lifetime         | Cascade on user delete    |
| Email verified flag | `user.emailVerified` | Auth flow            | Access control      | Account lifetime         | Cascade on user delete    |
| User avatar URL     | `user.image`         | OAuth / upload       | Display             | Account lifetime         | Cascade on user delete    |
| Session IP address  | `session.ipAddress`  | Auth middleware      | Security audit      | Session expiry (30 days) | Cascade on session delete |
| Session user agent  | `session.userAgent`  | Auth middleware      | Security audit      | Session expiry           | Cascade on session delete |

**Subprocessors:** PostgreSQL provider (Neon), application server host.
**Region:** US (pilot). EU data requires EU processing cell before European properties.

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

| Field              | Table                             | Purpose                | Retention                                 | Deletion               |
| ------------------ | --------------------------------- | ---------------------- | ----------------------------------------- | ---------------------- |
| Reviewer name      | `reviews.reviewerName`            | Inbox display          | 30 days from fetch (`content_expires_at`) | TTL purge job          |
| Reviewer photo URL | `reviews.reviewerProfilePhotoUrl` | Inbox display          | 30 days from fetch                        | TTL purge job          |
| Review text        | `reviews.text`                    | Triage, reply drafting | 30 days from fetch                        | TTL purge job          |
| Rating             | `reviews.rating`                  | Aggregation, display   | Retained (not PII)                        | Property archive/purge |
| Language code      | `reviews.languageCode`            | Display                | 30 days from fetch                        | TTL purge job          |
| Google review ID   | `reviews.externalId`              | Sync dedup             | Retained (identifier)                     | Property archive/purge |
| Review snippet     | `inbox_items.snippet`             | Inbox preview          | 30 days from source                       | TTL purge job          |

**ADR 0031 compliance:** Raw content stored for max 30 days; `source_created_at` and `content_expires_at` track the lifecycle. `content_hash` detects changes. Refresh threshold at 25 days provides 5-day safety margin.

### 4. User-Authored Content

| Field                   | Table                           | Purpose                    | Retention             | Deletion                                          |
| ----------------------- | ------------------------------- | -------------------------- | --------------------- | ------------------------------------------------- |
| Reply text              | `replies.text`                  | Published to Google        | Published or rejected | Property archive/purge                            |
| Reply rejection reason  | `replies.rejectionReason`       | Audit                      | 90 days               | Hard delete                                       |
| Inbox note text         | `inbox_notes.text`              | Internal triage notes      | Property lifetime     | Property archive/purge                            |
| Notification title/body | `notifications.title/body`      | In-app display             | 90 days               | Hard delete                                       |
| Legacy feedback comment | `feedback.comment`              | Read-only migration source | Property lifetime     | Property archive/purge                            |
| Private feedback text   | `guest_responses.response_text` | Manager feedback workflow  | 90 days maximum       | Immediate guest withdrawal or retention redaction |
| Activity description    | `activity_log`                  | Audit trail                | 90 days               | Hard delete                                       |

### 5. Pseudonymous Identifiers

| Field                         | Table                                          | Purpose                     | Hashing                    | Retention                                                                                      |
| ----------------------------- | ---------------------------------------------- | --------------------------- | -------------------------- | ---------------------------------------------------------------------------------------------- |
| Guest IP hash                 | `scan_events.ip_hash`                          | Abuse prevention            | Daily rotating keyed hash  | 7 days (then redacted)                                                                         |
| Guest session ID              | `scan_events.session_id`                       | Visit integrity             | Random UUID                | 24 hours (then redacted)                                                                       |
| Rating IP hash                | `ratings.ip_hash`                              | Legacy dedup                | Daily rotating keyed hash  | 7 days (then redacted)                                                                         |
| Rating session ID             | `ratings.session_id`                           | Legacy response integrity   | Random UUID                | 24 hours (then redacted)                                                                       |
| Feedback IP hash              | `feedback.ip_hash`                             | Legacy abuse prevention     | Daily rotating keyed hash  | 7 days (then redacted)                                                                         |
| Feedback session ID           | `feedback.session_id`                          | Legacy response integrity   | Random UUID                | 24 hours (then redacted)                                                                       |
| Destination action session ID | `guest_destination_action_receipts.session_id` | First-action integrity      | Random signed-session UUID | Until signed-session expiry (max 24 hours; row deleted)                                        |
| Guest Response session ID     | `guest_responses.session_id`                   | Response recovery/integrity | Random signed-session UUID | Currently canonical-row lifecycle; class separation to a 24-hour binding is required by GST-01 |

**Note:** Raw guest IP addresses are never stored. Guest hashing uses the rotating `GUEST_SESSION_SALT` derivation; the resulting abuse pseudonym is scrubbed independently so the managerial visit/rating/feedback fact remains. Audit log IP addresses (`audit_logs.ip_address`) store the derived client IP for security audit — these are operator-accessible only.

### 6. Operational Metadata (non-PII)

| Field                 | Table                                   | Purpose                                                                                         | Retention                                        |
| --------------------- | --------------------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| Outbox events         | `outbox_events`                         | Event delivery tracking                                                                         | 30 days (published), 7 days (unpublished errors) |
| Consumer receipts     | `event_consumer_receipts`               | Idempotency                                                                                     | 30 days                                          |
| Sync state            | `review_sync_state`                     | Incremental sync cursor                                                                         | Property lifetime                                |
| Sync run history      | `review_sync_runs`                      | Operational audit                                                                               | 30 days                                          |
| Webhook receipts      | `inbound_webhook_receipts`              | Dedup                                                                                           | 30 days                                          |
| Digest batch evidence | `notification_digest_batches` / members | Exact email membership, idempotency and outcome (identifiers/digests only; no rendered content) | 90 days after terminal outcome                   |
| Rollup watermarks     | `_rollup_watermarks`                    | Incremental refresh                                                                             | Permanent                                        |
| Capability decisions  | (env vars)                              | Feature gating                                                                                  | Not persisted in DB                              |

### 7. Cached Google API Responses

| Field              | Table                         | Purpose                     | Retention                           |
| ------------------ | ----------------------------- | --------------------------- | ----------------------------------- |
| GBP cache payload  | `gbp_cache.payload`           | Rate-limit-friendly caching | `expires_at` (Google cache-control) |
| Google attribution | `gbp_cache.googleAttribution` | Display compliance          | Same as payload                     |

### 8. Planned AI data classes — dark

No AI schema, provider deployment, or real-data flow is active. The accepted
target, if later approved, separates:

| Class                        | Permitted shape                                                                                                             | Planned retention/deletion                                                                                                     |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Transient inference material | One minimized/redacted current review, or aggregate-only deterministic trend candidates; strict provider output             | Request-local only; never jobs/Redis/logs/traces/evidence/backups; discard on every terminal or post-return denial             |
| Derived review metadata      | Property-scoped sentiment/category/attention facts without text, PII, Google IDs, exact replies, or reversible fingerprints | Versioned TTL and lifecycle participant; purge/null linkage on expiry, revocation, delete, and restore reconciliation          |
| AI reply suggestion          | One untrusted, unpublished suggestion adopted only by explicit manager action                                               | Transient until explicit adoption; adopted draft remains AI-labelled and follows draft/deletion rules; publication is separate |
| Property trend report        | Aggregate-only deterministic values plus bounded narrative and selected opaque signal IDs                                   | Property/profile scoped; previous valid report may survive a failed refresh; purge on required lifecycle triggers              |
| AI control/evidence          | Epochs, policy/profile versions, permit/quota states, code-only outcomes, counts, timestamps, digests                       | Content-free; bounded operational retention defined by the AI schema/release profile                                           |

The candidate subprocessor is the exact
[`openai-responses-gpt-5-4-mini-2026-03-17-us-zdr-v1`](../product-readiness-program-2026-07/ai-governance/openai-gpt-5-4-mini-us-zdr-assessment.md)
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
- Sentry error monitoring (active for beta): `beforeSend` hook must scrub review text, reviewer names, emails, tokens, and Google identifiers from event payloads before transmission. Initialization pending (BETA-3).

## Gap remediation (pre-BETA-1)

- [ ] Confirm Pino redaction patterns are active in production (currently configured, needs deployment verification)
- [ ] Verify TTL purge job runs against restored backup (content_expires_at enforcement after PITR)
- [x] Rate limiting on auth endpoints (login, registration) — shared Redis limiter, fails closed in production; raw `/sign-up/email` refused at the boundary
- [ ] Initialize Sentry SDK with PII-scrubbing `beforeSend` hook (BETA-3)
