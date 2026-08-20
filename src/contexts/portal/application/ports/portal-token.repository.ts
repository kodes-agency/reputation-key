import type { PortalToken } from '../../domain/portal-token'
import type { OrganizationId, PortalId } from '#/shared/domain/ids'

export type PortalTokenRepository = Readonly<{
  findLatestForPortal: (
    organizationId: OrganizationId,
    portalId: PortalId,
  ) => Promise<PortalToken | null>
  findResolvableByDigest: (
    digest: Readonly<{
      tokenIdentifier: string
      tokenHash: string
      tokenKeyVersion: number
    }>,
    asOf: Date,
  ) => Promise<PortalToken | null>
  insert: (token: PortalToken) => Promise<void>
  saveRotation: (
    input: Readonly<{
      oldToken: PortalToken
      newToken: PortalToken
    }>,
  ) => Promise<void>
  revokeForPortal: (
    input: Readonly<{
      organizationId: OrganizationId
      portalId: PortalId
      revokedBy: string
      reason: string
      at: Date
    }>,
  ) => Promise<number>
}>
