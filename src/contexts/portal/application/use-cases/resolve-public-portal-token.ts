import { createHash } from 'node:crypto'
import { organizationId, propertyId } from '#/shared/domain/ids'
import type { PublicPortalResult } from '../public-api'
import type { PortalTokenCodec } from '../ports/portal-token-codec.port'
import { canonicalizeRfc8785 } from '#/shared/canonical-json'
import type { PortalPublicationRepository } from '../ports/portal-publication.repository'

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
  portalPublicationRepo: Pick<PortalPublicationRepository, 'resolveActiveByTokenDigest'>
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
    const resolved = await deps.portalPublicationRepo.resolveActiveByTokenDigest(
      digest,
      now,
    )
    if (!resolved) return { status: 'unavailable' }
    const { token, snapshot } = resolved
    if (
      snapshot.organizationId !== token.organizationId ||
      snapshot.propertyId !== token.propertyId ||
      snapshot.portalId !== token.portalId
    ) {
      return { status: 'unavailable' }
    }

    const decision = await deps.decidePublic({
      action: 'portal.public_read',
      capability: 'portal.public_read',
      organizationId: token.organizationId,
      propertyId: token.propertyId,
      now,
    })
    if (!decision.allowed) return { status: 'unavailable' }

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
    const destinationMatchesSnapshot =
      destination?.state === 'verified' &&
      destination.uri === snapshot.destinationUri &&
      destination.retrievedAt?.getTime() === snapshot.destinationRetrievedAt.getTime() &&
      destination.sourceEpoch === snapshot.destinationSourceEpoch &&
      destination.profileVersion === snapshot.destinationProfileVersion
    const googleReview = destinationMatchesSnapshot
      ? ({ status: 'available', uri: snapshot.destinationUri } as const)
      : ({ status: 'unavailable' } as const)

    const configuration = snapshot.configuration
    const reviewGateway = {
      privateFeedbackThreshold: configuration.reviewGateway.privateFeedbackThreshold,
      googleReview,
    }
    const exactResolvedConfiguration = {
      schemaVersion: configuration.schemaVersion,
      publicationSnapshotId: snapshot.id,
      publicationVersion: snapshot.version,
      publicationDigest: snapshot.configurationDigest,
      guestLocale: configuration.guestLocale,
      languagePackVersion: configuration.languagePackVersion,
      portal: configuration.portal,
      categories: configuration.categories,
      links: configuration.links,
      reviewGateway,
    }
    const responseConfiguration = {
      publicationState: 'published' as const,
      publicationSnapshotId: snapshot.id,
      publicationVersion: snapshot.version,
      publicationDigest: snapshot.configurationDigest,
      configurationDigest: configurationDigest(exactResolvedConfiguration),
      guestLocale: configuration.guestLocale,
      languagePackVersion: configuration.languagePackVersion,
      privateFeedbackThreshold: configuration.reviewGateway.privateFeedbackThreshold,
    }
    return {
      status: 'found',
      data: {
        portal: configuration.portal,
        categories: configuration.categories,
        links: configuration.links,
        reviewGateway,
        responseConfiguration,
        organizationId: snapshot.organizationId,
        propertyId: snapshot.propertyId,
      },
    }
  }

export type ResolvePublicPortalToken = ReturnType<typeof resolvePublicPortalToken>
