// Staff's Organization Export contribution (LIF-01 work item 6: "people /
// access / responsibility").
//
// Staff owns the people directory — Staff Participants, their optional login
// link, their per-Property participation, their Portal Responsibility, and the
// effective-dated Portal Group membership that gives event-time attribution its
// meaning. Those rows are tenant-visible: the Organization created them and an
// AccountAdmin can already read them in product.
//
// Two things Staff deliberately does NOT export:
//   1. The identity-owned property access authority. Identity's contributor
//      already exports the canonical and compatibility grant rows, and the
//      context acceptance matrix (row 1) makes Identity their sole reader.
//      Duplicating them here would both break that boundary and put two
//      divergent copies of an authorization record in one archive.
//   2. Anything belonging to the dark Staff User login. Participation is a
//      people fact; sign-in material is not, and LIF-01 work item 7 excludes
//      credentials, sessions, and tokens outright. No such table is queried.

import { sql, type SQL } from 'drizzle-orm'
import { canonicalizeRfc8785 } from '#/shared/canonical-json'
import type { Database } from '#/shared/db'
// Cross-context adapter implementing a foreign port — src/contexts/CONTEXT.md
// "Dependency rules" permits infrastructure/adapters/** to reach application/ports/**.
import type {
  OrganizationExportContributor,
  OrganizationExportEntry,
} from '#/contexts/identity/application/ports/organization-export-contributor.port'

type ExportScalar = string | number | boolean | null
type ExportRecord = Readonly<Record<string, ExportScalar>>

type ExportCollection = Readonly<{
  recordType: string
  columns: readonly string[]
  records: readonly ExportRecord[]
}>

type ExcludedRecordClass = Readonly<{ recordClass: string; reasonCode: string }>

type StaffOrganizationExportPayload = Readonly<{
  version: 'staff-organization-export/v1'
  requestedAsOf: string
  snapshotBound: 'repeatable_read_within_15m_of_request'
  participants: readonly ExportRecord[]
  participantUserLinks: readonly ExportRecord[]
  participations: readonly ExportRecord[]
  portalResponsibilities: readonly ExportRecord[]
  portalGroupMemberships: readonly ExportRecord[]
  excludedRecordClasses: readonly ExcludedRecordClass[]
}>

const MAX_SNAPSHOT_LAG_MS = 15 * 60 * 1000

const EXCLUDED_RECORD_CLASSES: readonly ExcludedRecordClass[] = Object.freeze([
  {
    // The plural compatibility table and the singular canonical table are both
    // Identity's; see the Identity contributor's own payload.
    recordClass: 'property_access_authority_owned_by_identity',
    reasonCode: 'exported_by_identity_contributor',
  },
  {
    recordClass: 'staff_user_login_credentials_and_sessions',
    reasonCode: 'security_secret_material',
  },
])

function normalizeScalar(value: unknown, field: string): ExportScalar {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return value
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value))
      throw new Error(`Staff export field is invalid: ${field}`)
    return value
  }
  if (typeof value === 'bigint') return value.toString()
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString()
  throw new Error(`Staff export field has an unsupported value: ${field}`)
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

