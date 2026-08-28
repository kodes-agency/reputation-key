import {
  DATA_CELL_CATALOGUE_POLICY_VERSION,
  type DataCellId,
} from '#/shared/domain/data-cell-catalogue'
import type { OrganizationId, GoogleConnectionId, UserId } from '#/shared/domain/ids'
import type { GoogleCredentialHomeBinding } from '#/shared/domain/google-credential-home'
import { integrationError } from '../domain/errors'
import {
  decideOrganizationGoogleCredentialHomeTransition,
  organizationCredentialHomeValue,
} from '../domain/organizationGoogleCredentialHome'
import type { OrganizationGoogleCredentialHomeAuthority } from './ports/organization-google-credential-home-authority.port'

export type CaptureGoogleCredentialHome = (
  input: Readonly<{
    organizationId: OrganizationId
    mode: 'new' | 'reauth' | 'reconnect'
    targetConnectionId: GoogleConnectionId | null
    changedBy: UserId
    now: Date
  }>,
) => Promise<GoogleCredentialHomeBinding>

/**
 * Captures the canonical Organization authority before a credential-bearing
 * OAuth exchange. The authority implementation may count active grants as a
 * replacement fence, but no connection, country, or request-origin value is
 * ever allowed to select the home.
 */
export function createGoogleCredentialHomeCapture(
  deps: Readonly<{
    authority: OrganizationGoogleCredentialHomeAuthority
    localCellId: DataCellId
  }>,
): CaptureGoogleCredentialHome {
  return async (input) => {
    const inspection = await deps.authority.inspectForCredentialExchange({
      organizationId: input.organizationId,
      targetConnectionId: input.targetConnectionId,
    })
    const requested = Object.freeze({
      homeCellId: deps.localCellId,
      cataloguePolicyVersion: DATA_CELL_CATALOGUE_POLICY_VERSION,
    })
    const reason =
      input.mode === 'new'
        ? ('new_grant' as const)
        : input.mode === 'reconnect'
          ? ('governed_reconnect' as const)
          : ('credential_rotation' as const)
    const decision = decideOrganizationGoogleCredentialHomeTransition({
      current: inspection.authority,
      requested,
      reason,
      otherActiveGrantCount: inspection.otherActiveGrantCount,
    })
    if (decision.kind === 'deny') {
      throw integrationError('oauth_failed', 'Google credential home is unavailable')
    }
    let binding: GoogleCredentialHomeBinding
    if (decision.kind === 'preserve') {
      if (!inspection.authority) {
        throw integrationError('oauth_failed', 'Google credential home is unavailable')
      }
      binding = Object.freeze({
        ...organizationCredentialHomeValue(inspection.authority),
        authorityGeneration: decision.expectedGeneration,
      })
    } else {
      binding = Object.freeze({
        ...requested,
        authorityGeneration: decision.nextGeneration,
      })
    }

    await deps.authority.reserveForCredentialExchange({
      organizationId: input.organizationId,
      targetConnectionId: input.targetConnectionId,
      requested: binding,
      reason,
      changedBy: input.changedBy,
      now: input.now,
    })
    return binding
  }
}
