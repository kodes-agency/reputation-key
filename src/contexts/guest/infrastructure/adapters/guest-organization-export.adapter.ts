// LIF-01 bullet 6: the Guest context's own Organization Export slice —
// permitted Guest facts and permitted Guest content.
//
// This is a cross-context adapter implementation, so it may import the
// contributor port it implements and nothing else from Identity (see
// src/contexts/CONTEXT.md "Dependency rules" and the port header).
//
// Guest is the context bullet 7 constrains most tightly, so the reading order
// for a reviewer is: EXCLUDED_RECORD_CLASSES first (what is deliberately not
// here and why), then the queries (what is).

import { sql, type SQL } from 'drizzle-orm'
import { canonicalizeRfc8785 } from '#/shared/canonical-json'
import type { Database } from '#/shared/db'
import type {
  OrganizationExportContributor,
  OrganizationExportEntry,
} from '#/contexts/identity/application/ports/organization-export-contributor.port'

type ExportScalar = string | number | boolean | null
type ExportRecord = Readonly<Record<string, ExportScalar>>

type GuestOrganizationExportPayload = Readonly<{
  version: 'guest-organization-export/v1'
  requestedAsOf: string
  snapshotBound: 'repeatable_read_within_15m_of_request'
  /** De-identified canonical response facts. No guest-authored text. */
  responses: readonly ExportRecord[]
  qualifiedScans: readonly ExportRecord[]
  integrityDecisions: readonly ExportRecord[]
  experienceSnapshots: readonly ExportRecord[]
  /** Guest-authored private text that is still inside its 90-day window. */
  privateFeedback: readonly ExportRecord[]
  legacyFeedbackText: readonly ExportRecord[]
  /** Legacy rows with no canonical successor, so nothing is double-counted. */
  legacyRatings: readonly ExportRecord[]
  legacyFeedbackFacts: readonly ExportRecord[]
  legacyScanEvents: readonly ExportRecord[]
  excludedRecordClasses: readonly Readonly<{
    recordClass: string
    reasonCode: string
  }>[]
}>

const MAX_SNAPSHOT_LAG_MS = 15 * 60 * 1000

/**
 * Every deliberate Guest-context exclusion. These are the reviewable decisions.
 *
 * - Contact Request is dark. `portal.guest_contact` is `safety_blocked`, so no
 *   lawfully collected contact can exist in beta and shipping the table would
 *   give the dark capability a product surface — an activation by the back
 *   door. §3.3.9 lets this export carry an unexpired permitted contact; it does
 *   not oblige it to, and permission cannot precede activation. Neither
 *   `guest_contact_requests` nor its reveal audits is queried here at all.
 * - Session bindings, qualified-scan receipts and destination-action receipts
 *   are signed-session pseudonyms kept only for a dedupe window. Bullet 7
 *   excludes sessions and receipts, and exporting a pseudonym would re-link
 *   responses that were deliberately de-identified. The destination-action
 *   fact itself is content-free control plane and stays out with them.
 * - Network-pressure records are abuse controls; bullet 7 excludes rate-limit
 *   and abuse internals.
 * - Legacy `session_id`/`ip_hash` columns are pseudonym linkage, so the legacy
 *   collections carry the rating/click facts without them.
 */
const EXCLUDED_RECORD_CLASSES = Object.freeze([
  {
    recordClass: 'guest_contact_requests_and_reveal_audits',
    reasonCode: 'dark_capability_not_activated',
  },
  {
    recordClass: 'guest_response_session_bindings',
    reasonCode: 'security_session_material',
  },
  {
    recordClass: 'guest_idempotency_receipts',
    reasonCode: 'security_session_material',
  },
  { recordClass: 'guest_network_pressure_records', reasonCode: 'abuse_control_internal' },
  {
    recordClass: 'legacy_session_and_network_pseudonyms',
    reasonCode: 'pseudonym_linkage',
  },
  {
    recordClass: 'rating_and_feedback_source_event_ids',
    reasonCode: 'content_free_control_plane',
  },
  {
    recordClass: 'expired_private_feedback_bodies',
    reasonCode: 'retention_expired',
  },
])

