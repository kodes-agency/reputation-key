import {
  DATA_CELL_CATALOGUE_POLICY_VERSION,
  isDataCellAccepting,
  type DataCellId,
} from '#/shared/domain/data-cell-catalogue'
import type { OrganizationId } from '#/shared/domain/ids'
import type { GoogleCredentialHome } from '#/shared/domain/google-credential-home'

export type OrganizationGoogleCredentialHome = GoogleCredentialHome &
  Readonly<{
    organizationId: OrganizationId
    authorityGeneration: number
    createdAt: Date
    updatedAt: Date
  }>

export type GoogleCredentialHomeTransitionReason =
  'new_grant' | 'credential_rotation' | 'governed_reconnect' | 'legacy_backfill'

export type OrganizationGoogleCredentialHomeTransition =
  | Readonly<{ kind: 'establish'; nextGeneration: 1 }>
  | Readonly<{ kind: 'preserve'; expectedGeneration: number }>
  | Readonly<{
      kind: 'replace'
      expectedGeneration: number
      nextGeneration: number
    }>
  | Readonly<{
      kind: 'deny'
      code:
        | 'cell_not_accepting'
        | 'policy_mismatch'
        | 'replacement_not_authorized'
        | 'other_active_grants'
        | 'active_grants_without_authority'
        | 'invalid_active_grant_count'
        | 'generation_exhausted'
    }>

/** Pure decision used again under the command transaction's row/advisory lock. */
export function decideOrganizationGoogleCredentialHomeTransition(
  input: Readonly<{
    current: OrganizationGoogleCredentialHome | null
    requested: GoogleCredentialHome
    reason: GoogleCredentialHomeTransitionReason
    otherActiveGrantCount: number
    isAcceptingCell?: (cellId: string) => boolean
    expectedCataloguePolicyVersion?: number
  }>,
): OrganizationGoogleCredentialHomeTransition {
  if (
    !Number.isSafeInteger(input.otherActiveGrantCount) ||
    input.otherActiveGrantCount < 0
  ) {
    return { kind: 'deny', code: 'invalid_active_grant_count' }
  }
  const accepting = input.isAcceptingCell ?? isDataCellAccepting
  if (!accepting(input.requested.homeCellId)) {
    return { kind: 'deny', code: 'cell_not_accepting' }
  }
  if (
    input.requested.cataloguePolicyVersion !==
    (input.expectedCataloguePolicyVersion ?? DATA_CELL_CATALOGUE_POLICY_VERSION)
  ) {
    return { kind: 'deny', code: 'policy_mismatch' }
  }
  if (!input.current) {
    if (
      input.reason === 'credential_rotation' ||
      (input.otherActiveGrantCount > 0 && input.reason !== 'governed_reconnect')
    ) {
      return { kind: 'deny', code: 'active_grants_without_authority' }
    }
    return { kind: 'establish', nextGeneration: 1 }
  }
  if (
    input.current.homeCellId === input.requested.homeCellId &&
    input.current.cataloguePolicyVersion === input.requested.cataloguePolicyVersion
  ) {
    return {
      kind: 'preserve',
      expectedGeneration: input.current.authorityGeneration,
    }
  }
  if (input.reason !== 'governed_reconnect' && input.reason !== 'legacy_backfill') {
    return { kind: 'deny', code: 'replacement_not_authorized' }
  }
  if (input.otherActiveGrantCount > 0) {
    return { kind: 'deny', code: 'other_active_grants' }
  }
  if (
    !Number.isSafeInteger(input.current.authorityGeneration) ||
    input.current.authorityGeneration < 1 ||
    input.current.authorityGeneration === Number.MAX_SAFE_INTEGER
  ) {
    return { kind: 'deny', code: 'generation_exhausted' }
  }
  return {
    kind: 'replace',
    expectedGeneration: input.current.authorityGeneration,
    nextGeneration: input.current.authorityGeneration + 1,
  }
}

export function organizationCredentialHomeValue(
  authority: OrganizationGoogleCredentialHome,
): GoogleCredentialHome {
  return Object.freeze({
    homeCellId: authority.homeCellId as DataCellId,
    cataloguePolicyVersion: authority.cataloguePolicyVersion,
  })
}
