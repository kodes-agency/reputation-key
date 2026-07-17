# BQC-1.1 — Field-and-Copy Inventory + Executable Classification

**Date:** 2026-07-17 · **Slice:** BQC-1.1 · **Findings:** SPEC-P0-02, STD-P1-03
**Machine registry:** `src/shared/governance/protected-field-registry.ts` (guarded by `protected-field-registry.test.ts` — fails when a protected field is introduced without a classification)
**Sources:** ADR 0030 (accepted), ADR 0031 (proposed), Google response 2026-07-14, verified code map (this document)

## 1. Executable classification (policy version)

Taxonomy per BQC-1 §3 / ADR 0031. `SourceContentPolicy.policyVersion` is **1** (30-day raw TTL, 25-day refresh-due; only a successful authorized Google fetch advances the clock).

| Classification            | Rule                                                                                | Members                                                                                                                                                                                                                                       |
| ------------------------- | ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `raw_source_content`      | Successful-fetch clock; refresh or remove; expired never served                     | review `text`/`rating`/`reviewer_name`/`reviewer_profile_photo_url`/`language_code`; `replies.text` (google_sync); inbox `snippet`/`reviewer_name`/`rating` (copies — eliminate); event `rating` (eliminate); log/fixture vectors (eliminate) |
| `raw_provider_identifier` | Keep only while required for authorized source operation; remove with source record | `external_id`, `external_location_id`, `google_connection_id`, `gbp_place_id`, `google_account_id`, `google_email`, GBP resource names in jobs/logs, `gbp_cache.*`                                                                            |
| `local_operational_fact`  | Content-free retention schedule                                                     | UUIDs, lifecycle clocks, `content_hash` (non-reversible), internal workflow facts (`rejection_reason`, note text, templates), guest-authored facts, `ip_hash` pseudonyms                                                                      |
| `derived_metadata`        | Separately governed; not BQC-built                                                  | `sentiment_label`/`sentiment_score` (no writer today)                                                                                                                                                                                         |
| `derived_aggregate`       | Must not reconstruct/embed raw content, exact replies, or identifiers               | rollups/materialized views (verified: counts/sums only)                                                                                                                                                                                       |

**Backup/PITR decision (open, owner: security/privacy):** no formal backup/PITR policy exists yet; ADR 0031 requires restore-time purge so restoration cannot resurrect expired content. Decision and evidence are prerequisites to real data (BQC-1.6 restore test). Until then: synthetic/disposable data only (program stop-line).

## 2. Inventory by location

### 2.1 Canonical tables (sole owner: Review context)

- **`reviews`** — raw content (`reviewer_name`, `reviewer_profile_photo_url`, `rating`, `text`, `language_code`), provider IDs (`external_id`, `external_location_id`, `google_connection_id`), lifecycle clocks, `content_hash`, sentiment (dormant). Written only by the sync path (atomic `upsertAndRecord`). Deleted by the daily `purge-expired-reviews` job + property FK cascade.
  - ⚠ **Gap:** rows with `content_expires_at = NULL` are never purged (sim seeds; any pre-0006 row never re-synced).
- **`replies`** — `text` (raw when `google_sync`; user-authored when `internal`), `rejection_reason` (internal fact). Dies with parent review; mirror delete when Google has none.
- **`google_connections`** — `google_account_id`, `google_email` (+ encrypted tokens/scopes). ⚠ **No deletion path anywhere** — disconnect flips status only; identifiers and secrets persist forever (BQC-1.7).
- **`properties`** — `gbp_place_id`, `google_connection_id`. Deleted by property hard-delete.

### 2.2 Inbox denormalized copies (BQC-1.2 eliminates)

- **`inbox_items.snippet`** — full, untruncated review text (up to 10k). Scrubbed **only** on the `review.expired` event path.
- **`inbox_items.reviewer_name`** — same scrub path only.
- **`inbox_items.rating`** — **never scrubbed**.
- ⚠ **No scrub and no row deletion on property hard-delete** — `inbox_items.property_id` has no FK (verified against `drizzle/0000_init.sql`); DB cascade fires no events, leaving orphaned rows with content intact. `property/CONTEXT.md` claims an FK cascade that does not exist.
- **`inbox_notes.text`** — user-authored (non-Google); no deletion path.

### 2.3 Activity / notification

- **`activity_log.payload`** — content-free except: note text ≤100 chars (user-authored), rejection reason (internal), **`google_email`** on connect events (provider identifier). ⚠ No retention job (doc claims 90 days — unimplemented).
- **`notifications.title/body`** — static templates with the rating number only; verified no review text/reviewer identity. No retention.
- **`notification_email_queue`** — status-only ✓ clean.

