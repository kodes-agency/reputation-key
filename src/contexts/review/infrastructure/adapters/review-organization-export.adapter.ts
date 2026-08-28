// Review's Organization Export contribution (LIF-01 work bullets 6 and 7).
//
// This is a cross-context adapter implementation: it implements Identity's
// `organization-export-contributor.port`, which src/contexts/CONTEXT.md
// "Dependency rules" names as the one foreign module an adapter may import.
//
// Review is the sharpest exclusion boundary in the whole export. Bullet 6 asks
// for "manager-authored replies with AI provenance"; bullet 7 forbids "raw
// Google-controlled review content/identifiers copied merely for export". So
// this contributor never reads `reviews`, `review_source_contents`,
// `review_source_observations`, `material_review_revisions`,
// `google_reply_observations`, `review_provider_subjects` or
// `review_provider_snapshot_members` — not even to resolve a property name.
// The only tables it touches are the three that hold RepKey's own reply
// workflow, and even inside `replies` it exports only `source = 'internal'`
// rows, because a `google_sync` row is a mirror of provider-authored text.
//
// CLASSIFICATIONS_BY_CONTEXT permits Review exactly one class,
// `manager_authored`, and every entry below carries it.

import { sql, type SQL } from 'drizzle-orm'
import { canonicalizeRfc8785 } from '#/shared/canonical-json'
import type { Database } from '#/shared/db'
import type {
  OrganizationExportContribution,
  OrganizationExportContributor,
  OrganizationExportEntry,
} from '#/contexts/identity/application/ports/organization-export-contributor.port'

type ExportScalar = string | number | boolean | null
type ExportRecord = Readonly<Record<string, ExportScalar>>

type ExcludedRecordClass = Readonly<{ recordClass: string; reasonCode: string }>

type Snapshot = Parameters<Parameters<Database['transaction']>[0]>[0]

/** Same bounded read-only snapshot rule as the Identity contributor. */
const MAX_SNAPSHOT_LAG_MS = 15 * 60 * 1000

const REVIEW_EXPORT_VERSION = 'review-organization-export/v1' as const
const SNAPSHOT_BOUND = 'repeatable_read_within_15m_of_request' as const

/** Every Review entry is manager-authored; Review may stamp nothing else. */
const REVIEW_CLASSIFICATION = 'manager_authored' as const

const EXCLUDED_RECORD_CLASSES: readonly ExcludedRecordClass[] = Object.freeze([
  {
    // The Review itself, its source content, its observations and its material
    // revisions are all Google-controlled text and Google-controlled identity.
    recordClass: 'google_controlled_review_source_content',
    reasonCode: 'provider_controlled_content',
  },
  {
    // A `source = 'google_sync'` reply is a mirror of a reply RepKey did not
    // author. Exporting it would ship provider-controlled text under a
    // manager-authored label, which is exactly the leak bullet 7 forbids.
    recordClass: 'provider_mirrored_reply_text',
    reasonCode: 'provider_controlled_content',
  },
  {
    // Reply observations prove reconciliation, but they carry the provider's
    // own reply text and its comment identity.
    recordClass: 'google_reply_observations',
    reasonCode: 'provider_controlled_content',
  },
  {
    // Pseudonymous provider subject keys, snapshot membership and reputation
    // snapshot facts are live Google Performance/provider identifier material.
    recordClass: 'google_provider_subject_and_snapshot_material',
    reasonCode: 'provider_identifier_material',
  },
  {
    // Provider operation keys, correlation ids and reply digests are the
    // idempotency/fencing control plane, in the same family as
    // queues/outbox/receipts.
    recordClass: 'provider_operation_keys_and_digests',
    reasonCode: 'content_free_control_plane',
  },
  {
    // Unadopted AI drafts and any transient inference material stay behind.
    // What survives here is provenance about a reply a manager actually
    // adopted — never a prompt and never a provider payload.
    recordClass: 'transient_ai_draft_and_inference_material',
    reasonCode: 'transient_inference_material',
  },
])

function normalizeScalar(value: unknown, field: string): ExportScalar {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return value
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value))
      throw new Error(`Review export field is invalid: ${field}`)
    return value
  }
  if (typeof value === 'bigint') return value.toString()
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString()
  throw new Error(`Review export field has an unsupported value: ${field}`)
}

