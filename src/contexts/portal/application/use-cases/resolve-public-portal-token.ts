import { createHash } from 'node:crypto'
import { organizationId, portalId, propertyId } from '#/shared/domain/ids'
import {
  isSupportedGuestLanguagePack,
  type GuestLanguagePackVersion,
} from '#/shared/domain/guest-locale'
import type {
  PublicGoogleReviewDestination,
  PublicImmersiveExperience,
  PublicPortalResult,
} from '../public-api'
import {
  immersiveAssetIds,
  presentImmersivePortal,
  type ServableMediaUrls,
} from '../public-portal-immersive'
import type {
  PortalTokenCodec,
  PortalTokenDigest,
} from '../ports/portal-token-codec.port'
import { canonicalizeRfc8785 } from '#/shared/canonical-json'
import type {
  PortalPublicationRepository,
  ResolvedPortalPublication,
} from '../ports/portal-publication.repository'
import type { PortalHealthRepository } from '../ports/portal-health.repository'
import {
  guestSurfaceOfConfiguration,
  isLocalizedConfiguration,
  languagePackGenerationOf,
  type ImmersivePortalPublicationConfiguration,
  type PortalGuestLocale,
  type PortalPublicationConfiguration,
  type PortalPublicationSnapshot,
} from '../../domain/portal-publication-snapshot'
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
  /**
   * Serving a Portal with no destinations is a visible degradation, and it is
   * indistinguishable from a Portal that legitimately has none. Without this,
   * the fail-closed empty list below is silent.
   */
  reportApprovedDestinationFailure?: (error: unknown) => void
  /**
   * The URL of each Portal media asset that may be served right now, by asset
   * id; an asset left out (taken down, unknown) is not served. Absent until
   * Portal media exists, which serves nothing: a v3 page then shows its no-photo
   * look.
   */
  resolvePortalMediaUrls?: (
    organizationId: import('#/shared/domain/ids').OrganizationId,
    propertyId: import('#/shared/domain/ids').PropertyId,
    assetIds: readonly string[],
  ) => Promise<ServableMediaUrls>
  /** Fired when the media lookup fails: the page degrades to no media instead of failing. */
  reportPortalMediaFailure?: (error: unknown) => void
  /** Fired when approval filtering removes destinations the snapshot published. */
  reportApprovedDestinationsDropped?: (
    counts: Readonly<{ published: number; served: number }>,
  ) => void
  clock: () => Date
}>

export type GuestLocalePreference = Readonly<{
  requestedLocale?: string | null
  sessionLocale?: string | null
  acceptLanguage?: string | null
}>

/**
 * Every public-edge admission gate behind the token digest, in order. Returns
 * null whenever the Portal must stay closed, so the caller never has to
 * distinguish the reasons.
 */
async function admitPublicPortalRequest(
  deps: ResolvePublicPortalTokenDeps,
  digest: PortalTokenDigest,
  now: Date,
): Promise<ResolvedPortalPublication | null> {
  const resolved = await deps.portalPublicationRepo.resolveActiveByTokenDigest(
    digest,
    now,
  )
  if (!resolved) return null
  const { token, snapshot } = resolved
  if (
    snapshot.organizationId !== token.organizationId ||
    snapshot.propertyId !== token.propertyId ||
    snapshot.portalId !== token.portalId
  ) {
    return null
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
      return null
    }
  } catch {
    return null
  }

  // Localized publications (schema v2 and later) are created only after
  // Portal Health became part of the public contract. Fail closed when that
  // durable current posture is missing or explicitly unavailable. Legacy v1
  // snapshots remain readable so existing printed addresses survive the
  // rolling upgrade.
  if (isLocalizedConfiguration(snapshot.configuration)) {
    const health = await deps.portalHealthRepo.getCurrent(
      organizationId(token.organizationId),
      propertyId(token.propertyId),
      portalId(token.portalId),
    )
    if (!health || health.status === 'unavailable') return null
  }

  const decision = await deps.decidePublic({
    action: 'portal.public_read',
    capability: 'portal.public_read',
    organizationId: token.organizationId,
    propertyId: token.propertyId,
    now,
  })
  if (!decision.allowed) return null
  return resolved
}