function normalizeScalar(value: unknown, field: string): ExportScalar {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return value
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value))
      throw new Error(`Guest export field is invalid: ${field}`)
    return value
  }
  if (typeof value === 'bigint') return value.toString()
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString()
  throw new Error(`Guest export field has an unsupported value: ${field}`)
}

function normalizeRows(rows: readonly Record<string, unknown>[]): ExportRecord[] {
  return rows.map((row) =>
    Object.fromEntries(
      Object.entries(row).map(([field, value]) => [field, normalizeScalar(value, field)]),
    ),
  )
}

async function readRows(
  snapshot: Parameters<Parameters<Database['transaction']>[0]>[0],
  query: SQL,
): Promise<ExportRecord[]> {
  const result = await snapshot.execute(query)
  return normalizeRows(result.rows as Record<string, unknown>[])
}

/** UTF-8 byte order, never the database or host locale collation. */
function compareText(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'))
}

/**
 * Ordering happens here rather than in SQL because `ORDER BY` on a text column
 * follows the database collation, which is a host-configuration input. The last
 * key is always a surrogate id so the order is total.
 */
function sortRecords(
  rows: readonly ExportRecord[],
  keys: readonly string[],
): ExportRecord[] {
  return [...rows].sort((left, right) => {
    for (const key of keys) {
      const result = compareText(String(left[key] ?? ''), String(right[key] ?? ''))
      if (result !== 0) return result
    }
    return 0
  })
}

