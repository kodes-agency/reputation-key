import { sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import type { OrganizationGoogleCredentialHomeAuthority } from '../application/ports/organization-google-credential-home-authority.port'
import { organizationGoogleCredentialHomeFromSqlRow } from './organization-google-credential-home-row'
import { applyOrganizationGoogleCredentialHome } from './organization-google-credential-home-command'

/**
 * Snapshot-consistent canonical authority read. Connection rows contribute
 * only the active-grant replacement count; they can never select a home.
 */
export const createOrganizationGoogleCredentialHomeAuthority = (
  db: Database,
): OrganizationGoogleCredentialHomeAuthority => {
  return Object.freeze({
    inspectForCredentialExchange: async (input) =>
      db.transaction(async (tx) => {
        await tx.execute(sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`)
        const authorityRows = await tx.execute(sql`
          SELECT organization_id, home_cell_id, catalogue_policy_version,
                 authority_generation, created_at, updated_at
          FROM google_organization_credential_homes
          WHERE organization_id = ${input.organizationId}
            AND superseded_at IS NULL
          LIMIT 2
        `)
        if (authorityRows.rows.length > 1) {
          throw new Error('Google credential-home authority is ambiguous')
        }
        const activeCountRows = await tx.execute(sql`
          SELECT count(*)::int AS active_count
          FROM google_connections
          WHERE organization_id = ${input.organizationId}
            AND credential_use_state = 'active'
            AND (
              ${input.targetConnectionId}::uuid IS NULL
              OR id <> ${input.targetConnectionId}::uuid
            )
        `)
        const activeCount = activeCountRows.rows[0]?.active_count
        if (typeof activeCount !== 'number' || activeCount < 0) {
          throw new Error('Google credential-home active grant count is invalid')
        }
        const row = authorityRows.rows[0]
        if (!row) {
          return { authority: null, otherActiveGrantCount: activeCount }
        }
        const authority = organizationGoogleCredentialHomeFromSqlRow(
          input.organizationId,
          row,
        )
        if (!authority) {
          throw new Error('Google credential-home authority row is invalid')
        }
        return {
          authority,
          otherActiveGrantCount: activeCount,
        }
      }),
    reserveForCredentialExchange: async (input) =>
      db.transaction((tx) =>
        applyOrganizationGoogleCredentialHome(tx, {
          organizationId: input.organizationId,
          targetConnectionId: input.targetConnectionId,
          requested: input.requested,
          reason: input.reason,
          changedBy: input.changedBy,
          changeTicket: null,
          now: input.now,
        }),
      ),
  })
}
