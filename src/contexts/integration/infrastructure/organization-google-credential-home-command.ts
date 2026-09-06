import { sql } from 'drizzle-orm'
import type { Tx } from '#/shared/outbox/commit'
import type { GoogleConnectionId, OrganizationId, UserId } from '#/shared/domain/ids'
import type { GoogleCredentialHomeBinding } from '#/shared/domain/google-credential-home'
import { integrationError } from '../domain/errors'
import {
  decideOrganizationGoogleCredentialHomeTransition,
  type GoogleCredentialHomeTransitionReason,
  type OrganizationGoogleCredentialHome,
} from '../domain/organizationGoogleCredentialHome'
import { organizationGoogleCredentialHomeFromSqlRow } from './organization-google-credential-home-row'

export type ApplyOrganizationGoogleCredentialHome = (
  tx: Tx,
  input: Readonly<{
    organizationId: OrganizationId
    targetConnectionId: GoogleConnectionId | null
    requested: GoogleCredentialHomeBinding
    reason: GoogleCredentialHomeTransitionReason
    changedBy: UserId
    changeTicket: string | null
    now: Date
  }>,
) => Promise<void>

function currentAuthority(
  organization: OrganizationId,
  row: Record<string, unknown> | undefined,
): OrganizationGoogleCredentialHome | null {
  if (!row) return null
  const authority = organizationGoogleCredentialHomeFromSqlRow(organization, row)
  if (!authority) {
    throw integrationError('oauth_failed', 'Google credential home is unavailable')
  }
  return authority
}

/**
 * Repeats the pre-exchange decision under the Organization advisory lock and
 * authority row lock in the same transaction that writes the connection.
 * This is the atomic backstop for races between OAuth exchange and commit.
 */
export const applyOrganizationGoogleCredentialHome: ApplyOrganizationGoogleCredentialHome =
  async (tx, input) => {
    await tx.execute(sql`
      SELECT pg_advisory_xact_lock(
        hashtextextended('google-credential-home:' || ${input.organizationId}, 0)
      )
    `)
    const authorityRows = await tx.execute(sql`
      SELECT organization_id, home_cell_id, catalogue_policy_version,
             authority_generation, created_at, updated_at
      FROM google_organization_credential_homes
      WHERE organization_id = ${input.organizationId}
        AND superseded_at IS NULL
      FOR UPDATE
    `)
    if (authorityRows.rows.length > 1) {
      throw integrationError('oauth_failed', 'Google credential home is unavailable')
    }
    const countRows = await tx.execute(sql`
      SELECT count(*)::int AS active_count
      FROM google_connections
      WHERE organization_id = ${input.organizationId}
        AND credential_use_state = 'active'
        AND (
          ${input.targetConnectionId}::uuid IS NULL
          OR id <> ${input.targetConnectionId}::uuid
        )
    `)
    const activeCount = countRows.rows[0]?.active_count
    if (typeof activeCount !== 'number') {
      throw integrationError('oauth_failed', 'Google credential home is unavailable')
    }
    const decision = decideOrganizationGoogleCredentialHomeTransition({
      current: currentAuthority(input.organizationId, authorityRows.rows[0]),
      requested: input.requested,
      reason: input.reason,
      otherActiveGrantCount: activeCount,
    })
    if (decision.kind === 'deny') {
      throw integrationError('oauth_failed', 'Google credential home is unavailable')
    }
    const decidedGeneration =
      decision.kind === 'preserve' ? decision.expectedGeneration : decision.nextGeneration
    if (input.requested.authorityGeneration !== decidedGeneration) {
      throw integrationError('oauth_failed', 'Google credential home is unavailable')
    }
    if (decision.kind === 'preserve') return
    if (decision.kind === 'establish') {
      await tx.execute(sql`
        INSERT INTO google_organization_credential_homes (
          organization_id, home_cell_id, catalogue_policy_version,
          authority_generation, transition_reason, changed_by, change_ticket,
          effective_from, superseded_at, created_at, updated_at
        ) VALUES (
          ${input.organizationId}, ${input.requested.homeCellId},
          ${input.requested.cataloguePolicyVersion}, ${decision.nextGeneration},
          ${input.reason}, ${input.changedBy}, ${input.changeTicket},
          ${input.now}, NULL, ${input.now}, ${input.now}
        )
      `)
      return
    }
    const superseded = await tx.execute(sql`
      UPDATE google_organization_credential_homes
      SET superseded_at = ${input.now},
          updated_at = ${input.now}
      WHERE organization_id = ${input.organizationId}
        AND authority_generation = ${decision.expectedGeneration}
        AND superseded_at IS NULL
      RETURNING organization_id
    `)
    if (superseded.rows.length !== 1) {
      throw integrationError('oauth_failed', 'Google credential home is unavailable')
    }
    await tx.execute(sql`
      INSERT INTO google_organization_credential_homes (
        organization_id, home_cell_id, catalogue_policy_version,
        authority_generation, transition_reason, changed_by, change_ticket,
        effective_from, superseded_at, created_at, updated_at
      ) VALUES (
        ${input.organizationId}, ${input.requested.homeCellId},
        ${input.requested.cataloguePolicyVersion}, ${decision.nextGeneration},
        ${input.reason}, ${input.changedBy}, ${input.changeTicket},
        ${input.now}, NULL, ${input.now}, ${input.now}
      )
    `)
  }
