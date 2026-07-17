// ProtectedFieldRegistry — BQC-1.1 / SPEC-P0-02 / STD-P1-03.
//
// The executable classification for every protected field/copy in the system
// (ADR 0031 + Google response 2026-07-14). A registry test fails when a
// protected field is introduced anywhere without a classification entry —
// schema column, event payload field, or job payload field.
//
// Classification taxonomy (phase BQC-1 §3):
//   raw_source_content      — review text, rating, reviewer name/photo/profile,
//                             language; Google-observed reply text/status.
//                             Rule: successful-fetch clock; refresh or remove.
//   raw_provider_identifier — Google review/location/account identifiers.
//                             Rule: keep only while required for authorized
//                             source operation; remove with source record.
//   local_operational_fact  — local UUIDs, processing status, content-free
//                             facts. Rule: content-free retention schedule.
//   derived_metadata        — sentiment/category (separately governed; not
//                             part of BQC implementation).
//   derived_aggregate       — counts/aggregates. Rule: must not reconstruct or
//                             embed raw content/exact replies/identifiers.

export type ProtectedFieldClassification =
  | 'raw_source_content'
  | 'raw_provider_identifier'
  | 'local_operational_fact'
  | 'derived_metadata'
  | 'derived_aggregate'

/** The kind of structure holding the field. */
export type ProtectedFieldRelationKind =
  | 'table' // drizzle/pg table column
  | 'event' // domain/outbox event payload field
  | 'job' // BullMQ job payload field
  | 'artifact' // logs/traces/exports/fixtures (non-schema copy)

export type ProtectedFieldRule = Readonly<{
  /** Relation identifier: table name, `event:<type>`, `job:<name>`, or artifact path. */
  relation: string
  kind: ProtectedFieldRelationKind
  /** Column or payload field name. */
  field: string
  classification: ProtectedFieldClassification
  /** Owning context (sole writer/authority). */
  owner: string
  purpose: string
  /** Creation path (who writes this copy). */
  creationPath: string
  /** Read path (who serves this copy). */
  readPath: string
  /** TTL/refresh rule, e.g. 'successful-fetch clock (30d TTL)'. */
  refreshRule: string
  /** Deletion mechanism, or 'none — unmanaged copy' when missing. */
  deletionMechanism: string
  /** True when BQC-1.2+ must eliminate this convenience copy. */
  mustEliminate: boolean
}>

/**
 * The registry. Every protected field/copy in the system has exactly one
 * entry. The inventory narrative lives in
 * docs/product-readiness-program-2026-07/beta-quality-remediation-2026-07/completion-program-2026-07/bqc1-field-copy-inventory.md
 */
