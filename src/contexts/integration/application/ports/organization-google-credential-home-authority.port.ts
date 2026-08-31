import type { GoogleConnectionId, OrganizationId } from '#/shared/domain/ids'
import type { UserId } from '#/shared/domain/ids'
import type { GoogleCredentialHomeBinding } from '#/shared/domain/google-credential-home'
import type { OrganizationGoogleCredentialHome } from '../../domain/organizationGoogleCredentialHome'
import type { GoogleCredentialHomeTransitionReason } from '../../domain/organizationGoogleCredentialHome'

/**
 * Canonical Organization credential-home read authority. The active-grant
 * count is used only as a replacement fence; callers must never infer a home
 * from connection rows, country, request origin, or a sibling majority.
 */
export type OrganizationGoogleCredentialHomeInspection = Readonly<{
  authority: OrganizationGoogleCredentialHome | null
  otherActiveGrantCount: number
}>

export type OrganizationGoogleCredentialHomeAuthority = Readonly<{
  inspectForCredentialExchange(
    input: Readonly<{
      organizationId: OrganizationId
      targetConnectionId: GoogleConnectionId | null
    }>,
  ): Promise<OrganizationGoogleCredentialHomeInspection>
  /**
   * Persists the exact Organization home before any credential-bearing egress.
   * The implementation repeats the transition decision under the canonical
   * Organization lock, so the later provider permit never relies on a
   * connection row that does not exist yet.
   */
  reserveForCredentialExchange(
    input: Readonly<{
      organizationId: OrganizationId
      targetConnectionId: GoogleConnectionId | null
      requested: GoogleCredentialHomeBinding
      reason: GoogleCredentialHomeTransitionReason
      changedBy: UserId
      now: Date
    }>,
  ): Promise<void>
}>