/** The gateway opens only while the live Property destination still matches the snapshot. */
async function resolveGoogleReviewGateway(
  deps: ResolvePublicPortalTokenDeps,
  token: ResolvedPortalPublication['token'],
  snapshot: PortalPublicationSnapshot,
): Promise<PublicGoogleReviewDestination> {
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
  return destinationMatchesSnapshot
    ? { status: 'available', uri: snapshot.destinationUri }
    : { status: 'unavailable' }
}

/**
 * Secondary navigation fails closed on its own: an unreachable approval
 * authority drops the links but leaves the private review gateway useful.
 */
async function resolveApprovedLinks<L extends Readonly<{ url: string }>>(
  deps: ResolvePublicPortalTokenDeps,
  token: ResolvedPortalPublication['token'],
  links: readonly L[],
  now: Date,
): Promise<readonly L[]> {
  if (links.length === 0) return []
  try {
    const approvedUris = new Set(
      await deps.listApprovedSecondaryDestinationUris(
        organizationId(token.organizationId),
        propertyId(token.propertyId),
        links.map((link) => link.url),
        new Date(now.getTime() - SECONDARY_DESTINATION_MAX_VALIDATION_AGE_MS),
      ),
    )
    const approved = links.filter((link) => approvedUris.has(link.url))
    if (approved.length < links.length) {
      // Not an error — an approval can legitimately lapse — but a published
      // destination disappearing from a live Portal is invisible to the guest
      // and to the operator, so it is worth saying out loud.
      deps.reportApprovedDestinationsDropped?.({
        published: links.length,
        served: approved.length,
      })
    }
    return approved
  } catch (error) {
    deps.reportApprovedDestinationFailure?.(error)
    return []
  }
}

/**
 * Media URLs are looked up per read, so a takedown reaches a snapshot that can
 * never change. A failing lookup serves no media rather than failing the page.
 */
async function resolveMediaUrls(
  deps: ResolvePublicPortalTokenDeps,
  token: ResolvedPortalPublication['token'],
  configuration: ImmersivePortalPublicationConfiguration,
): Promise<ServableMediaUrls> {
  const assetIds = immersiveAssetIds(configuration)
  if (assetIds.length === 0 || !deps.resolvePortalMediaUrls) return {}
  try {
    return await deps.resolvePortalMediaUrls(
      organizationId(token.organizationId),
      propertyId(token.propertyId),
      assetIds,
    )
  } catch (error) {
    deps.reportPortalMediaFailure?.(error)
    return {}
  }
}

type PortalPresentation = Readonly<{
  selectedLocale: PortalGuestLocale
  languagePackVersion: GuestLanguagePackVersion
}>

/**
 * Picks the guest locale and the exact copy pack the snapshot published for
 * it, from the pack generation its schema version allows. Returns null when the
 * snapshot cannot serve that locale, which fails the whole request closed.
 */
function selectPresentation(
  configuration: PortalPublicationConfiguration,
  preference: GuestLocalePreference,
): PortalPresentation | null {
  const generation = languagePackGenerationOf(configuration.schemaVersion)
  if (!isLocalizedConfiguration(configuration)) {
    // Legacy v1: English only, and only the English v1 pack.
    const languagePackVersion = configuration.languagePackVersion
    if (!isSupportedGuestLanguagePack('en', languagePackVersion, generation)) return null
    return { selectedLocale: 'en', languagePackVersion }
  }
  const selectedLocale = selectPortalGuestLocale(
    configuration.localeSet,
    configuration.guestLocale,
    preference.requestedLocale,
    preference.sessionLocale,
    preference.acceptLanguage,
  )
  const languagePackVersion = configuration.languagePackVersions[selectedLocale]
  if (!isSupportedGuestLanguagePack(selectedLocale, languagePackVersion, generation)) {
    return null
  }
  return { selectedLocale, languagePackVersion }
}

