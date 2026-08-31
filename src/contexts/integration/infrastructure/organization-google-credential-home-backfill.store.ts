import { sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import type { Clock } from '#/shared/domain/clock'
import { googleConnectionId, type OrganizationId } from '#/shared/domain/ids'
import type {
  GoogleCredentialHomeBackfillConnectionFact,
  OrganizationGoogleCredentialHomeBackfillReport,
  OrganizationGoogleCredentialHomeBackfillStore,
} from '../application/organization-google-credential-home-backfill'
import { buildOrganizationGoogleCredentialHomeBackfillReport } from '../application/organization-google-credential-home-backfill'
import type { OrganizationGoogleCredentialHome } from '../domain/organizationGoogleCredentialHome'
import type { GoogleCredentialUseState } from '../domain/types'
import { organizationGoogleCredentialHomeFromSqlRow } from './organization-google-credential-home-row'

type ExecuteDatabase = Pick<Database, 'execute'>

function isUseState(value: unknown): value is GoogleCredentialUseState {
  return value === 'active' || value === 'cleanup_only' || value === 'none'
}

async function loadReportSnapshot(
  db: ExecuteDatabase,
  orgId: OrganizationId,
  lock: boolean,
): Promise<OrganizationGoogleCredentialHomeBackfillReport> {
  const authorityRows = await db.execute(
    lock
      ? sql`
          SELECT organization_id, home_cell_id, catalogue_policy_version,
                 authority_generation, created_at, updated_at
          FROM google_organization_credential_homes
          WHERE organization_id = ${orgId}
            AND superseded_at IS NULL
          FOR UPDATE
        `
      : sql`
          SELECT organization_id, home_cell_id, catalogue_policy_version,
                 authority_generation, created_at, updated_at
          FROM google_organization_credential_homes
          WHERE organization_id = ${orgId}
            AND superseded_at IS NULL
        `,
  )
  if (authorityRows.rows.length > 1) {
    throw new Error('Google credential-home authority is ambiguous')
  }
  const authorityRow = authorityRows.rows[0]
  let authority: OrganizationGoogleCredentialHome | null = null
  if (authorityRow) {
    authority = organizationGoogleCredentialHomeFromSqlRow(orgId, authorityRow)
    if (!authority) {
      throw new Error('Google credential-home authority row is invalid')
    }
  }
  const connectionRows = await db.execute(
    lock
      ? sql`
          SELECT id::text AS id, credential_use_state,
                 credential_home_cell_id, credential_home_policy_version,
                 credential_home_authority_generation
          FROM google_connections
          WHERE organization_id = ${orgId}
          ORDER BY id
          FOR UPDATE
        `
      : sql`
          SELECT id::text AS id, credential_use_state,
                 credential_home_cell_id, credential_home_policy_version,
                 credential_home_authority_generation
          FROM google_connections
          WHERE organization_id = ${orgId}
          ORDER BY id
        `,
  )
  const connections: GoogleCredentialHomeBackfillConnectionFact[] = []
  for (const row of connectionRows.rows) {
    if (
      typeof row.id !== 'string' ||
      !isUseState(row.credential_use_state) ||
      (row.credential_home_cell_id !== null &&
        typeof row.credential_home_cell_id !== 'string') ||
      (row.credential_home_policy_version !== null &&
        typeof row.credential_home_policy_version !== 'number') ||
      (row.credential_home_authority_generation !== null &&
        typeof row.credential_home_authority_generation !== 'number')
    ) {
      throw new Error('Google credential-home connection fact is invalid')
    }
    connections.push({
      connectionId: googleConnectionId(row.id),
      credentialUseState: row.credential_use_state,
      credentialHomeCellId: row.credential_home_cell_id,
      credentialHomePolicyVersion: row.credential_home_policy_version,
      credentialHomeAuthorityGeneration: row.credential_home_authority_generation,
    })
  }
  return buildOrganizationGoogleCredentialHomeBackfillReport({
    organizationId: orgId,
    authority,
    connections,
  })
}

/** Exact-report/CAS legacy authority repair; no cell selection exists here. */
export const createOrganizationGoogleCredentialHomeBackfillStore = (
  db: Database,
  clock: Clock,
): OrganizationGoogleCredentialHomeBackfillStore => {
  return Object.freeze({
    report: (orgId) =>
      db.transaction(async (tx) => {
        await tx.execute(sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`)
        return loadReportSnapshot(tx, orgId, false)
      }),
    apply: (input) =>
      db.transaction(async (tx) => {
        await tx.execute(sql`SET TRANSACTION ISOLATION LEVEL SERIALIZABLE`)
        await tx.execute(sql`
          SELECT pg_advisory_xact_lock(
            hashtextextended('google-credential-home:' || ${input.organizationId}, 0)
          )
        `)
        const current = await loadReportSnapshot(tx, input.organizationId, true)
        if (current.reportDigestSha256 !== input.expectedReportDigestSha256) {
          return { kind: 'stale_report' as const }
        }
        if (current.authorityPresent) return { kind: 'authority_exists' as const }
        if (current.activeGrantCount === 0) {
          return { kind: 'no_active_legacy_grants' as const }
        }
        if (current.malformedHomePairCount !== 0) {
          return { kind: 'malformed_home_pair' as const }
        }
        if (
          current.persistedHomeCounts.some(
            (entry) =>
              entry.homeCellId !== input.selectedHome.homeCellId ||
              entry.cataloguePolicyVersion !== input.selectedHome.cataloguePolicyVersion,
          )
        ) {
          return { kind: 'persisted_home_conflict' as const }
        }
        const now = clock()
        await tx.execute(sql`
          INSERT INTO google_organization_credential_homes (
            organization_id, home_cell_id, catalogue_policy_version,
            authority_generation, transition_reason, changed_by, change_ticket,
            effective_from, superseded_at, created_at, updated_at
          ) VALUES (
            ${input.organizationId}, ${input.selectedHome.homeCellId},
            ${input.selectedHome.cataloguePolicyVersion}, 1, 'legacy_backfill',
            ${input.operatorId}, ${input.ticket}, ${now}, NULL, ${now}, ${now}
          )
        `)
        const updated = await tx.execute(sql`
          UPDATE google_connections
          SET credential_home_cell_id = ${input.selectedHome.homeCellId},
              credential_home_policy_version =
                ${input.selectedHome.cataloguePolicyVersion},
              credential_home_authority_generation = 1,
              updated_at = ${now}
          WHERE organization_id = ${input.organizationId}
            AND credential_use_state = 'active'
            AND (
              (
                credential_home_cell_id IS NULL
                AND credential_home_policy_version IS NULL
                AND credential_home_authority_generation IS NULL
              ) OR (
                credential_home_cell_id = ${input.selectedHome.homeCellId}
                AND credential_home_policy_version =
                  ${input.selectedHome.cataloguePolicyVersion}
                AND credential_home_authority_generation IS NULL
              )
            )
          RETURNING id
        `)
        return { kind: 'applied' as const, updatedCount: updated.rows.length }
      }),
  })
}