export const PROTECTED_FIELD_REGISTRY: ReadonlyArray<ProtectedFieldRule> = [
  // ── reviews (canonical raw content — sole owner: Review context) ────
  {
    relation: 'reviews',
    kind: 'table',
    field: 'external_id',
    classification: 'raw_provider_identifier',
    owner: 'review',
    purpose: 'Google review ID — dedupe/upsert key',
    creationPath: 'sync-reviews upsert',
    readPath: 'authorized Review lookup',
    refreshRule: 'kept while required for source operation',
    deletionMechanism: 'purge-expired-reviews job (daily); property cascade',
    mustEliminate: false,
  },
  {
    relation: 'reviews',
    kind: 'table',
    field: 'external_location_id',
    classification: 'raw_provider_identifier',
    owner: 'review',
    purpose: 'GBP location resource name (accounts/…/locations/…)',
    creationPath: 'sync-reviews upsert',
    readPath: 'authorized Review lookup; reply publish path',
    refreshRule: 'kept while required for source operation',
    deletionMechanism: 'purge-expired-reviews job; property cascade',
    mustEliminate: false,
  },
  {
    relation: 'reviews',
    kind: 'table',
    field: 'google_connection_id',
    classification: 'raw_provider_identifier',
    owner: 'review',
    purpose: 'Owning Google connection FK',
    creationPath: 'sync-reviews upsert',
    readPath: 'sync/publish paths',
    refreshRule: 'kept while required for source operation',
    deletionMechanism: 'set null on connection delete; purge job; cascade',
    mustEliminate: false,
  },
  {
    relation: 'reviews',
    kind: 'table',
    field: 'reviewer_name',
    classification: 'raw_source_content',
    owner: 'review',
    purpose: 'Reviewer display name (Google)',
    creationPath: 'sync-reviews upsert',
    readPath: 'authorized Review lookup only',
    refreshRule: 'successful-fetch clock (30d TTL)',
    deletionMechanism: 'purge-expired-reviews job; property cascade',
    mustEliminate: false,
  },
  {
    relation: 'reviews',
    kind: 'table',
    field: 'reviewer_profile_photo_url',
    classification: 'raw_source_content',
    owner: 'review',
    purpose: 'Reviewer profile photo URL (Google)',
    creationPath: 'sync-reviews upsert',
    readPath: 'authorized Review lookup only',
    refreshRule: 'successful-fetch clock (30d TTL)',
    deletionMechanism: 'purge-expired-reviews job; property cascade',
    mustEliminate: false,
  },
  {
    relation: 'reviews',
    kind: 'table',
    field: 'rating',
    classification: 'raw_source_content',
    owner: 'review',
    purpose: 'Star rating (Google)',
    creationPath: 'sync-reviews upsert',
    readPath: 'authorized Review lookup; aggregates',
    refreshRule: 'successful-fetch clock (30d TTL)',
    deletionMechanism: 'purge-expired-reviews job; property cascade',
    mustEliminate: false,
  },
  {
    relation: 'reviews',
    kind: 'table',
    field: 'text',
    classification: 'raw_source_content',
    owner: 'review',
    purpose: 'Review text (Google)',
    creationPath: 'sync-reviews upsert',
    readPath: 'authorized Review lookup only',
    refreshRule: 'successful-fetch clock (30d TTL)',
    deletionMechanism: 'purge-expired-reviews job; property cascade',
    mustEliminate: false,
  },
  {
    relation: 'reviews',
    kind: 'table',
    field: 'language_code',
    classification: 'raw_source_content',
    owner: 'review',
    purpose: 'Review language (Google)',
    creationPath: 'sync-reviews upsert',
    readPath: 'authorized Review lookup only',
    refreshRule: 'successful-fetch clock (30d TTL)',
    deletionMechanism: 'purge-expired-reviews job; property cascade',
    mustEliminate: false,
  },
  {
    relation: 'reviews',
    kind: 'table',
    field: 'content_hash',
    classification: 'local_operational_fact',
    owner: 'review',
    purpose: 'Change-detection baseline (non-reversible SHA)',
    creationPath: 'sync-reviews upsert',
    readPath: 'sync path only',
    refreshRule: 'updated on successful fetch',
    deletionMechanism: 'dies with review row',
    mustEliminate: false,
  },
  {
    relation: 'reviews',
    kind: 'table',
    field: 'sentiment_label',
    classification: 'derived_metadata',
    owner: 'review',
    purpose: 'Per-review sentiment label (separately governed; not BQC-built)',
    creationPath: 'none today (no AI implementation)',
    readPath: 'none today',
    refreshRule: 'separate derivative retention (ADR 0031)',
    deletionMechanism: 'dies with review row',
    mustEliminate: false,
  },
  {
    relation: 'reviews',
    kind: 'table',
    field: 'sentiment_score',
    classification: 'derived_metadata',
    owner: 'review',
    purpose: 'Per-review sentiment score (separately governed)',
    creationPath: 'none today',
    readPath: 'none today',
    refreshRule: 'separate derivative retention (ADR 0031)',
    deletionMechanism: 'dies with review row',
    mustEliminate: false,
  },

  // ── replies ─────────────────────────────────────────────────────────
  {
    relation: 'replies',
    kind: 'table',
    field: 'text',
    classification: 'raw_source_content',
    owner: 'review',
    purpose:
      "Reply text — raw Google-observed when source='google_sync'; user-authored when 'internal' (conservatively raw)",
    creationPath: 'mirrorReply (sync) / internal reply workflow',
    readPath: 'authorized Review lookup; publish path',
    refreshRule: 'same source clock as parent review',
    deletionMechanism: 'cascade with review row; mirror delete when Google has none',
    mustEliminate: false,
  },
  {
    relation: 'replies',
    kind: 'table',
    field: 'rejection_reason',
    classification: 'local_operational_fact',
    owner: 'review',
    purpose: 'Internal reviewer note on rejection (user-authored)',
    creationPath: 'reply-operations reject',
    readPath: 'reply workflow UI',
    refreshRule: 'internal workflow fact',
    deletionMechanism: 'cascade with review row',
    mustEliminate: false,
  },

  // ── google_connections ──────────────────────────────────────────────
  {
    relation: 'google_connections',
    kind: 'table',
    field: 'google_account_id',
    classification: 'raw_provider_identifier',
    owner: 'integration',
    purpose: 'Google account ID for API operation',
    creationPath: 'connect-google-account OAuth',
    readPath: 'integration adapters',
    refreshRule: 'kept while connected',
    deletionMechanism: 'none — survives disconnect (flagged; BQC-1.7 disconnect purge)',
    mustEliminate: false,
  },
  {
    relation: 'google_connections',
    kind: 'table',
    field: 'google_email',
    classification: 'raw_provider_identifier',
    owner: 'integration',
    purpose: 'Google account email (display/audit)',
    creationPath: 'connect-google-account OAuth',
    readPath: 'settings UI; activity log copy (to be content-free)',
    refreshRule: 'kept while connected',
    deletionMechanism: 'none — survives disconnect (flagged; BQC-1.7)',
    mustEliminate: false,
  },

  // ── properties ──────────────────────────────────────────────────────
  {
    relation: 'properties',
    kind: 'table',
    field: 'gbp_place_id',
    classification: 'raw_provider_identifier',
    owner: 'property',
    purpose: 'GBP place ID for sync routing',
    creationPath: 'GBP import',
    readPath: 'sync/webhook routing',
    refreshRule: 'kept while property active',
    deletionMechanism: 'property hard-delete',
    mustEliminate: false,
  },
  {
    relation: 'properties',
    kind: 'table',
    field: 'google_connection_id',
    classification: 'raw_provider_identifier',
    owner: 'property',
    purpose: 'Connection FK for sync routing',
    creationPath: 'GBP import',
    readPath: 'sync/webhook routing',
    refreshRule: 'kept while property active',
    deletionMechanism: 'property hard-delete',
    mustEliminate: false,
  },

  // ── inbox (denormalized convenience copies — eliminated in BQC-1.2) ───
  {
    relation: 'inbox_items',
    kind: 'table',
    field: 'snippet',
    classification: 'raw_source_content',
    owner: 'inbox (copy of review)',
    purpose: 'Legacy denormalized review text copy — writes stopped in BQC-1.2',
    creationPath: 'none since BQC-1.2 (handlers removed)',
    readPath: 'none since BQC-1.2 (mapper never reads it; UI resolves live)',
    refreshRule: 'n/a — content resolves via eligibility-enforcing review lookup',
    deletionMechanism:
      'null-backfill migration (BQC-1.2, bounded/idempotent); column contraction in BQC-1.6/1.7',
    mustEliminate: true,
  },
  {
    relation: 'inbox_items',
    kind: 'table',
    field: 'reviewer_name',
    classification: 'raw_source_content',
    owner: 'inbox (copy of review)',
    purpose: 'Legacy denormalized reviewer name copy — writes stopped in BQC-1.2',
    creationPath: 'none since BQC-1.2',
    readPath: 'none since BQC-1.2 (mapper never reads it)',
    refreshRule: 'n/a — resolves via eligibility-enforcing review lookup',
    deletionMechanism:
      'null-backfill migration (BQC-1.2); column contraction in BQC-1.6/1.7',
    mustEliminate: true,
  },
  {
    relation: 'inbox_items',
    kind: 'table',
    field: 'rating',
    classification: 'raw_source_content',
    owner: 'inbox (copy of review)',
    purpose: 'Legacy denormalized rating copy — writes stopped in BQC-1.2',
    creationPath: 'none since BQC-1.2',
    readPath:
      'none since BQC-1.2 (mapper never reads it; list stars come from live lookup)',
    refreshRule: 'n/a — resolves via eligibility-enforcing review lookup',
    deletionMechanism:
      'null-backfill migration (BQC-1.2); column contraction in BQC-1.6/1.7',
    mustEliminate: true,
  },
  {
    relation: 'inbox_notes',
    kind: 'table',
    field: 'text',
    classification: 'local_operational_fact',
    owner: 'inbox',
    purpose: 'User-authored note (not Google content)',
    creationPath: 'inbox note workflow',
    readPath: 'inbox detail UI',
    refreshRule: 'internal workflow fact',
    deletionMechanism: 'none (inbox_items row never deleted)',
    mustEliminate: false,
  },

  // ── activity / notifications ────────────────────────────────────────
  {
    relation: 'activity_log',
    kind: 'table',
    field: 'payload',
    classification: 'local_operational_fact',
    owner: 'activity',
    purpose:
      'Audit facts {subject, from, to, detail} — googleEmail + note-text vectors eliminated in BQC-1.2 (detail: null); rejection reason retained as minimal reason (ADR 0045 r.4)',
    creationPath: 'insert-activity-log job from event handlers',
    readPath: 'activity UI',
    refreshRule: 'content-free facts only (ADR 0045/0046)',
    deletionMechanism: 'retention-sweep daily (BQC-1.6, 90d) + retention_runs evidence',
    mustEliminate: false,
  },
  {
    relation: 'notifications',
    kind: 'table',
    field: 'title',
    classification: 'local_operational_fact',
    owner: 'notification',
    purpose: 'Static template title (rating number only, no content)',
    creationPath: 'insert-notification job',
    readPath: 'notification UI; email rendering',
    refreshRule: 'content-free templates only',
    deletionMechanism: 'none',
    mustEliminate: false,
  },
  {
    relation: 'notifications',
    kind: 'table',
    field: 'body',
    classification: 'local_operational_fact',
    owner: 'notification',
    purpose:
      'Static template body (rating number only; rejection reason on reply.rejected)',
    creationPath: 'insert-notification job',
    readPath: 'notification UI; email rendering',
    refreshRule: 'content-free templates only',
    deletionMechanism: 'none',
    mustEliminate: false,
  },

  // ── outbox (durable transport) ──────────────────────────────────────
  {
    relation: 'outbox_events',
    kind: 'table',
    field: 'payload',
    classification: 'local_operational_fact',
    owner: 'shared/outbox',
    purpose:
      'Identifier-only event payloads (denylist strip + zod allowlist, ADR 0030). Registered per-type fields below are the residual identifiers.',
    creationPath: 'emit-and-record / event-adapter',
    readPath: 'durable consumers via lookup ports',
    refreshRule: 'identifier-only by construction',
    deletionMechanism:
      'retention-sweep daily (BQC-1.6, 30d) with evidence in retention_runs; invalid DELETE...LIMIT methods removed',
    mustEliminate: false,
  },

  // ── gbp_cache (dormant but armed) ───────────────────────────────────
  {
    relation: 'gbp_cache',
    kind: 'table',
    field: 'gbp_place_id',
    classification: 'raw_provider_identifier',
    owner: 'integration',
    purpose: 'Cache key for GBP location payload',
    creationPath: 'gbp-cache repository upsert (no writer today)',
    readPath: 'none today',
    refreshRule: 'expiresAt per entry',
    deletionMechanism:
      'deleteByConnectionId on disconnect; deleteAllExpired never scheduled',
    mustEliminate: false,
  },
  {
    relation: 'gbp_cache',
    kind: 'table',
    field: 'payload',
    classification: 'raw_provider_identifier',
    owner: 'integration',
    purpose: 'GBP location data cache (dormant — first writer creates an unmanaged copy)',
    creationPath: 'gbp-cache repository upsert (no writer today)',
    readPath: 'none today',
    refreshRule: 'expiresAt per entry',
    deletionMechanism:
      'deleteByConnectionId on disconnect; deleteAllExpired never scheduled',
    mustEliminate: false,
  },
  {
    relation: 'gbp_cache',
    kind: 'table',
    field: 'google_attribution',
    classification: 'raw_provider_identifier',
    owner: 'integration',
    purpose: 'Attribution string for cached GBP data',
    creationPath: 'gbp-cache repository upsert',
    readPath: 'none today',
    refreshRule: 'expiresAt per entry',
    deletionMechanism: 'deleteByConnectionId on disconnect',
    mustEliminate: false,
  },

  // ── sync state (dormant) ────────────────────────────────────────────
  {
    relation: 'review_sync_state',
    kind: 'table',
    field: 'watermark_source_name',
    classification: 'raw_provider_identifier',
    owner: 'review',
    purpose: 'Google review resource name at sync watermark (dormant table)',
    creationPath: 'none today (no writer)',
    readPath: 'health-metrics only',
    refreshRule: 'kept while required for source operation',
    deletionMechanism: 'none',
    mustEliminate: false,
  },

  // ── inbound webhook receipts (dormant) ──────────────────────────────
  {
    relation: 'inbound_webhook_receipts',
    kind: 'table',
    field: 'message_id',
    classification: 'raw_provider_identifier',
    owner: 'integration',
    purpose: 'Pub/Sub message ID for dedupe (dormant table)',
    creationPath: 'none today (webhook route never records)',
    readPath: 'none today',
    refreshRule: 'kept while required for dedupe',
    deletionMechanism: 'none',
    mustEliminate: false,
  },

  // ── guest (dark; user-authored, non-Google) ─────────────────────────
  {
    relation: 'feedback',
    kind: 'table',
    field: 'comment',
    classification: 'local_operational_fact',
    owner: 'guest',
    purpose: 'Guest-authored feedback text (dark surface; not Google content)',
    creationPath: 'guest feedback submission (dark)',
    readPath: 'none in beta (guest dark)',
    refreshRule: 'internal fact; guest surface dark',
    deletionMechanism: 'none',
    mustEliminate: false,
  },
  {
    relation: 'feedback',
    kind: 'table',
    field: 'rating_id',
    classification: 'local_operational_fact',
    owner: 'guest',
    purpose: 'FK to guest rating',
    creationPath: 'guest feedback submission (dark)',
    readPath: 'none in beta',
    refreshRule: 'internal fact',
    deletionMechanism: 'none',
    mustEliminate: false,
  },
  {
    relation: 'feedback',
    kind: 'table',
    field: 'ip_hash',
    classification: 'local_operational_fact',
    owner: 'guest',
    purpose: 'Pseudonymized submitter IP (abuse control)',
    creationPath: 'guest submission (dark)',
    readPath: 'abuse review only',
    refreshRule: 'internal fact',
    deletionMechanism: 'none',
    mustEliminate: false,
  },
  {
    relation: 'ratings',
    kind: 'table',
    field: 'ip_hash',
    classification: 'local_operational_fact',
    owner: 'guest',
    purpose: 'Pseudonymized rater IP (abuse control)',
    creationPath: 'guest rating (dark)',
    readPath: 'abuse review only',
    refreshRule: 'internal fact',
    deletionMechanism: 'none',
    mustEliminate: false,
  },
  {
    relation: 'scan_events',
    kind: 'table',
    field: 'ip_hash',
    classification: 'local_operational_fact',
    owner: 'guest',
    purpose: 'Pseudonymized scanner IP (abuse control)',
    creationPath: 'QR scan (dark)',
    readPath: 'abuse review only',
    refreshRule: 'internal fact',
    deletionMechanism: 'none',
    mustEliminate: false,
  },

  // ── event payload fields (outbox-registered types) ──────────────────
  // BQC-1.2: review.created/updated no longer carry rating (identifier-only).
  {
    relation: 'event:review.created',
    kind: 'event',
    field: 'externalId',
    classification: 'raw_provider_identifier',
    owner: 'review',
    purpose: 'Google review ID on durable event (consumer re-fetch key)',
    creationPath: 'review sync emit; outbox allowlist',
    readPath: 'durable consumers',
    refreshRule: 'identifier-only event (ADR 0030)',
    deletionMechanism: 'retention-sweep daily (BQC-1.6, 30d) + retention_runs evidence',
    mustEliminate: false,
  },
  {
    relation: 'event:review.updated',
    kind: 'event',
    field: 'externalId',
    classification: 'raw_provider_identifier',
    owner: 'review',
    purpose: 'Google review ID on durable event',
    creationPath: 'review sync emit; outbox allowlist',
    readPath: 'durable consumers',
    refreshRule: 'identifier-only event (ADR 0030)',
    deletionMechanism: 'retention-sweep daily (BQC-1.6, 30d) + retention_runs evidence',
    mustEliminate: false,
  },
  {
    relation: 'event:property.created',
    kind: 'event',
    field: 'gbpPlaceId',
    classification: 'raw_provider_identifier',
    owner: 'property',
    purpose: 'GBP place ID on durable event (sync trigger key)',
    creationPath: 'property creation emit',
    readPath: 'durable consumers',
    refreshRule: 'identifier-only event',
    deletionMechanism: 'retention-sweep daily (BQC-1.6, 30d) + retention_runs evidence',
    mustEliminate: false,
  },
  {
    relation: 'event:property.created',
    kind: 'event',
    field: 'name',
    classification: 'local_operational_fact',
    owner: 'property',
    purpose: 'Business name on durable event',
    creationPath: 'property creation emit',
    readPath: 'durable consumers',
    refreshRule: 'internal fact',
    deletionMechanism: 'retention-sweep daily (BQC-1.6, 30d) + retention_runs evidence',
    mustEliminate: false,
  },
  {
    relation: 'event:identity.member.invited',
    kind: 'event',
    field: 'email',
    classification: 'local_operational_fact',
    owner: 'identity',
    purpose: 'Invitee email on durable event (internal user data)',
    creationPath: 'invitation emit',
    readPath: 'activity consumer',
    refreshRule: 'internal fact',
    deletionMechanism: 'retention-sweep daily (BQC-1.6, 30d) + retention_runs evidence',
    mustEliminate: false,
  },
  {
    relation: 'event:guest.rated',
    kind: 'event',
    field: 'rating',
    classification: 'local_operational_fact',
    owner: 'guest',
    purpose: 'Guest rating value on durable event (guest-authored; dark)',
    creationPath: 'guest rating emit (dark)',
    readPath: 'metric consumer',
    refreshRule: 'internal fact',
    deletionMechanism: 'retention-sweep daily (BQC-1.6, 30d) + retention_runs evidence',
    mustEliminate: false,
  },

  // ── job payload fields ──────────────────────────────────────────────
  {
    relation: 'job:sync-property-reviews',
    kind: 'job',
    field: 'locationName',
    classification: 'raw_provider_identifier',
    owner: 'review',
    purpose: 'GBP location resource name for the sync run',
    creationPath: 'sync enqueue (manual, cron, webhook)',
    readPath: 'sync job handler',
    refreshRule: 'required for the job execution only',
    deletionMechanism: 'BullMQ retention (last 100 completed / 50 failed per queue)',
    mustEliminate: false,
  },
  {
    relation: 'job:import-property',
    kind: 'job',
    field: 'gbpPlaceId',
    classification: 'raw_provider_identifier',
    owner: 'integration',
    purpose: 'GBP place ID per imported location',
    creationPath: 'import enqueue',
    readPath: 'import job handler',
    refreshRule: 'required for the job execution only',
    deletionMechanism: 'BullMQ retention (bounded 100/50)',
    mustEliminate: false,
  },
  {
    relation: 'job:import-property',
    kind: 'job',
    field: 'businessName',
    classification: 'raw_provider_identifier',
    owner: 'integration',
    purpose: 'GBP business name per imported location (provider-observed)',
    creationPath: 'import enqueue',
    readPath: 'import job handler',
    refreshRule: 'required for the job execution only',
    deletionMechanism: 'BullMQ retention (bounded 100/50)',
    mustEliminate: false,
  },
  {
    relation: 'job:insert-activity-log',
    kind: 'job',
    field: 'payload',
    classification: 'local_operational_fact',
    owner: 'activity',
    purpose: 'Activity fact payload (may embed googleEmail / note text ≤100 chars)',
    creationPath: 'activity event handlers enqueue',
    readPath: 'insert-activity-log handler',
    refreshRule: 'content-free target (BQC-1.2)',
    deletionMechanism: 'BullMQ retention (bounded 100/50)',
    mustEliminate: false,
  },

  // ── artifacts (logs / operator output) ──────────────────────────────
  {
    relation: 'artifact:logs/gbp-api-error-body',
    kind: 'artifact',
    field: 'IntegrationError.context.bodyBytes',
    classification: 'raw_source_content',
    owner: 'integration',
    purpose:
      'Legacy upstream-body vector — eliminated in BQC-1.6 (context now carries status + bodyBytes only)',
    creationPath: 'none since BQC-1.6 (adapter stores bodyBytes, not body)',
    readPath: 'log aggregation (content-free)',
    refreshRule: 'n/a',
    deletionMechanism: 'fixed at source (BQC-1.6)',
    mustEliminate: false,
  },
  {
    relation: 'artifact:logs/webhook-payload',
    kind: 'artifact',
    field: 'pubsub.body',
    classification: 'raw_provider_identifier',
    owner: 'integration',
    purpose:
      'Legacy webhook log vector — eliminated in BQC-1.6 (messageId/booleans only)',
    creationPath: 'none since BQC-1.6 (route logs messageId and field-presence booleans)',
    readPath: 'log aggregation (content-free)',
    refreshRule: 'n/a',
    deletionMechanism: 'fixed at source (BQC-1.6)',
    mustEliminate: false,
  },
  {
    relation: 'artifact:scripts/check-db-stdout',
    kind: 'artifact',
    field: 'reviewerName+text',
    classification: 'raw_source_content',
    owner: 'shared',
    purpose:
      'Legacy operator-stdout vector — eliminated in BQC-1.6 (identifiers + clocks only)',
    creationPath: 'none since BQC-1.6 (script prints ids, rating, fetch clocks)',
    readPath: 'operator stdout (content-free)',
    refreshRule: 'n/a',
    deletionMechanism: 'fixed at source (BQC-1.6)',
    mustEliminate: false,
  },
]
