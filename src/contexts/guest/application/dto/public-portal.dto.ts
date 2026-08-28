import type { GuestResponseView } from '../use-cases/guest-response-lifecycle'
import type { PublicPortalResult } from '#/contexts/portal/application/public-api'

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
  response: GuestResponseView | null
  responseForm: {
    availability: GuestResponseFormAvailability
  }
}

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
}> &
  PublicPortalLoaderState

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
    ...state,
  }
}
