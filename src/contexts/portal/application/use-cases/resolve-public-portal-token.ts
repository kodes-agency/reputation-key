import { createHash } from 'node:crypto'
import { organizationId, portalId, propertyId } from '#/shared/domain/ids'
import type { PublicPortalResult } from '../public-api'
import type { PortalTokenCodec } from '../ports/portal-token-codec.port'
import { canonicalizeRfc8785 } from '#/shared/canonical-json'
import type { PortalPublicationRepository } from '../ports/portal-publication.repository'
import type { PortalHealthRepository } from '../ports/portal-health.repository'
import { selectPortalGuestLocale } from '../../domain/portal-experience'

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

// Revalidation is scheduled every 15 minutes. Two intervals allow one delayed
// run without keeping an indefinitely stale approval live at the public edge.
const SECONDARY_DESTINATION_MAX_VALIDATION_AGE_MS = 30 * 60 * 1_000

export type ResolvePublicPortalTokenDeps = Readonly<{
  tokenCodec: Pick<PortalTokenCodec, 'digest'>
  portalPublicationRepo: Pick<PortalPublicationRepository, 'resolveActiveByTokenDigest'>
  portalHealthRepo: Pick<PortalHealthRepository, 'getCurrent'>
  listApprovedSecondaryDestinationUris: (
    organizationId: import('#/shared/domain/ids').OrganizationId,
    propertyId: import('#/shared/domain/ids').PropertyId,
    uris: readonly string[],
    validatedAfter: Date,
  ) => Promise<readonly string[]>
  isPropertyActive: import('#/contexts/property/application/public-api').PropertyLifecyclePublicApi['isPropertyActive']
  getGoogleReviewDestination: import('#/contexts/property/application/public-api').PropertyGoogleReviewDestinationPublicApi['getGoogleReviewDestination']
  decidePublic: (
    request: PublicPortalDecisionRequest,
  ) => Promise<PublicPortalExecutionDecision>
  reportGoogleDestinationFailure?: (error: unknown) => void
  clock: () => Date
}>

export const resolvePublicPortalToken =
  (deps: ResolvePublicPortalTokenDeps) =>
  async (
    rawToken: string,
    preference: Readonly<{
      requestedLocale?: string | null
      sessionLocale?: string | null
      acceptLanguage?: string | null
    }> = {},
  ): Promise<ResolvePublicPortalTokenOutcome> => {
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

    // Portal Health is durable/eventually reconciled. The owning Property's
    // current lifecycle is also checked at request time so Archive closes the
    // public gateway immediately rather than waiting for the consumer lag.
    try {
      if (
        !(await deps.isPropertyActive(
          organizationId(token.organizationId),
          propertyId(token.propertyId),
        ))
      ) {
        return { status: 'unavailable' }
      }
    } catch {
      return { status: 'unavailable' }
    }

    // Schema-v2 publications are created only after Portal Health became part
    // of the public contract. Fail closed when that durable current posture is
    // missing or explicitly unavailable. Legacy v1 snapshots remain readable
    // so existing printed addresses survive the rolling upgrade.
    if (snapshot.configuration.schemaVersion === 2) {
      const health = await deps.portalHealthRepo.getCurrent(
        organizationId(token.organizationId),
        propertyId(token.propertyId),
        portalId(token.portalId),
      )
      if (!health || health.status === 'unavailable') {
        return { status: 'unavailable' }
      }
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
    let links: typeof configuration.links = []
    if (configuration.links.length > 0) {
      try {
        const approvedUris = new Set(
          await deps.listApprovedSecondaryDestinationUris(
            organizationId(token.organizationId),
            propertyId(token.propertyId),
            configuration.links.map((link) => link.url),
            new Date(now.getTime() - SECONDARY_DESTINATION_MAX_VALIDATION_AGE_MS),
          ),
        )
        links = configuration.links.filter((link) => approvedUris.has(link.url))
      } catch {
        // Secondary navigation fails closed independently. The private review
        // gateway remains useful while the approval authority recovers.
      }
    }
    const selectedLocale =
      configuration.schemaVersion === 2
        ? selectPortalGuestLocale(
            configuration.localeSet,
            configuration.guestLocale,
            preference.requestedLocale,
            preference.sessionLocale,
            preference.acceptLanguage,
          )
        : 'en'
    const selectedContent =
      configuration.schemaVersion === 2
        ? configuration.localizedContent[selectedLocale]
        : undefined
    if (configuration.schemaVersion === 2 && !selectedContent) {
      return { status: 'unavailable' }
    }
    const localizedPortal =
      configuration.schemaVersion === 2 && selectedContent
        ? {
            ...configuration.portal,
            name: selectedContent.title,
            description: selectedContent.shortDescription,
            heroImageUrl: selectedContent.heroImageUrl,
            organizationName: configuration.brandProfile.displayName,
            logoUrl: configuration.brandProfile.logoUrl,
            theme: {
              ...configuration.portal.theme,
              primaryColor: configuration.brandProfile.primaryColor,
              backgroundColor: configuration.brandProfile.backgroundColor,
              textColor: configuration.brandProfile.textColor,
            },
          }
        : configuration.portal
    const languagePackCandidate =
      configuration.schemaVersion === 2
        ? configuration.languagePackVersions[selectedLocale]
        : configuration.languagePackVersion
    if (
      languagePackCandidate !== 'guest-ui-en-v1' &&
      languagePackCandidate !== 'guest-ui-bg-v1'
    ) {
      return { status: 'unavailable' }
    }
    const languagePackVersion = languagePackCandidate
    const reviewGateway = {
      privateFeedbackThreshold: configuration.reviewGateway.privateFeedbackThreshold,
      googleReview,
    }
    const exactResolvedConfiguration = {
      schemaVersion: configuration.schemaVersion,
      publicationSnapshotId: snapshot.id,
      publicationVersion: snapshot.version,
      publicationDigest: snapshot.configurationDigest,
      guestLocale: selectedLocale,
      languagePackVersion,
      portal: localizedPortal,
      categories: configuration.categories,
      links,
      reviewGateway,
    }
    const responseConfiguration = {
      publicationState: 'published' as const,
      publicationSnapshotId: snapshot.id,
      publicationVersion: snapshot.version,
      publicationDigest: snapshot.configurationDigest,
      configurationDigest: configurationDigest(exactResolvedConfiguration),
      guestLocale: selectedLocale,
      languagePackVersion,
      privateFeedbackThreshold: configuration.reviewGateway.privateFeedbackThreshold,
    }
    return {
      status: 'found',
      data: {
        portal: localizedPortal,
        categories: configuration.categories,
        links,
        reviewGateway,
        localization: {
          selectedLocale,
          primaryLocale: configuration.guestLocale,
          availableLocales:
            configuration.schemaVersion === 2 ? configuration.localeSet : ['en'],
          languagePackVersion,
        },
        responseConfiguration,
        organizationId: snapshot.organizationId,
        propertyId: snapshot.propertyId,
      },
    }
  }

export type ResolvePublicPortalToken = ReturnType<typeof resolvePublicPortalToken>
