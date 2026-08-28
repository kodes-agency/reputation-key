import { dataCellById } from '#/shared/domain/data-cell-catalogue'
import type { OrganizationId } from '#/shared/domain/ids'
import type { OrganizationGoogleCredentialHome } from '../domain/organizationGoogleCredentialHome'

function postgresTimestamp(value: unknown): Date | null {
  const parsed =
    value instanceof Date
      ? new Date(value.getTime())
      : typeof value === 'string'
        ? new Date(value)
        : null
  return parsed && !Number.isNaN(parsed.getTime()) ? parsed : null
}

/**
 * Raw Drizzle SQL returns PostgreSQL timestamptz fields as text. Rehydrate the
 * canonical credential-home row without accepting malformed identifiers,
 * versions, generations, or timestamps.
 */
export function organizationGoogleCredentialHomeFromSqlRow(
  organization: OrganizationId,
  row: Record<string, unknown>,
): OrganizationGoogleCredentialHome | null {
  if (row.organization_id !== organization) {
    return null
  }
  const homeCell =
    typeof row.home_cell_id === 'string' ? dataCellById(row.home_cell_id)?.id : undefined
  const policyVersion = row.catalogue_policy_version
  const authorityGeneration = row.authority_generation
  const createdAt = postgresTimestamp(row.created_at)
  const updatedAt = postgresTimestamp(row.updated_at)
  if (
    !homeCell ||
    typeof policyVersion !== 'number' ||
    !Number.isSafeInteger(policyVersion) ||
    policyVersion < 1 ||
    typeof authorityGeneration !== 'number' ||
    !Number.isSafeInteger(authorityGeneration) ||
    authorityGeneration < 1 ||
    createdAt === null ||
    updatedAt === null
  ) {
    return null
  }
  return Object.freeze({
    organizationId: organization,
    homeCellId: homeCell,
    cataloguePolicyVersion: policyVersion,
    authorityGeneration,
    createdAt,
    updatedAt,
  })
}