function normalizeRows(rows: readonly Record<string, unknown>[]): ExportRecord[] {
  return rows.map((row) =>
    Object.fromEntries(
      Object.entries(row).map(([field, value]) => [field, normalizeScalar(value, field)]),
    ),
  )
}

async function readRows(snapshot: Snapshot, query: SQL): Promise<ExportRecord[]> {
  const result = await snapshot.execute(query)
  return normalizeRows(result.rows as Record<string, unknown>[])
}

function csvField(value: ExportScalar | undefined): string {
  if (value === null || value === undefined) return ''
  const text = String(value)
  return /[",\r\n]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

function csvSummary(type: string, record: ExportRecord): readonly ExportScalar[] {
  return [
    type,
    record.id ?? record.reply_id ?? '',
    record.review_id ?? '',
    record.property_id ?? '',
    record.created_by ?? record.authorized_by_user_id ?? '',
    record.status ?? record.outcome ?? 'recorded',
    record.publication_cycle ?? '',
    record.created_at ?? record.authorized_at ?? '',
    canonicalizeRfc8785(record),
  ]
}

const CSV_HEADER = [
  'record_type',
  'record_id',
  'review_id',
  'property_id',
  'actor_user_id',
  'state',
  'publication_cycle',
  'recorded_at',
  'record_json',
].join(',')

type Collection = readonly [string, readonly ExportRecord[]]

function csvEntry(path: string, collections: readonly Collection[]) {
  const lines = [
    CSV_HEADER,
    ...collections.flatMap(([type, records]) =>
      records.map((record) => csvSummary(type, record).map(csvField).join(',')),
    ),
  ]
  return {
    path,
    mediaType: 'text/csv' as const,
    classification: REVIEW_CLASSIFICATION,
    bytes: Buffer.from(`${lines.join('\n')}\n`, 'utf8'),
  }
}

function jsonEntry(path: string, payload: unknown) {
  return {
    path,
    mediaType: 'application/json' as const,
    classification: REVIEW_CLASSIFICATION,
    bytes: Buffer.from(`${canonicalizeRfc8785(payload)}\n`, 'utf8'),
  }
}

type ReviewExportTables = Readonly<{
  replies: readonly ExportRecord[]
  authorizations: readonly ExportRecord[]
  attempts: readonly ExportRecord[]
}>

async function readTables(
  snapshot: Snapshot,
  organizationId: string,
): Promise<ReviewExportTables> {
  // `review_id` here is RepKey's own stable Review identity, not a Google
  // resource name — it is the only way an archive reader can group a reply
  // history, and it discloses nothing the provider controls.
  //
  // The AI provenance block (origin_* plus ai_generated/authorship) is
  // deliberately present: bullet 6 asks for "manager-authored replies with AI
  // provenance", so the profile version, drafting epoch, template pin and the
  // adopted operation id are all exported. No prompt is stored on this table
  // and none is reconstructed here.
  const replies = await readRows(
    snapshot,
    sql`SELECT
          id,
          review_id,
          text,
          reply_language_tag,
          status,
          source,
          created_by,
          approved_by,
          rejected_by,
          rejection_reason,
          ai_generated,
          authorship,
          origin_operation_id,
          origin_source_epoch,
          origin_source_revision,
          origin_base_reply_state_revision,
          origin_reply_drafting_epoch,
          origin_property_profile_version,
          origin_ai_profile_version,
          origin_reply_template_id,
          origin_reply_template_catalogue_version,
          origin_reply_template_catalogue_digest,
          origin_concrete_language_tag,
          origin_template_group,
          publication_state,
          publication_cycle,
          publication_attempts,
          to_char(submitted_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS submitted_at,
          to_char(approved_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS approved_at,
          to_char(published_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS published_at,
          to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at,
          to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS updated_at
        FROM replies
        WHERE organization_id = ${organizationId}
          AND source = 'internal'
        ORDER BY id`,
  )
  const authorizations = await readRows(
    snapshot,
    sql`SELECT
          auth_row.reply_id,
          auth_row.review_id,
          auth_row.property_id,
          auth_row.publication_cycle,
          auth_row.source_epoch,
          auth_row.material_review_revision,
          auth_row.base_observation_revision,
          auth_row.authorized_by_user_id,
          auth_row.reply_state_revision,
          to_char(auth_row.authorized_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS authorized_at
        FROM reply_publication_authorizations AS auth_row
        INNER JOIN replies AS reply
          ON reply.id = auth_row.reply_id
         AND reply.organization_id = auth_row.organization_id
        WHERE auth_row.organization_id = ${organizationId}
          AND reply.source = 'internal'
        ORDER BY auth_row.reply_id, auth_row.publication_cycle`,
  )
  const attempts = await readRows(
    snapshot,
    sql`SELECT
          attempt.id,
          attempt.reply_id,
          attempt.review_id,
          attempt.property_id,
          attempt.publication_cycle,
          attempt.attempt_number,
          attempt.source_epoch,
          attempt.material_review_revision,
          attempt.reply_state_revision,
          attempt.outcome,
          to_char(attempt.provider_responded_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS provider_responded_at,
          attempt.confirmed_observation_revision,
          to_char(attempt.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at,
          to_char(attempt.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS updated_at
        FROM reply_publication_attempts AS attempt
        INNER JOIN replies AS reply
          ON reply.id = attempt.reply_id
         AND reply.organization_id = attempt.organization_id
        WHERE attempt.organization_id = ${organizationId}
          AND reply.source = 'internal'
        ORDER BY attempt.reply_id, attempt.publication_cycle, attempt.attempt_number`,
  )
  return { replies, authorizations, attempts }
}

async function assertBoundedSnapshot(snapshot: Snapshot, asOf: Date): Promise<void> {
  const rows = await readRows(
    snapshot,
    sql`SELECT transaction_timestamp() AS snapshot_at`,
  )
  const snapshotAt = rows[0]?.snapshot_at
  if (typeof snapshotAt !== 'string') {
    throw new Error('Review export snapshot clock is unavailable')
  }
  const snapshotTime = new Date(snapshotAt).getTime()
  const requestTime = asOf.getTime()
  if (
    Number.isNaN(requestTime) ||
    snapshotTime < requestTime ||
    snapshotTime - requestTime > MAX_SNAPSHOT_LAG_MS
  ) {
    throw new Error('Review export snapshot window is unavailable')
  }
}

function buildEntries(
  tables: ReviewExportTables,
  asOf: Date,
): readonly OrganizationExportEntry[] {
  const base = {
    version: REVIEW_EXPORT_VERSION,
    requestedAsOf: asOf.toISOString(),
    snapshotBound: SNAPSHOT_BOUND,
    excludedRecordClasses: EXCLUDED_RECORD_CLASSES,
  }
  // Sorted by UTF-8 byte order, never by host locale.
  return [
    csvEntry('review/replies.csv', [['reply', tables.replies]]),
    jsonEntry('review/replies.json', { ...base, replies: tables.replies }),
    csvEntry('review/reply-authorizations.csv', [
      ['reply_publication_authorization', tables.authorizations],
    ]),
    jsonEntry('review/reply-authorizations.json', {
      ...base,
      authorizations: tables.authorizations,
    }),
    csvEntry('review/reply-publication-attempts.csv', [
      ['reply_publication_attempt', tables.attempts],
    ]),
    jsonEntry('review/reply-publication-attempts.json', {
      ...base,
      attempts: tables.attempts,
    }),
  ].sort((left, right) =>
    Buffer.compare(Buffer.from(left.path, 'utf8'), Buffer.from(right.path, 'utf8')),
  )
}

/**
 * Concrete Review-owned Organization Export contribution.
 *
 * Reads: `replies` (only `source = 'internal'`),
 * `reply_publication_authorizations`, `reply_publication_attempts`.
 *
 * Reads nothing else. An Organization with no manager-authored reply work
 * answers `no_data`; an empty replies CSV is never fabricated.
 */
export const createReviewOrganizationExportContributor = (
  db: Database,
): OrganizationExportContributor =>
  Object.freeze({
    context: 'review' as const,
    async contribute({ organizationId, asOf }): Promise<OrganizationExportContribution> {
      const tables = await db.transaction(
        async (snapshot) => {
          await assertBoundedSnapshot(snapshot, asOf)
          return readTables(snapshot, organizationId)
        },
        { isolationLevel: 'repeatable read', accessMode: 'read only' },
      )
      const isEmpty = Object.values(tables).every((rows) => rows.length === 0)
      if (isEmpty) {
        return {
          context: 'review' as const,
          coverage: 'no_data' as const,
          omissionCodes: [],
          entries: [],
        }
      }
      return {
        context: 'review' as const,
        coverage: 'complete' as const,
        omissionCodes: [],
        entries: buildEntries(tables, asOf),
      }
    },
  })
