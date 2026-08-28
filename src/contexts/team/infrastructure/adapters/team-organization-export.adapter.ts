// Team's Organization Export contribution — a quarantined context that still
// has to answer.
//
// Team is retired in favour of Portal Groups (ADR 0052) and `team.use` is
// unconditionally blocked. That decides what an Organization may *do*, not what
// it *owns*: a Team row and its historical memberships were authored by the
// tenant, are Organization- and Property-scoped, and remain tenant-visible
// records. Withholding them behind an omission code would hide real data behind
// a product decision, which is exactly what LIF-01's coverage report exists to
// prevent. So this contributor answers 'complete' when rows exist and 'no_data'
// when they do not, and never 'omitted'.
//
// Reading rows is not activating a capability. This module constructs no
// repository, exposes no use case, and is deliberately NOT reachable from
// `buildTeamContext` — the Team quarantine pin
// (src/shared/architecture/context-acceptance-matrix.test.ts, row 11) requires
// build.ts to import nothing from application/ or infrastructure/, so the
// composition root constructs this adapter directly, the way Identity's own
// contributor is constructed.

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

type TeamOrganizationExportPayload = Readonly<{
  version: 'team-organization-export/v1'
  requestedAsOf: string
  snapshotBound: 'repeatable_read_within_15m_of_request'
  capabilityPosture: 'quarantined_team_use_blocked'
  teams: readonly ExportRecord[]
  memberships: readonly ExportRecord[]
  portalGroupScopes: readonly ExportRecord[]
  excludedRecordClasses: readonly ExcludedRecordClass[]
}>

const MAX_SNAPSHOT_LAG_MS = 15 * 60 * 1000

const EXCLUDED_RECORD_CLASSES: readonly ExcludedRecordClass[] = Object.freeze([
  {
    // Staff owns the person; Team owns only the historical grouping.
    recordClass: 'staff_participant_and_participation_detail',
    reasonCode: 'exported_by_staff_contributor',
  },
  {
    // A Team row is not a Portal Group row and must never be presented as one
    // — the CONTEXT.md quarantine invariant forbids that mapping.
    recordClass: 'portal_group_definitions',
    reasonCode: 'exported_by_portal_contributor',
  },
])

function normalizeScalar(value: unknown, field: string): ExportScalar {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return value
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`Team export field is invalid: ${field}`)
    return value
  }
  if (typeof value === 'bigint') return value.toString()
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString()
  throw new Error(`Team export field has an unsupported value: ${field}`)
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

const TEAM_COLUMNS = [
  'id',
  'property_id',
  'name',
  'description',
  'team_lead_id',
  'created_at',
  'updated_at',
  'deleted_at',
] as const

const MEMBERSHIP_COLUMNS = [
  'id',
  'property_id',
  'team_id',
  'staff_participation_id',
  'role',
  'effective_from',
  'effective_to',
  'end_reason',
  'created_by',
] as const