type ServedContent = Readonly<{
  portal: PublicPortalResult['portal']
  links: PublicPortalResult['links']
  categories: PublicPortalResult['categories']
  immersive: PublicImmersiveExperience | null
}>

/** The schema version 1 and 2 content: one legacy page, branded from the brand profile. */
function legacyContent(
  configuration: Exclude<
    PortalPublicationConfiguration,
    ImmersivePortalPublicationConfiguration
  >,
  selectedLocale: PortalGuestLocale,
  links: PublicPortalResult['links'],
): ServedContent | null {
  if (!isLocalizedConfiguration(configuration)) {
    return {
      portal: configuration.portal,
      links,
      categories: configuration.categories,
      immersive: null,
    }
  }
  const selectedContent = configuration.localizedContent[selectedLocale]
  if (!selectedContent) return null
  return {
    portal: {
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
    },
    links,
    categories: configuration.categories,
    immersive: null,
  }
}

/** What the page shows for the selected locale, from whichever schema version published it. */
async function resolveServedContent(
  deps: ResolvePublicPortalTokenDeps,
  token: ResolvedPortalPublication['token'],
  configuration: PortalPublicationConfiguration,
  selectedLocale: PortalGuestLocale,
  now: Date,
): Promise<ServedContent | null> {
  if (configuration.schemaVersion !== 3) {
    const links = await resolveApprovedLinks(deps, token, configuration.links, now)
    return legacyContent(configuration, selectedLocale, links)
  }
  const [approvedLinks, mediaUrls] = await Promise.all([
    resolveApprovedLinks(deps, token, configuration.links, now),
    resolveMediaUrls(deps, token, configuration),
  ])
  const presented = presentImmersivePortal(
    configuration,
    selectedLocale,
    approvedLinks,
    mediaUrls,
  )
  return presented && { ...presented, categories: [] }
}

export const resolvePublicPortalToken =
  (deps: ResolvePublicPortalTokenDeps) =>
  async (
    rawToken: string,
    preference: GuestLocalePreference = {},
  ): Promise<ResolvePublicPortalTokenOutcome> => {
    const digest = deps.tokenCodec.digest(rawToken)
    if (!digest) return { status: 'unavailable' }

    const now = deps.clock()
    const resolved = await admitPublicPortalRequest(deps, digest, now)
    if (!resolved) return { status: 'unavailable' }
    const { token, snapshot } = resolved
    const configuration = snapshot.configuration

    const googleReview = await resolveGoogleReviewGateway(deps, token, snapshot)
    const presentation = selectPresentation(configuration, preference)
    if (!presentation) return { status: 'unavailable' }
    const { selectedLocale, languagePackVersion } = presentation
    const served = await resolveServedContent(
      deps,
      token,
      configuration,
      selectedLocale,
      now,
    )
    if (!served) return { status: 'unavailable' }
    const { portal: localizedPortal, links, categories, immersive } = served

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
      categories,
      links,
      reviewGateway,
      // Only a v3 publication has one, so every v1 and v2 digest is unchanged.
      ...(immersive ? { immersive } : {}),
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
        categories,
        links,
        reviewGateway,
        localization: {
          selectedLocale,
          primaryLocale: configuration.guestLocale,
          availableLocales: isLocalizedConfiguration(configuration)
            ? configuration.localeSet
            : ['en'],
          languagePackVersion,
        },
        responseConfiguration,
        guestSurface: guestSurfaceOfConfiguration(configuration),
        immersive,
        organizationId: snapshot.organizationId,
        propertyId: snapshot.propertyId,
      },
    }
  }

export type ResolvePublicPortalToken = ReturnType<typeof resolvePublicPortalToken>
