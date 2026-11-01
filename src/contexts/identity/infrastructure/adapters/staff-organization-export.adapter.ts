// Staff's Organization Export contribution (LIF-01 work item 6: "people /
// access / responsibility").
//
// Identity People owns the directory — Staff Participants, their optional login
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
//   2. Anything belonging to the dark Member login capability. Participation is a
//      people fact; sign-in material is not, and LIF-01 work item 7 excludes
//      credentials, sessions, and tokens outright. No such table is queried.

import { sql, type SQL } from 'drizzle-orm'
import type { Database } from '#/shared/db'
// Cross-context adapter implementing a foreign port — src/contexts/CONTEXT.md
// "Dependency rules" permits infrastructure/adapters/** to reach application/ports/**.
import type { OrganizationExportContributor } from '#/contexts/identity/application/ports/organization-export-contributor.port'

import {
  normalizeRows,
  type ExportRecord,
  type StaffOrganizationExportPayload,
  type ExcludedRecordClass,
} from './staff-organization-export-format'
import { buildEntries, countRecords } from './staff-organization-export-collections'
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

async function readRows(
  snapshot: Parameters<Parameters<Database['transaction']>[0]>[0],
  query: SQL,
): Promise<ExportRecord[]> {
  const result = await snapshot.execute(query)
  return normalizeRows(result.rows as Record<string, unknown>[])
}

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
              notice_version,
              to_char(notice_acknowledged_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS notice_acknowledged_at,
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
              personal_portal_id,
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

      const onboardings = await readRows(
        snapshot,
        sql`SELECT id, property_id, email, display_name, source_portal_id, portal_group_id, requested_by, status, step, staff_participant_id, staff_participation_id, portal_id, invitation_id, failure_code,
        to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at,
        to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS updated_at
        FROM staff_onboardings WHERE organization_id = ${organizationId} ORDER BY created_at, id`,
      )
      const propertySettings = await readRows(
        snapshot,
        sql`SELECT property_id, colleague_list_enabled, updated_by,
        to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS updated_at
        FROM staff_property_settings WHERE organization_id = ${organizationId} ORDER BY property_id`,
      )
      return {
        onboardings,
        propertySettings,
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

/**
 * Identity-owned People contribution to the Organization Export.
 *
 * `no_data` is returned only when the Organization genuinely holds no people
 * row at all — an affirmative "nothing here", never an omission and never an
 * invented empty CSV. Identity People has no reason to omit: everything it owns
 * is tenant-visible, so it never produces an omission code.
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