### 2.4 Outbox (durable transport)

- **`outbox_events.payload`** — identifier-only enforced twice (denylist strip + zod allowlist). Residual protected fields per type: `review.created/updated` → `external_id` + **`rating`** (raw — eliminate in 1.2); `property.created` → `gbp_place_id` + name; `identity.member.invited` → email; `guest.rated` → rating.
- ⚠ **No retention** — `purgePublishedBefore`/`purgeReceiptsBefore` exist but are never scheduled; published and unpublished rows persist forever (BQC-1.6). `event_consumer_receipts` ✓ IDs only.

### 2.5 BullMQ job payloads (Redis, bounded 100/50 per queue)

- `sync-property-reviews`: `locationName` (GBP resource name). Webhook-derived job IDs embed the Pub/Sub messageId.
- `import-property`: `gbpPlaceId`, `businessName`, address, category per location.
- `insert-activity-log`: activity payload (googleEmail / note text vectors).
- `publish-reply`, `purge`/`refresh`, urgent/digest, metric/health: IDs or empty ✓ clean.

### 2.6 Logs / traces / metrics

- ⚠ **Pino has no redaction** (contradicts `docs/security/data-inventory.md:121`): raw GBP API error bodies via `IntegrationError.context` (may contain review text — `google-review-api.adapter.ts:68-79`, logged from sync paths); raw Pub/Sub body + decoded names in the webhook route; `job.data` dump on invalid UUID; arbitrary error messages via `trace.ts`.
- Sentry: `scrubSentryEvent` redacts known content fields ✓ but GBP resource-name URL patterns are not covered.
- Operator stdout: `scripts/check-db.ts` prints reviewer name + text.
- Metrics (`metric_readings`, health): keys + numbers only ✓ clean.

### 2.7 Dashboard / read models / materialized views

- Aggregates only (`mv_*`, `rollup_*`) ✓ clean. `getRecentReviews` maps `text → snippet` as a transient DTO (not persisted) — becomes an authorized-read concern in BQC-1.4.

### 2.8 Webhook / sync-run / import tables

- `inbound_webhook_receipts` (messageId), `review_sync_state` (`watermark_source_name` — Google resource name), `review_sync_runs` (counts): all **dormant — no app writers** ✓ (armed, must inherit policy when wired).
- `gbp_import_jobs`: counters ✓ clean. **`gbp_cache.payload`**: dormant but armed; `deleteAllExpired` never scheduled — first writer creates an unmanaged copy (flag).

### 2.9 Exports / evidence / fixtures / e2e

- No CSV/export feature exists. e2e seeds contain IDs only. Perf seeder inserts no text. Storybook fixtures are fictional (verified). `findings/`, `review/`, `docs/` hold no real review content (grep-verified).
- ⚠ Sim scenario seeds create reviews with `content_expires_at = NULL` (invisible to purge — see 2.1).
- Historical: `scripts/migrations/denormalize-inbox-reviewer-name.sql` is the backfill that created the inbox copies "so they survive review deletion" — superseded; BQC-1.2 reverses it.

### 2.10 Cache

- `createDashboardCache` never called; no review content in Redis beyond bounded BullMQ payloads ✓.

## 3. Worst unmanaged copies (ranked — feeds BQC-1.2/1.6/1.7)

1. `inbox_items.snippet` (full text) + `reviewer_name` + `rating` — partial scrub only; orphaned on property delete; rating never scrubbed.
2. Pino log vectors — GBP error bodies, webhook payload dumps; no redaction.
3. `outbox_events` — `externalId`+`rating` rows forever; purge never scheduled.
4. `google_connections` — tokens/email/account ID survive disconnect indefinitely.
5. Reviews with `content_expires_at = NULL` — invisible to purge.
6. `gbp_cache.payload` — armed dormant cache with unscheduled expiry.
7. `activity_log` — `google_email` + note snippets; no retention job.
8. BullMQ residue — import/activity payloads; bounded but outside any policy.

## 4. Doc/code drift to correct (truthfulness)

- `docs/security/data-inventory.md` misstates: pino redaction (:121), outbox 30-day retention (:79), sync-run writers (:82), token purge on disconnect (:37).
- `src/contexts/property/CONTEXT.md:23,60` claims inbox items cascade via FK — false.

Corrections land with the slices that change the behavior (BQC-1.2/1.6/1.7), so docs and code flip together.
