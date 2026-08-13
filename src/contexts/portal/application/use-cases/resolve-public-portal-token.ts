import {
  organizationId,
  portalId,
  type OrganizationId,
  type PortalId,
} from '#/shared/domain/ids'
import type { PublicPortalResult } from '../ports/portal.repository'
import type { PortalTokenRepository } from '../ports/portal-token.repository'
import type { PortalTokenCodec } from '../ports/portal-token-codec.port'
import { isPortalError } from '../../domain/errors'

export type ResolvePublicPortalTokenOutcome =
  | Readonly<{ status: 'found'; data: PublicPortalResult }>
  | Readonly<{ status: 'unavailable' }>
type PublicPortalDecisionRequest = Readonly<{
  action: 'portal.public_read'
  capability: 'portal.public_read'
  organizationId: string
  propertyId: string
  now: Date
}>

type PublicPortalExecutionDecision = Readonly<{ allowed: boolean }>

export type ResolvePublicPortalTokenDeps = Readonly<{
  tokenCodec: Pick<PortalTokenCodec, 'digest'>
  portalTokenRepo: Pick<PortalTokenRepository, 'findResolvableByDigest'>
  portalRepo: Readonly<{
    findPublicPortalById: (
      organizationId: OrganizationId,
      portalId: PortalId,
    ) => Promise<PublicPortalResult | null>
  }>
  decidePublic: (
    request: PublicPortalDecisionRequest,
  ) => Promise<PublicPortalExecutionDecision>
  clock: () => Date
}>

export const resolvePublicPortalToken =
  (deps: ResolvePublicPortalTokenDeps) =>
  async (rawToken: string): Promise<ResolvePublicPortalTokenOutcome> => {
    const digest = deps.tokenCodec.digest(rawToken)
    if (!digest) return { status: 'unavailable' }

    const now = deps.clock()
    const token = await deps.portalTokenRepo.findResolvableByDigest(digest, now)
    if (!token) return { status: 'unavailable' }

    const decision = await deps.decidePublic({
      action: 'portal.public_read',
      capability: 'portal.public_read',
      organizationId: token.organizationId,
      propertyId: token.propertyId,
      now,
    })
    if (!decision.allowed) return { status: 'unavailable' }

    let data: PublicPortalResult | null
    try {
      data = await deps.portalRepo.findPublicPortalById(
        organizationId(token.organizationId),
        portalId(token.portalId),
      )
    } catch (error) {
      if (isPortalError(error) && error.code === 'portal_inactive') {
        return { status: 'unavailable' }
      }
      throw error
    }
    if (
      !data ||
      data.organizationId !== token.organizationId ||
      data.propertyId !== token.propertyId
    ) {
      return { status: 'unavailable' }
    }

    return { status: 'found', data }
  }

export type ResolvePublicPortalToken = ReturnType<typeof resolvePublicPortalToken>