function csvField(value: ExportScalar | undefined): string {
  if (value === null || value === undefined) return ''
  const text = String(value)
  return /[",\r\n]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

const CSV_HEADER = [
  'record_type',
  'record_id',
  'property_id',
  'portal_id',
  'state',
  'occurred_at',
  'record_json',
]

function csvSummary(type: string, record: ExportRecord): readonly ExportScalar[] {
  return [
    type,
    record.id ?? record.response_id ?? '',
    record.property_id ?? '',
    record.portal_id ?? '',
    record.status ?? record.outcome ?? record.private_feedback_state ?? 'recorded',
    record.submitted_at ?? record.occurred_at ?? record.created_at ?? '',
    canonicalizeRfc8785(record),
  ]
}

function csv(
  path: string,
  classification: 'tenant_visible' | 'permitted_guest_content',
  collections: readonly [string, readonly ExportRecord[]][],
): OrganizationExportEntry {
  const lines = [
    CSV_HEADER.join(','),
    ...collections.flatMap(([type, records]) =>
      records.map((record) => csvSummary(type, record).map(csvField).join(',')),
    ),
  ]
  return {
    path,
    mediaType: 'text/csv',
    classification,
    bytes: Buffer.from(`${lines.join('\n')}\n`, 'utf8'),
  }
}

function json(
  path: string,
  classification: 'tenant_visible' | 'permitted_guest_content',
  value: unknown,
): OrganizationExportEntry {
  return {
    path,
    mediaType: 'application/json',
    classification,
    bytes: Buffer.from(`${canonicalizeRfc8785(value)}\n`, 'utf8'),
  }
}

const TS = `AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'`

/** Renders a timestamptz as a fixed-width UTC ISO string, free of any session
 * `TimeZone` or `DateStyle` setting the connection happens to carry. */
const utc = (column: string) => sql.raw(`to_char(${column} ${TS})`)

async function readPayload(
  db: Database,
  organizationId: string,
  asOf: Date,
): Promise<GuestOrganizationExportPayload> {
  return db.transaction(
    async (snapshot) => {
      const snapshotRows = await readRows(
        snapshot,
        sql`SELECT transaction_timestamp() AS snapshot_at`,
      )
      const snapshotAt = snapshotRows[0]?.snapshot_at
      if (typeof snapshotAt !== 'string') {
        throw new Error('Guest export snapshot clock is unavailable')
      }
      const snapshotTime = new Date(snapshotAt).getTime()
      const requestTime = asOf.getTime()
      if (
        Number.isNaN(requestTime) ||
        snapshotTime < requestTime ||
        snapshotTime - requestTime > MAX_SNAPSHOT_LAG_MS
      ) {
        throw new Error('Guest export snapshot window is unavailable')
      }
      const asOfIso = asOf.toISOString()

      // `private_feedback_state` is derived against the requested asOf, never
      // against wall time, so a replay of the same request answers the same
      // way. Expired text renders as `expired` beside a response that still
      // records that feedback was received — never as empty text.
      const responses = await readRows(
        snapshot,
        sql`SELECT response.id::text AS id,
                   response.property_id::text AS property_id,
                   response.portal_id::text AS portal_id,
                   response.status, response.integrity_outcome,
                   response.integrity_reason_code, response.integrity_revision,
                   ${utc('response.integrity_assessed_at')} AS integrity_assessed_at,
                   response.rating, response.category_id::text AS category_id,
                   response.response_consent, response.text_consent,
                   response.media_consent, response.private_feedback_threshold,
                   response.correction_count,
                   ${utc('response.submitted_at')} AS submitted_at,
                   ${utc('response.corrected_at')} AS corrected_at,
                   ${utc('response.feedback_submitted_at')} AS feedback_submitted_at,
                   response.feedback_submission_revision,
                   ${utc('response.feedback_withdrawn_at')} AS feedback_withdrawn_at,
                   ${utc('response.moderated_at')} AS moderated_at,
                   ${utc('response.retention_deadline')} AS retention_deadline,
                   response.attributed_staff_participant_id::text
                     AS attributed_staff_participant_id,
                   response.attributed_staff_participation_id::text
                     AS attributed_staff_participation_id,
                   response.attribution_responsibility_id::text
                     AS attribution_responsibility_id,
                   ${utc('response.staff_attribution_effective_from')}
                     AS staff_attribution_effective_from,
                   ${utc('response.staff_attribution_effective_to')}
                     AS staff_attribution_effective_to,
                   ${utc('response.created_at')} AS created_at,
                   ${utc('response.updated_at')} AS updated_at,
                   ${utc('response.deleted_at')} AS deleted_at,
                   CASE
                     WHEN response.feedback_withdrawn_at IS NOT NULL THEN 'withdrawn'
                     WHEN response.feedback_submitted_at IS NULL THEN 'not_provided'
                     WHEN text.response_id IS NOT NULL
                       AND text.expires_at > ${asOfIso}::timestamptz THEN 'available'
                     ELSE 'expired'
                   END AS private_feedback_state
            FROM guest_responses AS response
            LEFT JOIN guest_response_private_feedback AS text
              ON text.organization_id = response.organization_id
             AND text.response_id = response.id
            WHERE response.organization_id = ${organizationId}`,
      )
      const qualifiedScans = await readRows(
        snapshot,
        sql`SELECT id::text AS id, property_id::text AS property_id,
                   portal_id::text AS portal_id,
                   portal_group_id::text AS portal_group_id,
                   access_artifact_id::text AS access_artifact_id,
                   ${utc('occurred_at')} AS occurred_at,
                   ${utc('retracted_at')} AS retracted_at,
                   attributed_staff_participant_id::text
                     AS attributed_staff_participant_id,
                   attributed_staff_participation_id::text
                     AS attributed_staff_participation_id,
                   attribution_responsibility_id::text AS attribution_responsibility_id,
                   ${utc('staff_attribution_effective_from')}
                     AS staff_attribution_effective_from,
                   ${utc('staff_attribution_effective_to')}
                     AS staff_attribution_effective_to
            FROM guest_qualified_scans WHERE organization_id = ${organizationId}`,
      )
      const integrityDecisions = await readRows(
        snapshot,
        sql`SELECT id::text AS id, response_id::text AS response_id,
                   property_id::text AS property_id, portal_id::text AS portal_id,
                   revision, previous_outcome, outcome, reason_code, source, actor_id,
                   ${utc('decided_at')} AS decided_at
            FROM guest_response_integrity_decisions
            WHERE organization_id = ${organizationId}`,
      )
      const experienceSnapshots = await readRows(
        snapshot,
        sql`SELECT response_id::text AS response_id,
                   property_id::text AS property_id, portal_id::text AS portal_id,
                   publication_state,
                   publication_snapshot_id::text AS publication_snapshot_id,
                   publication_version, publication_digest, configuration_digest,
                   guest_locale, language_pack_version, private_feedback_threshold,
                   ${utc('captured_at')} AS captured_at
            FROM guest_response_experience_snapshots
            WHERE organization_id = ${organizationId}`,
      )
      const privateFeedback = await readRows(
        snapshot,
        sql`SELECT response_id::text AS response_id,
                   property_id::text AS property_id, portal_id::text AS portal_id,
                   body, ${utc('submitted_at')} AS submitted_at,
                   ${utc('expires_at')} AS expires_at
            FROM guest_response_private_feedback
            WHERE organization_id = ${organizationId}
              AND expires_at > ${asOfIso}::timestamptz`,
      )

      // A legacy row is exported only when no canonical row succeeded it: the
      // migration reconciliation treats a canonical row sharing the legacy id
      // as the same response, so exporting both would double-count it.
      const legacyRatings = await readRows(
        snapshot,
        sql`SELECT legacy.id::text AS id, legacy.portal_id::text AS portal_id,
                   legacy.property_id AS property_id, legacy.value, legacy.source,
                   ${utc('legacy.created_at')} AS created_at
            FROM ratings AS legacy
            WHERE legacy.organization_id = ${organizationId}
              AND NOT EXISTS (
                SELECT 1 FROM guest_responses AS canonical
                WHERE canonical.organization_id = legacy.organization_id
                  AND canonical.id = legacy.id
              )`,
      )
      const legacyFeedbackFacts = await readRows(
        snapshot,
        sql`SELECT legacy.id::text AS id, legacy.portal_id::text AS portal_id,
                   legacy.property_id AS property_id,
                   legacy.rating_id::text AS rating_id, legacy.source,
                   ${utc('legacy.created_at')} AS created_at
            FROM feedback AS legacy
            WHERE legacy.organization_id = ${organizationId}
              AND NOT EXISTS (
                SELECT 1 FROM guest_responses AS canonical
                WHERE canonical.organization_id = legacy.organization_id
                  AND canonical.id = legacy.id
              )`,
      )
      const legacyFeedbackText = await readRows(
        snapshot,
        sql`SELECT legacy.id::text AS id, legacy.portal_id::text AS portal_id,
                   legacy.property_id AS property_id, legacy.comment AS body,
                   ${utc('legacy.created_at')} AS created_at
            FROM feedback AS legacy
            WHERE legacy.organization_id = ${organizationId}
              AND NOT EXISTS (
                SELECT 1 FROM guest_responses AS canonical
                WHERE canonical.organization_id = legacy.organization_id
                  AND canonical.id = legacy.id
              )`,
      )
      const legacyScanEvents = await readRows(
        snapshot,
        sql`SELECT legacy.id::text AS id, legacy.portal_id::text AS portal_id,
                   legacy.property_id AS property_id, legacy.source,
                   ${utc('legacy.created_at')} AS created_at
            FROM scan_events AS legacy
            WHERE legacy.organization_id = ${organizationId}
              AND NOT EXISTS (
                SELECT 1 FROM guest_qualified_scans AS canonical
                WHERE canonical.organization_id = legacy.organization_id
                  AND canonical.source_event_id = legacy.id
              )`,
      )

      return {
        version: 'guest-organization-export/v1' as const,
        requestedAsOf: asOfIso,
        snapshotBound: 'repeatable_read_within_15m_of_request' as const,
        responses: sortRecords(responses, ['id']),
        qualifiedScans: sortRecords(qualifiedScans, ['id']),
        integrityDecisions: sortRecords(integrityDecisions, [
          'response_id',
          'revision',
          'id',
        ]),
        experienceSnapshots: sortRecords(experienceSnapshots, ['response_id']),
        privateFeedback: sortRecords(privateFeedback, ['response_id']),
        legacyFeedbackText: sortRecords(legacyFeedbackText, ['id']),
        legacyRatings: sortRecords(legacyRatings, ['id']),
        legacyFeedbackFacts: sortRecords(legacyFeedbackFacts, ['id']),
        legacyScanEvents: sortRecords(legacyScanEvents, ['id']),
        excludedRecordClasses: EXCLUDED_RECORD_CLASSES,
      }
    },
    { isolationLevel: 'repeatable read', accessMode: 'read only' },
  )
}

function entriesFor(
  payload: GuestOrganizationExportPayload,
): readonly OrganizationExportEntry[] {
  const factCollections: readonly [string, readonly ExportRecord[]][] = [
    ['guest_response', payload.responses],
    ['qualified_scan', payload.qualifiedScans],
    ['integrity_decision', payload.integrityDecisions],
    ['experience_snapshot', payload.experienceSnapshots],
  ]
  const legacyCollections: readonly [string, readonly ExportRecord[]][] = [
    ['legacy_rating', payload.legacyRatings],
    ['legacy_feedback', payload.legacyFeedbackFacts],
    ['legacy_scan_event', payload.legacyScanEvents],
  ]
  const textCollections: readonly [string, readonly ExportRecord[]][] = [
    ['private_feedback', payload.privateFeedback],
    ['legacy_private_feedback', payload.legacyFeedbackText],
  ]
  const hasRows = (collections: readonly [string, readonly ExportRecord[]][]) =>
    collections.some(([, records]) => records.length > 0)

  // Each family is emitted only when it actually has rows. An empty CSV would
  // read as "no feedback was ever left", which is a different claim.
  const shared = {
    version: payload.version,
    requestedAsOf: payload.requestedAsOf,
    snapshotBound: payload.snapshotBound,
    excludedRecordClasses: payload.excludedRecordClasses,
  }
  return [
    ...(hasRows(factCollections)
      ? [
          csv('guest/responses.csv', 'tenant_visible', factCollections),
          json('guest/responses.json', 'tenant_visible', {
            ...shared,
            responses: payload.responses,
            qualifiedScans: payload.qualifiedScans,
            integrityDecisions: payload.integrityDecisions,
            experienceSnapshots: payload.experienceSnapshots,
          }),
        ]
      : []),
    ...(hasRows(legacyCollections)
      ? [
          csv('guest/legacy-responses.csv', 'tenant_visible', legacyCollections),
          json('guest/legacy-responses.json', 'tenant_visible', {
            ...shared,
            legacyRatings: payload.legacyRatings,
            legacyFeedbackFacts: payload.legacyFeedbackFacts,
            legacyScanEvents: payload.legacyScanEvents,
          }),
        ]
      : []),
    ...(hasRows(textCollections)
      ? [
          csv('guest/private-feedback.csv', 'permitted_guest_content', textCollections),
          json('guest/private-feedback.json', 'permitted_guest_content', {
            ...shared,
            privateFeedback: payload.privateFeedback,
            legacyFeedbackText: payload.legacyFeedbackText,
          }),
        ]
      : []),
  ]
}

/**
 * Guest-owned Organization Export contribution.
 *
 * Exports de-identified response facts and qualified scans as `tenant_visible`,
 * and unexpired guest-authored private text as `permitted_guest_content`.
 * Contact Request, session pseudonyms, abuse controls and media are not
 * queried — see EXCLUDED_RECORD_CLASSES for the reason attached to each. An
 * Organization with no Guest rows answers `no_data`.
 */
export const createGuestOrganizationExportContributor = (
  db: Database,
): OrganizationExportContributor => {
  return Object.freeze({
    context: 'guest' as const,
    async contribute({ organizationId, asOf }) {
      const payload = await readPayload(db, organizationId, asOf)
      const entries = entriesFor(payload)
      if (entries.length === 0) {
        return {
          context: 'guest' as const,
          coverage: 'no_data' as const,
          omissionCodes: [],
          entries: [],
        }
      }
      return {
        context: 'guest' as const,
        coverage: 'complete' as const,
        omissionCodes: [],
        entries,
      }
    },
  })
}
