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

export type PublicPortalLoaderData = Pick<
  PublicPortalData,
  'portal' | 'categories' | 'links' | 'reviewGateway'
> &
  PublicPortalLoaderState

/** Explicit public allowlist: internal Organization/Property IDs stay server-side. */
export function toPublicPortalLoaderData(
  portal: PublicPortalData,
  state: PublicPortalLoaderState,
): PublicPortalLoaderData {
  return {
    portal: portal.portal,
    categories: portal.categories,
    links: portal.links,
    reviewGateway: portal.reviewGateway,
    ...state,
  }
}