const PORTAL_GROUP_SCOPE_COLUMNS = [
  'id',
  'property_id',
  'team_id',
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
): Promise<TeamOrganizationExportPayload> {
  return db.transaction(
    async (snapshot) => {
      const snapshotRows = await readRows(
        snapshot,
        sql`SELECT transaction_timestamp() AS snapshot_at`,
      )
      const snapshotAt = snapshotRows[0]?.snapshot_at
      if (typeof snapshotAt !== 'string') {
        throw new Error('Team export snapshot clock is unavailable')
      }
      const snapshotTime = new Date(snapshotAt).getTime()
      const requestTime = asOf.getTime()
      if (
        Number.isNaN(requestTime) ||
        snapshotTime < requestTime ||
        snapshotTime - requestTime > MAX_SNAPSHOT_LAG_MS
      ) {
        throw new Error('Team export snapshot window is unavailable')
      }

      // Soft-deleted Teams stay in the archive. `deleted_at` is exported as a
      // fact so the tenant can see that a Team was retired without the export
      // silently losing the rows its memberships still point at.
      const teams = await readRows(
        snapshot,
        sql`SELECT
              id,
              property_id,
              name,
              description,
              team_lead_id,
              to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at,
              to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS updated_at,
              to_char(deleted_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS deleted_at
            FROM teams
            WHERE organization_id = ${organizationId}
            ORDER BY property_id, created_at, id`,
      )
      // Half-open membership intervals are preserved exactly; the quarantine
      // invariant forbids erasing history during migration.
      const memberships = await readRows(
        snapshot,
        sql`SELECT
              id,
              property_id,
              team_id,
              staff_participation_id,
              role,
              to_char(effective_from AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS effective_from,
              to_char(effective_to AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS effective_to,
              end_reason,
              created_by
            FROM team_memberships
            WHERE organization_id = ${organizationId}
            ORDER BY team_id, effective_from, id`,
      )
      const portalGroupScopes = await readRows(
        snapshot,
        sql`SELECT
              id,
              property_id,
              team_id,
              portal_group_id,
              to_char(effective_from AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS effective_from,
              to_char(effective_to AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS effective_to,
              end_reason,
              created_by
            FROM team_portal_group_scopes
            WHERE organization_id = ${organizationId}
            ORDER BY team_id, effective_from, id`,
      )

      return {
        version: 'team-organization-export/v1',
        requestedAsOf: asOf.toISOString(),
        snapshotBound: 'repeatable_read_within_15m_of_request',
        capabilityPosture: 'quarantined_team_use_blocked',
        teams,
        memberships,
        portalGroupScopes,
        excludedRecordClasses: EXCLUDED_RECORD_CLASSES,
      }
    },
    { isolationLevel: 'repeatable read', accessMode: 'read only' },
  )
}

function buildEntries(
  payload: TeamOrganizationExportPayload,
): readonly OrganizationExportEntry[] {
  const groups: readonly Readonly<{
    slug: string
    collections: readonly ExportCollection[]
    json: unknown
  }>[] = [
    {
      slug: 'teams',
      collections: [
        { recordType: 'team', columns: TEAM_COLUMNS, records: payload.teams },
      ],
      json: {
        version: payload.version,
        requestedAsOf: payload.requestedAsOf,
        capabilityPosture: payload.capabilityPosture,
        teams: payload.teams,
        excludedRecordClasses: payload.excludedRecordClasses,
      },
    },
    {
      slug: 'memberships',
      collections: [
        {
          recordType: 'team_membership',
          columns: MEMBERSHIP_COLUMNS,
          records: payload.memberships,
        },
      ],
      json: {
        version: payload.version,
        requestedAsOf: payload.requestedAsOf,
        capabilityPosture: payload.capabilityPosture,
        memberships: payload.memberships,
      },
    },
    {
      slug: 'portal-group-scopes',
      collections: [
        {
          recordType: 'team_portal_group_scope',
          columns: PORTAL_GROUP_SCOPE_COLUMNS,
          records: payload.portalGroupScopes,
        },
      ],
      json: {
        version: payload.version,
        requestedAsOf: payload.requestedAsOf,
        capabilityPosture: payload.capabilityPosture,
        portalGroupScopes: payload.portalGroupScopes,
      },
    },
  ]

  return groups.flatMap(({ slug, collections, json }) => [
    csvEntry(`team/${slug}.csv`, collections),
    jsonEntry(`team/${slug}.json`, json),
  ])
}

function countRecords(payload: TeamOrganizationExportPayload): number {
  return (
    payload.teams.length + payload.memberships.length + payload.portalGroupScopes.length
  )
}

/**
 * Team-owned Organization Export contribution.
 *
 * A quarantined context is still a contributor. It returns 'complete' with real
 * rows for an Organization that used Teams before ADR 0052, and the affirmative
 * 'no_data' for one that never did — which is the common case in beta, because
 * the capability has been blocked throughout. It has no omission code because
 * it withholds nothing.
 */
export const createTeamOrganizationExportContributor = (
  db: Database,
): OrganizationExportContributor =>
  Object.freeze({
    context: 'team' as const,
    async contribute({ organizationId, asOf }) {
      const payload = await readPayload(db, organizationId, asOf)
      if (countRecords(payload) === 0) {
        return {
          context: 'team' as const,
          coverage: 'no_data' as const,
          omissionCodes: [],
          entries: [],
        }
      }
      return {
        context: 'team' as const,
        coverage: 'complete' as const,
        omissionCodes: [],
        entries: buildEntries(payload),
      }
    },
  })
