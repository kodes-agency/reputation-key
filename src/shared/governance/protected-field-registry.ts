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

const REVIEW_SOURCE_CONTENT_FIELDS = [
  ['external_id', 'raw_provider_identifier', 'Google review identifier'],
  ['external_location_id', 'raw_provider_identifier', 'Google location resource'],
  ['google_connection_id', 'raw_provider_identifier', 'Google connection binding'],
  ['reviewer_name', 'raw_source_content', 'Reviewer display name'],
  ['reviewer_profile_photo_url', 'raw_source_content', 'Reviewer profile photo'],
  ['rating', 'raw_source_content', 'Google star rating'],
  ['text', 'raw_source_content', 'Original Google review text'],
  ['translated_text', 'raw_source_content', 'Google-provided translation'],
  ['language_code', 'raw_source_content', 'Google review language'],
  ['reviewed_at', 'raw_source_content', 'Provider review timestamp'],
  ['content_hash', 'local_operational_fact', 'Active-cache change baseline'],
  ['ai_source_digest', 'local_operational_fact', 'Active-cache AI source digest'],
] as const satisfies ReadonlyArray<
  readonly [string, ProtectedFieldClassification, string]
>

/**
 * The registry. Every protected field/copy in the system has exactly one
 * entry. The inventory narrative lives in
 * docs/archive/product-readiness-program-2026-07/beta-quality-remediation-2026-07/completion-program-2026-07/bqc1-field-copy-inventory.md
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
    deletionMechanism:
      'SAFE-03 quarantine: compliant field erasure requires REV-01; legacy disconnect/property/org row deletion remains release-blocked',
    mustEliminate: false,
  },

  ...REVIEW_SOURCE_CONTENT_FIELDS.map(
    ([field, classification, purpose]): ProtectedFieldRule => ({
      relation: 'review_source_contents',
      kind: 'table',
      field,
      classification,
      owner: 'review',
      purpose,
      creationPath: 'atomic Review observation dual-write',
      readPath: 'Review-owned authorized source-content reads after cutover',
      refreshRule: 'successful-fetch clock (30d TTL)',
      deletionMechanism:
        'atomic field-level expiry/provider-deletion erasure; stable Review and RepKey Replies remain',
      mustEliminate: false,
    }),
  ),
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
    deletionMechanism:
      'SAFE-03 quarantine: compliant field erasure requires REV-01 before release',
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
    deletionMechanism:
      'connection delete sets this field null; other compliant erasure requires REV-01 before release',
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
    deletionMechanism:
      'SAFE-03 quarantine: compliant field erasure requires REV-01 before release',
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
    deletionMechanism:
      'SAFE-03 quarantine: compliant field erasure requires REV-01 before release',
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
    deletionMechanism:
      'SAFE-03 quarantine: compliant field erasure requires REV-01 before release',
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
    deletionMechanism:
      'SAFE-03 quarantine: compliant field erasure requires REV-01 before release',
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
    deletionMechanism:
      'SAFE-03 quarantine: compliant field erasure requires REV-01 before release',
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
    deletionMechanism:
      'SAFE-03 quarantine: REV-01 must erase this provider-derived digest without deleting stable Review identity',
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
    deletionMechanism:
      'REV-01 separates governed derivative retention from provider-content expiry',
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
    deletionMechanism:
      'REV-01 separates governed derivative retention from provider-content expiry',
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
    deletionMechanism:
      "SAFE-03 quarantine: source='google_sync' requires REV-01 field erasure; internal Reply history is preserved; the current parent cascade is release-blocked",
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
    deletionMechanism:
      'RepKey-owned workflow history is preserved; the current parent cascade is release-blocked by SAFE-03',
    mustEliminate: false,
  },

  // ── google_connections ──────────────────────────────────────────────
  {
    relation: 'google_connections',
    kind: 'table',
    field: 'google_subject',
    classification: 'raw_provider_identifier',
    owner: 'integration',
    purpose: 'Signed Google OIDC subject for connection identity',
    creationPath: 'connect-google-account OAuth ID-token verification',
    readPath: 'connection uniqueness and lifecycle guards',
    refreshRule: 'kept only while the connection remains linked',
    deletionMechanism: 'redactForDisconnect clears provider identity',
    mustEliminate: false,
  },

  // ── properties ──────────────────────────────────────────────────────
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

  {
    relation: 'properties',
    kind: 'table',
    field: 'gbp_account_id',
    classification: 'raw_provider_identifier',
    owner: 'property',
    purpose: 'Bound GBP account suffix for authorized provider routing',
    creationPath: 'confirmed GBP import or binding migration',
    readPath: 'authorized review and Performance provider calls',
    refreshRule: 'kept while the Google binding is active or disconnected',
    deletionMechanism: 'property deletion clears the binding tuple',
    mustEliminate: false,
  },
  {
    relation: 'properties',
    kind: 'table',
    field: 'gbp_location_id',
    classification: 'raw_provider_identifier',
    owner: 'property',
    purpose: 'Bound GBP location suffix for authorized provider routing',
    creationPath: 'confirmed GBP import or binding migration',
    readPath: 'authorized review and Performance provider calls',
    refreshRule: 'kept while the Google binding is active or disconnected',
    deletionMechanism: 'property deletion clears the binding tuple',
    mustEliminate: false,
  },
  {
    relation: 'properties',
    kind: 'table',
    field: 'google_binding_state',
    classification: 'local_operational_fact',
    owner: 'property',
    purpose: 'Content-free lifecycle state for the Google binding tuple',
    creationPath: 'Property binding state machine',
    readPath: 'authorization and property management surfaces',
    refreshRule: 'updated on every binding lifecycle transition',
    deletionMechanism: 'property deletion removes the row',
    mustEliminate: false,
  },
  {
    relation: 'properties',
    kind: 'table',
    field: 'google_review_uri',
    classification: 'raw_provider_identifier',
    owner: 'property',
    purpose: 'Provider-derived canonical action URI for the bound GBP location',
    creationPath: 'confirmed GBP discovery/import or relink profile refresh',
    readPath: 'Property-owned Portal public API only while destination state is verified',
    refreshRule:
      'replaced from each confirmed profile version; fenced as awaiting_refresh on disconnect',
    deletionMechanism:
      'binding scrub clears the URI and destination lineage; property deletion removes the row',
    mustEliminate: false,
  },
  {
    relation: 'properties',
    kind: 'table',
    field: 'google_review_destination_state',
    classification: 'local_operational_fact',
    owner: 'property',
    purpose: 'Fail-closed publication state for the provider-derived review action',
    creationPath: 'Property Google binding state machine',
    readPath: 'Portal publication and public-resolution gates',
    refreshRule: 'updated on import, relink, disconnect, and binding scrub',
    deletionMechanism:
      'binding scrub resets to unavailable; property deletion removes the row',
    mustEliminate: false,
  },
  {
    relation: 'properties',
    kind: 'table',
    field: 'google_review_destination_retrieved_at',
    classification: 'local_operational_fact',
    owner: 'property',
    purpose: 'Successful provider-discovery timestamp for destination freshness evidence',
    creationPath: 'confirmed GBP discovery/import or relink profile refresh',
    readPath: 'Property destination lifecycle checks and operational evidence',
    refreshRule: 'replaced only by a confirmed destination refresh',
    deletionMechanism: 'binding scrub clears it; property deletion removes the row',
    mustEliminate: false,
  },
  {
    relation: 'properties',
    kind: 'table',
    field: 'google_review_destination_source_epoch',
    classification: 'local_operational_fact',
    owner: 'property',
    purpose: 'Binding generation that authorized the current destination snapshot',
    creationPath: 'confirmed GBP discovery/import or relink profile refresh',
    readPath: 'Property destination lineage validation',
    refreshRule: 'must match the generation that produced a verified destination',
    deletionMechanism: 'binding scrub clears it; property deletion removes the row',
    mustEliminate: false,
  },
  {
    relation: 'properties',
    kind: 'table',
    field: 'google_review_destination_profile_version',
    classification: 'local_operational_fact',
    owner: 'property',
    purpose: 'Property profile version that supplied the current destination snapshot',
    creationPath: 'confirmed GBP discovery/import or relink profile refresh',
    readPath: 'Property destination lineage validation',
    refreshRule: 'replaced with each confirmed destination-bearing profile version',
    deletionMechanism: 'binding scrub clears it; property deletion removes the row',
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
    relation: 'recent_activity_entries',
    kind: 'table',
    field: 'payload',
    classification: 'local_operational_fact',
    owner: 'activity',
    purpose:
      'Recent Activity convenience-feed identifiers and allowlisted transition codes; never Review/private-feedback/contact/note/reply text or moderation reasons',
    creationPath: 'Activity durable outbox consumer with EventBus-to-BullMQ acceleration',
    readPath: 'activity UI',
    refreshRule: 'content-free facts only (ADR 0045/0046)',
    deletionMechanism: 'retention-sweep daily (BQC-1.6, 90d) + retention_runs evidence',
    mustEliminate: false,
  },
  {
    relation: 'recent_activity_replay_facts',
    kind: 'table',
    field: 'transition_payload',
    classification: 'local_operational_fact',
    owner: 'activity',
    purpose:
      'Content-free 90-day reconstruction authority containing only identifiers and allowlisted transition codes',
    creationPath:
      'atomic Activity durable consumer settlement with recent_activity_entries and event_consumer_receipts',
    readPath: 'bounded Recent Activity recovery and readiness only',
    refreshRule:
      'idempotent source-event capture; legacy rows remain explicitly labelled',
    deletionMechanism:
      'retention-sweep daily at source_occurred_at + 90d with retention_runs evidence',
    mustEliminate: false,
  },
  {
    relation: 'recent_activity_actor_label_redactions',
    kind: 'table',
    field: 'actor_subject_id',
    classification: 'local_operational_fact',
    owner: 'activity',
    purpose:
      'Content-free 90-day privacy fence preventing delayed delivery or rebuild from restoring an anonymized actor label',
    creationPath:
      'restricted Recent Activity actor-label redaction use case after the owning identity lifecycle decision',
    readPath: 'Activity durable delivery and recovery stores only',
    refreshRule:
      'same-tenant subject redaction extends the fence from the latest lifecycle application',
    deletionMechanism:
      'retention-sweep deletes the fence at expires_at after source facts and replay authority have aged out',
    mustEliminate: false,
  },
  ...[
    ['actor_id', 'Account or operator subject attribution'],
    ['resource_id', 'Affected resource attribution'],
  ].map(([field, purpose]): ProtectedFieldRule => ({
    relation: 'operational_action_history_records',
    kind: 'table',
    field,
    classification: 'local_operational_fact',
    owner: 'activity',
    purpose,
    creationPath: 'Operational Action History append transaction',
    readPath: 'current AccountAdmin restricted history query/export',
    refreshRule: 'append-oriented; no source-content refresh',
    deletionMechanism:
      'one-way identifier redaction in bounded batches; active legal holds fail closed; destructive retention is report-only pending counsel',
    mustEliminate: false,
  })),
  ...[
    ['reason_code', 'Legal-hold placement reason code'],
    ['placed_by_actor_id', 'Legal-hold placement operator attribution'],
    ['released_by_actor_id', 'Legal-hold release operator attribution'],
    ['release_reason_code', 'Legal-hold release reason code'],
  ].map(([field, purpose]): ProtectedFieldRule => ({
    relation: 'operational_action_history_legal_holds',
    kind: 'table',
    field,
    classification: 'local_operational_fact',
    owner: 'activity',
    purpose,
    creationPath: 'Operational Action History legal-hold transaction',
    readPath: 'restricted lifecycle/readiness operation only',
    refreshRule: 'append-oriented placement with one-time explicit release',
    deletionMechanism:
      'none while policy is pending counsel; records protected by an active hold cannot be redacted',
    mustEliminate: false,
  })),
  {
    relation: 'notifications',
    kind: 'table',
    field: 'title',
    classification: 'local_operational_fact',
    owner: 'notification',
    purpose:
      'Rendered snapshot of (type, payload) via domain/notification-templates.ts — no source content by construction; live surfaces re-render from the payload',
    creationPath: 'insert-notification job (renderNotification)',
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
      'Rendered snapshot of (type, payload) via domain/notification-templates.ts — no source content by construction; carries the staff-authored moderation reason on reply.rejected',
    creationPath: 'insert-notification job (renderNotification)',
    readPath: 'notification UI; email rendering',
    refreshRule: 'content-free templates only',
    deletionMechanism: 'none',
    mustEliminate: false,
  },
  {
    relation: 'notifications',
    kind: 'table',
    field: 'payload',
    classification: 'local_operational_fact',
    owner: 'notification',
    purpose:
      'Content-free render metadata (ADR 0046 r.8). Allowlisted keys ONLY, enforced by parseNotificationPayload which drops everything else: propertyName, guestRating (locally collected Portal rating only), platform enum, waitingHours, actorRole (ROLE, never a person), moderationReason (staff-authored), goalName, badgeName, recipientName (portal/portal-group display name), targetKind, occurrences, itemCount. FORBIDDEN and never written: Google/provider review rating or text, reply text, guest/reviewer name, media URLs, sentiment or any derived score, and any other employee name or email.',
    creationPath: 'notification event handlers -> insert-notification job',
    readPath: 'notification UI; email rendering (renderNotification)',
    refreshRule: 'content-free facts only (ADR 0046 r.8); re-parsed on every read',
    deletionMechanism:
      'migration 0128 and database normalization trigger remove legacy provider rating copies before persistence; notifications row retention remains content-free',
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
    relation: 'guest_response_private_feedback',
    kind: 'table',
    field: 'body',
    classification: 'local_operational_fact',
    owner: 'guest',
    purpose: 'Class-separated guest-authored private feedback text',
    creationPath: 'origin/CSRF/signed-session private-feedback mutation',
    readPath: 'tenant-scoped Guest lookup used by authorized Inbox views',
    refreshRule: 'immutable after submission; never returned to the guest browser',
    deletionMechanism:
      'immediate feedback/response withdrawal or retention-sweep guest_response_private_feedback.expired at 90 days',
    mustEliminate: false,
  },
  {
    relation: 'guest_response_session_bindings',
    kind: 'table',
    field: 'session_id',
    classification: 'local_operational_fact',
    owner: 'guest',
    purpose:
      'Short-lived signed-session pseudonym for response recovery and mutation integrity',
    creationPath: 'first private rating submission',
    readPath: 'signed-session-bound Guest response mutations only',
    refreshRule: 'immutable binding to one response and Portal',
    deletionMechanism:
      'retention-sweep guest_response_session_bindings.expired at the signed cookie expiry (maximum 24 hours)',
    mustEliminate: false,
  },
  {
    relation: 'guest_network_pressure_records',
    kind: 'table',
    field: 'pseudonym',
    classification: 'local_operational_fact',
    owner: 'guest',
    purpose:
      'Portal- and action-class-scoped, daily-rotating network-pressure pseudonym for public Guest action limits',
    creationPath:
      'origin/CSRF/signed-session rating, private-feedback, destination-action, or qualified-scan admission',
    readPath:
      'Guest rate-limit and integrity admission only; never analytics, staff attribution, Inbox, or UI',
    refreshRule:
      'immutable row with database-enforced expiry exactly seven days after observation; Organization/Portal/action/day HMAC separation prevents cross-purpose or durable identity',
    deletionMechanism:
      'reads deny at expires_at; bounded retention-sweep guest_network_pressure_records.expired deletes expired rows with content-free retention_runs evidence',
    mustEliminate: false,
  },
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
    field: 'session_id',
    classification: 'local_operational_fact',
    owner: 'guest',
    purpose: 'Legacy guest-session pseudonym for response integrity and dedupe',
    creationPath: 'legacy guest submission (read-only migration source)',
    readPath: '24-hour response-integrity window only',
    refreshRule: 'maximum 24-hour lifetime',
    deletionMechanism:
      'retention-sweep feedback.guest_session_pseudonym redacts session_id after 24 hours',
    mustEliminate: false,
  },
  {
    relation: 'feedback',
    kind: 'table',
    field: 'ip_hash',
    classification: 'local_operational_fact',
    owner: 'guest',
    purpose: 'Nullable legacy compatibility slot; no longer Guest abuse authority',
    creationPath:
      'no active writer; migration 0142 clears this column without importing globally derived v1 values',
    readPath: 'legacy compatibility diagnostics only; not an active rate-limit input',
    refreshRule: 'must remain null for canonical writes',
    deletionMechanism:
      'migration 0142 clears all values; legacy retention rule remains as restore/backfill defence',
    mustEliminate: false,
  },
  {
    relation: 'ratings',
    kind: 'table',
    field: 'session_id',
    classification: 'local_operational_fact',
    owner: 'guest',
    purpose: 'Legacy guest-session pseudonym for response integrity and dedupe',
    creationPath: 'legacy guest rating (read-only migration source)',
    readPath: '24-hour response-integrity window only',
    refreshRule: 'maximum 24-hour lifetime',
    deletionMechanism:
      'retention-sweep ratings.guest_session_pseudonym redacts session_id after 24 hours',
    mustEliminate: false,
  },
  {
    relation: 'ratings',
    kind: 'table',
    field: 'ip_hash',
    classification: 'local_operational_fact',
    owner: 'guest',
    purpose: 'Nullable legacy compatibility slot; no longer Guest abuse authority',
    creationPath:
      'no active writer; migration 0142 clears this column without importing globally derived v1 values',
    readPath: 'legacy compatibility diagnostics only; not an active rate-limit input',
    refreshRule: 'must remain null for canonical writes',
    deletionMechanism:
      'migration 0142 clears all values; legacy retention rule remains as restore/backfill defence',
    mustEliminate: false,
  },
  {
    relation: 'scan_events',
    kind: 'table',
    field: 'session_id',
    classification: 'local_operational_fact',
    owner: 'guest',
    purpose: 'Portal visit session pseudonym for integrity and dedupe',
    creationPath: 'qualified core portal visit',
    readPath: '24-hour visit-integrity window only',
    refreshRule: 'maximum 24-hour lifetime',
    deletionMechanism:
      'retention-sweep scan_events.guest_session_pseudonym redacts session_id after 24 hours',
    mustEliminate: false,
  },
  {
    relation: 'scan_events',
    kind: 'table',
    field: 'ip_hash',
    classification: 'local_operational_fact',
    owner: 'guest',
    purpose: 'Nullable legacy compatibility slot; no longer Guest abuse authority',
    creationPath:
      'no active writer; migration 0142 clears this column without importing globally derived v1 values',
    readPath: 'legacy compatibility diagnostics only; not an active rate-limit input',
    refreshRule: 'must remain null for canonical writes',
    deletionMechanism:
      'migration 0142 clears all values; legacy retention rule remains as restore/backfill defence',
    mustEliminate: false,
  },
  {
    relation: 'guest_destination_action_receipts',
    kind: 'table',
    field: 'session_id',
    classification: 'local_operational_fact',
    owner: 'guest',
    purpose: 'Signed-session pseudonym for once-per-destination action integrity',
    creationPath: 'qualified origin/CSRF-bound destination selection mutation',
    readPath: 'unique-index conflict check only; never exposed to product UI or facts',
    refreshRule: 'fixed to the signed session expiry; never extended',
    deletionMechanism:
      'retention-sweep guest_destination_action_receipts.expired deletes the row at expiry',
    mustEliminate: false,
  },
  {
    relation: 'guest_qualified_scan_receipts',
    kind: 'table',
    field: 'session_id',
    classification: 'local_operational_fact',
    owner: 'guest',
    purpose: 'Signed-session pseudonym for rolling Qualified Scan dedupe',
    creationPath: 'server-verified Access Artifact observation mutation',
    readPath: '24-hour uniqueness check only; never exposed to facts or product UI',
    refreshRule: 'fixed 24-hour lifetime from accepted observation; never extended',
    deletionMechanism:
      'retention-sweep guest_qualified_scan_receipts.expired deletes the row at expiry',
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
    relation: 'event:guest.rating.submitted',
    kind: 'event',
    field: 'value',
    classification: 'local_operational_fact',
    owner: 'guest',
    purpose: 'Guest rating value on durable event (guest-authored; dark)',
    creationPath: 'guest response command store emit (dark)',
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
    relation: 'job:project-recent-activity',
    kind: 'job',
    field: 'payload',
    classification: 'local_operational_fact',
    owner: 'activity',
    purpose: 'Content-minimal Recent Activity projection input',
    creationPath: 'activity event handlers enqueue',
    readPath: 'project-recent-activity handler',
    refreshRule: 'content-free target (BQC-1.2)',
    deletionMechanism: 'BullMQ retention (bounded 100/50)',
    mustEliminate: false,
  },
  {
    relation: 'job:insert-activity-log',
    kind: 'job',
    field: 'payload',
    classification: 'local_operational_fact',
    owner: 'activity',
    purpose:
      'Rolling-deployment drain copy of the content-minimal Recent Activity projection input',
    creationPath: 'none after migration 0160; retained queued jobs only',
    readPath: 'project-recent-activity compatibility handler',
    refreshRule: 'never enqueue; preserve invitation redaction while draining',
    deletionMechanism: 'BullMQ retention after verified zero legacy queue depth',
    mustEliminate: true,
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
