import { createHash } from 'node:crypto'
import {
  organizationId,
  propertyId,
  portalId,
  type OrganizationId,
  type PortalId,
} from '#/shared/domain/ids'
import type { PublicPortalRepositoryResult } from '../ports/portal.repository'
import type { PublicPortalResult } from '../public-api'
import type { PortalTokenRepository } from '../ports/portal-token.repository'
import type { PortalTokenCodec } from '../ports/portal-token-codec.port'
import { isPortalError } from '../../domain/errors'
import { canonicalizeRfc8785 } from '#/shared/canonical-json'

const GUEST_LOCALE = 'en'
const GUEST_LANGUAGE_PACK_VERSION = 'guest-ui-en-v1'

function configurationDigest(value: unknown): string {
  return createHash('sha256').update(canonicalizeRfc8785(value), 'utf8').digest('hex')
}

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
    ) => Promise<PublicPortalRepositoryResult | null>
  }>
  getGoogleReviewDestination: import('#/contexts/property/application/public-api').PropertyGoogleReviewDestinationPublicApi['getGoogleReviewDestination']
  decidePublic: (
    request: PublicPortalDecisionRequest,
  ) => Promise<PublicPortalExecutionDecision>
  reportGoogleDestinationFailure?: (error: unknown) => void
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

    let data: PublicPortalRepositoryResult | null
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

    let destination: Awaited<ReturnType<typeof deps.getGoogleReviewDestination>> = null
    try {
      destination = await deps.getGoogleReviewDestination(
        organizationId(token.organizationId),
        propertyId(token.propertyId),
      )
    } catch (error) {
      // Keep the private gateway available, but never fall back to a raw Portal
      // link or leak the last-known/stale Property destination.
      deps.reportGoogleDestinationFailure?.(error)
    }
    const googleReview =
      destination?.state === 'verified' && destination.uri !== null
        ? ({ status: 'available', uri: destination.uri } as const)
        : ({ status: 'unavailable' } as const)

    const { privateFeedbackThreshold, ...publicData } = data
    const reviewGateway = {
      privateFeedbackThreshold,
      googleReview,
    }
    const responseConfiguration = {
      publicationState: 'published' as const,
      configurationDigest: configurationDigest({
        schemaVersion: 1,
        guestLocale: GUEST_LOCALE,
        languagePackVersion: GUEST_LANGUAGE_PACK_VERSION,
        portal: publicData.portal,
        categories: publicData.categories,
        links: publicData.links,
        reviewGateway,
      }),
      guestLocale: GUEST_LOCALE,
      languagePackVersion: GUEST_LANGUAGE_PACK_VERSION,
      privateFeedbackThreshold,
    }
    return {
      status: 'found',
      data: {
        ...publicData,
        reviewGateway,
        responseConfiguration,
      },
    }
  }

export type ResolvePublicPortalToken = ReturnType<typeof resolvePublicPortalToken>
