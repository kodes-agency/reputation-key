import type { GuestResponseView } from '../use-cases/guest-response-lifecycle'
import type { PublicPortalResult } from '#/contexts/portal/application/public-api'
import { fontSetForGuestSurface, type FontSet } from '#/shared/font-sets'

// F066: Re-export ScanSource from domain/types instead of duplicating the union
export type { ScanSource } from '../../domain/types'

export type PublicPortalData = PublicPortalResult

/**
 * Guest capability decisions resolved for the portal's org/property scope.
 * The form needs them BEFORE rendering: without them it invited a response
 * (and an image) the tenant could not accept, and the denial surfaced only
 * afterwards as a generic save failure.
 *
 * `unavailable` is the transient tenant state (suspension / unresolvable
 * policy) — retryable; `permission_denied` is the configuration answer.
 */
export type GuestResponseFormAvailability =
  'available' | 'permission_denied' | 'unavailable'

export type PublicPortalLoaderState = {
  guestSession: { csrfNonce: string }
  /**
   * The instant the server read the page (ISO 8601). The Immersive Hub writes
   * its deadlines ("Until 15:32 today") against it instead of each side's own
   * clock, so the server render and the browser print the same text.
   */
  servedAt: string
  response: GuestResponseView | null
  responseForm: {
    availability: GuestResponseFormAvailability
  }
}

/** The Immersive Hub content the browser receives: no link destination, asset id or provenance. */
export type PublicImmersiveLoaderData = Readonly<{
  timeZone: string
  brand: NonNullable<PublicPortalData['immersive']>['brand']
  content: NonNullable<PublicPortalData['immersive']>['content']
  linktree: NonNullable<PublicPortalData['immersive']>['linktree']
  links: NonNullable<PublicPortalData['immersive']>['links']
}>

export type PublicPortalLoaderData = Readonly<{
  portal: Pick<
    PublicPortalData['portal'],
    'name' | 'description' | 'heroImageUrl' | 'theme' | 'logoUrl' | 'organizationName'
  >
  categories: ReadonlyArray<Pick<PublicPortalData['categories'][number], 'id' | 'title'>>
  links: ReadonlyArray<
    Pick<PublicPortalData['links'][number], 'id' | 'label' | 'categoryId'>
  >
  reviewGateway: Readonly<{
    privateFeedbackThreshold: number
    googleReview: Readonly<{
      status: PublicPortalData['reviewGateway']['googleReview']['status']
    }>
  }>
  localization: PublicPortalData['localization']
  /**
   * What the Immersive Hub renders, for a schema version 3 portal and null
   * otherwise. Destinations, asset ids and provenance never appear in it.
   */
  immersive: PublicImmersiveLoaderData | null
  /**
   * The web fonts the page loads. The root document reads it from the loader
   * data to link the right stylesheets: 'guest' only for a portal on the
   * Immersive Hub surface (snapshot schema v3), so every portal live today
   * keeps the app fonts.
   */
  fontSet: FontSet
}> &
  PublicPortalLoaderState

/** Field by field, so a field added to the server result never reaches the browser unreviewed. */
function toPublicImmersiveLoaderData(
  immersive: NonNullable<PublicPortalData['immersive']>,
): PublicImmersiveLoaderData {
  const { brand, content, linktree } = immersive
  return {
    timeZone: immersive.timeZone,
    brand: {
      displayName: brand.displayName,
      wordmark: brand.wordmark,
      logo: brand.logo && {
        url: brand.logo.url,
        width: brand.logo.width,
        height: brand.logo.height,
      },
      hero: brand.hero && {
        url: brand.hero.url,
        width: brand.hero.width,
        height: brand.hero.height,
        focalX: brand.hero.focalX,
        focalY: brand.hero.focalY,
      },
      accentColour: brand.accentColour,
      fieldColour: brand.fieldColour,
    },
    content: {
      title: { value: content.title.value, fallbackFrom: content.title.fallbackFrom },
      shortDescription: {
        value: content.shortDescription.value,
        fallbackFrom: content.shortDescription.fallbackFrom,
      },
      heroAlt: {
        value: content.heroAlt.value,
        fallbackFrom: content.heroAlt.fallbackFrom,
      },
      linktreeTitle: {
        value: content.linktreeTitle.value,
        fallbackFrom: content.linktreeTitle.fallbackFrom,
      },
    },
    linktree: { enabled: linktree.enabled },
    links: immersive.links.map((link) => ({
      id: link.id,
      iconKey: link.iconKey,
      imageUrl: link.imageUrl,
      label: link.label,
      line: link.line,
      fallbackFrom: link.fallbackFrom,
    })),
  }
}

/** Explicit public allowlist: internal Organization/Property IDs stay server-side. */
export function toPublicPortalLoaderData(
  portal: PublicPortalData,
  state: PublicPortalLoaderState,
): PublicPortalLoaderData {
  return {
    portal: {
      name: portal.portal.name,
      description: portal.portal.description,
      heroImageUrl: portal.portal.heroImageUrl,
      theme: portal.portal.theme,
      logoUrl: portal.portal.logoUrl,
      organizationName: portal.portal.organizationName,
    },
    categories: portal.categories.map(({ id, title }) => ({ id, title })),
    links: portal.links.map(({ id, label, categoryId }) => ({
      id,
      label,
      categoryId,
    })),
    reviewGateway: {
      privateFeedbackThreshold: portal.reviewGateway.privateFeedbackThreshold,
      googleReview: { status: portal.reviewGateway.googleReview.status },
    },
    localization: {
      selectedLocale: portal.localization.selectedLocale,
      primaryLocale: portal.localization.primaryLocale,
      availableLocales: portal.localization.availableLocales,
      languagePackVersion: portal.localization.languagePackVersion,
    },
    immersive: portal.immersive && toPublicImmersiveLoaderData(portal.immersive),
    fontSet: fontSetForGuestSurface(portal.guestSurface),
    ...state,
  }
}