function csvField(value: ExportScalar | undefined): string {
  if (value === null || value === undefined) return ''
  const text = String(value)
  return /[",\r\n]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

/**
 * One CSV per file group. The header is the ordered union of the declared
 * columns of every collection in that group, so a record that has no value for
 * a sibling collection's column renders an empty cell rather than shifting the
 * row. Column order is declared, never derived from a driver row's key order.
 */
function csvEntry(
  path: string,
  collections: readonly ExportCollection[],
): OrganizationExportEntry {
  const columns = [...new Set(collections.flatMap(({ columns }) => columns))]
  const lines = [
    ['record_type', ...columns].join(','),
    ...collections.flatMap(({ recordType, records }) =>
      records.map((record) =>
        [csvField(recordType), ...columns.map((column) => csvField(record[column]))].join(
          ',',
        ),
      ),
    ),
  ]
  return {
    path,
    mediaType: 'text/csv',
    classification: 'tenant_visible',
    bytes: Buffer.from(`${lines.join('\n')}\n`, 'utf8'),
  }
}

function jsonEntry(path: string, value: unknown): OrganizationExportEntry {
  return {
    path,
    mediaType: 'application/json',
    classification: 'tenant_visible',
    bytes: Buffer.from(`${canonicalizeRfc8785(value)}\n`, 'utf8'),
  }
}

const PARTICIPANT_COLUMNS = [
  'id',
  'display_name',
  'status',
  'revision',
  'archived_at',
  'archive_reason',
  'created_by',
  'created_at',
  'updated_at',
] as const

const PARTICIPANT_USER_LINK_COLUMNS = [
  'id',
  'staff_participant_id',
  'user_id',
  'effective_from',
  'effective_to',
  'end_reason',
  'created_by',
] as const

const PARTICIPATION_COLUMNS = [
  'id',
  'property_id',
  'staff_participant_id',
  'user_id',
  'display_name',
  'status',
  'revision',
  'started_at',
  'ended_at',
  'archive_reason',
  'created_by',
  'created_at',
  'updated_at',
] as const

const PORTAL_RESPONSIBILITY_COLUMNS = [
  'id',
  'property_id',
  'portal_id',
  'staff_participation_id',
  'kind',
  'effective_from',
  'effective_to',
  'end_reason',
  'created_by',
] as const

const PORTAL_GROUP_MEMBERSHIP_COLUMNS = [
  'id',
  'property_id',
  'portal_id',
  'portal_group_id',
  'effective_from',
  'effective_to',
  'end_reason',
  'created_by',
] as const

async function readPayload(
  db: Database,
  organizationId: string,
  asOf: Date,
): Promise<StaffOrganizationExportPayload> {
  return db.transaction(
    async (snapshot) => {
      const snapshotRows = await readRows(
        snapshot,
        sql`SELECT transaction_timestamp() AS snapshot_at`,
      )
      const snapshotAt = snapshotRows[0]?.snapshot_at
      if (typeof snapshotAt !== 'string') {
        throw new Error('Staff export snapshot clock is unavailable')
      }
      const snapshotTime = new Date(snapshotAt).getTime()
      const requestTime = asOf.getTime()
      if (
        Number.isNaN(requestTime) ||
        snapshotTime < requestTime ||
        snapshotTime - requestTime > MAX_SNAPSHOT_LAG_MS
      ) {
        throw new Error('Staff export snapshot window is unavailable')
      }

      // Every ORDER BY ends on a uuid/identifier so ordering never depends on
      // the database's text collation; the archive must be byte-identical on
      // any host.
      const participants = await readRows(
        snapshot,
        sql`SELECT
              id,
              display_name,
              status,
              revision,
              to_char(archived_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS archived_at,
              archive_reason,
              created_by,
              to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at,
              to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS updated_at
            FROM staff_participants
            WHERE organization_id = ${organizationId}
            ORDER BY created_at, id`,
      )
      const participantUserLinks = await readRows(
        snapshot,
        sql`SELECT
              id,
              staff_participant_id,
              user_id,
              to_char(effective_from AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS effective_from,
              to_char(effective_to AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS effective_to,
              end_reason,
              created_by
            FROM staff_user_links
            WHERE organization_id = ${organizationId}
            ORDER BY staff_participant_id, effective_from, id`,
      )
      const participations = await readRows(
        snapshot,
        sql`SELECT
              id,
              property_id,
              staff_participant_id,
              user_id,
              display_name,
              status,
              revision,
              to_char(started_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS started_at,
              to_char(ended_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS ended_at,
              archive_reason,
              created_by,
              to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at,
              to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS updated_at
            FROM staff_participations
            WHERE organization_id = ${organizationId}
            ORDER BY property_id, created_at, id`,
      )
      const portalResponsibilities = await readRows(
        snapshot,
        sql`SELECT
              id,
              property_id,
              portal_id,
              staff_participation_id,
              kind,
              to_char(effective_from AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS effective_from,
              to_char(effective_to AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS effective_to,
              end_reason,
              created_by
            FROM portal_responsibilities
            WHERE organization_id = ${organizationId}
            ORDER BY portal_id, effective_from, id`,
      )
      // Portal Group membership is effective-dated (ADR 0040) and is what makes
      // an event-time responsibility readable years later, so the people export
      // carries it alongside responsibility rather than only the Portal view.
      const portalGroupMemberships = await readRows(
        snapshot,
        sql`SELECT
              id,
              property_id,
              portal_id,
              portal_group_id,
              to_char(effective_from AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS effective_from,
              to_char(effective_to AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS effective_to,
              end_reason,
              created_by
            FROM portal_group_memberships
            WHERE organization_id = ${organizationId}
            ORDER BY portal_id, effective_from, id`,
      )

      return {
        version: 'staff-organization-export/v1',
        requestedAsOf: asOf.toISOString(),
        snapshotBound: 'repeatable_read_within_15m_of_request',
        participants,
        participantUserLinks,
        participations,
        portalResponsibilities,
        portalGroupMemberships,
        excludedRecordClasses: EXCLUDED_RECORD_CLASSES,
      }
    },
    { isolationLevel: 'repeatable read', accessMode: 'read only' },
  )
}

function buildEntries(
  payload: StaffOrganizationExportPayload,
): readonly OrganizationExportEntry[] {
  const groups: readonly Readonly<{
    slug: string
    collections: readonly ExportCollection[]
    json: unknown
  }>[] = [
    {
      slug: 'participants',
      collections: [
        {
          recordType: 'staff_participant',
          columns: PARTICIPANT_COLUMNS,
          records: payload.participants,
        },
        {
          recordType: 'staff_participant_user_link',
          columns: PARTICIPANT_USER_LINK_COLUMNS,
          records: payload.participantUserLinks,
        },
      ],
      json: {
        version: payload.version,
        requestedAsOf: payload.requestedAsOf,
        participants: payload.participants,
        participantUserLinks: payload.participantUserLinks,
        excludedRecordClasses: payload.excludedRecordClasses,
      },
    },
    {
      slug: 'participations',
      collections: [
        {
          recordType: 'staff_participation',
          columns: PARTICIPATION_COLUMNS,
          records: payload.participations,
        },
      ],
      json: {
        version: payload.version,
        requestedAsOf: payload.requestedAsOf,
        participations: payload.participations,
      },
    },
    {
      slug: 'portal-responsibilities',
      collections: [
        {
          recordType: 'portal_responsibility',
          columns: PORTAL_RESPONSIBILITY_COLUMNS,
          records: payload.portalResponsibilities,
        },
      ],
      json: {
        version: payload.version,
        requestedAsOf: payload.requestedAsOf,
        portalResponsibilities: payload.portalResponsibilities,
      },
    },
    {
      slug: 'portal-group-memberships',
      collections: [
        {
          recordType: 'portal_group_membership',
          columns: PORTAL_GROUP_MEMBERSHIP_COLUMNS,
          records: payload.portalGroupMemberships,
        },
      ],
      json: {
        version: payload.version,
        requestedAsOf: payload.requestedAsOf,
        portalGroupMemberships: payload.portalGroupMemberships,
      },
    },
  ]

  return groups.flatMap(({ slug, collections, json }) => [
    csvEntry(`staff/${slug}.csv`, collections),
    jsonEntry(`staff/${slug}.json`, json),
  ])
}

function countRecords(payload: StaffOrganizationExportPayload): number {
  return (
    payload.participants.length +
    payload.participantUserLinks.length +
    payload.participations.length +
    payload.portalResponsibilities.length +
    payload.portalGroupMemberships.length
  )
}

/**
 * Staff-owned Organization Export contribution.
 *
 * `no_data` is returned only when the Organization genuinely holds no people
 * row at all — an affirmative "nothing here", never an omission and never an
 * invented empty CSV. Staff has no reason to omit: everything it owns is
 * tenant-visible, so it never produces an omission code.
 */
export const createStaffOrganizationExportContributor = (
  db: Database,
): OrganizationExportContributor =>
  Object.freeze({
    context: 'staff' as const,
    async contribute({ organizationId, asOf }) {
      const payload = await readPayload(db, organizationId, asOf)
      if (countRecords(payload) === 0) {
        return {
          context: 'staff' as const,
          coverage: 'no_data' as const,
          omissionCodes: [],
          entries: [],
        }
      }
      return {
        context: 'staff' as const,
        coverage: 'complete' as const,
        omissionCodes: [],
        entries: buildEntries(payload),
      }
    },
  })
