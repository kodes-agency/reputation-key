import type { GuestResponseView } from '../use-cases/guest-response-lifecycle'

// F066: Re-export ScanSource from domain/types instead of duplicating the union
export type { ScanSource } from '../../domain/types'

export type PublicPortalData = {
  portal: {
    id: string
    name: string
    slug: string
    description: string | null
    heroImageUrl: string | null
    theme: Record<string, string | number | boolean | null> | null
    organizationName: string
  }
  categories: ReadonlyArray<{ id: string; title: string; sortKey: string }>
  links: ReadonlyArray<{
    id: string
    label: string
    url: string
    categoryId: string | null
    sortKey: string
  }>
  organizationId: string
  propertyId: string
}

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
    mediaEnabled: boolean
  }
}

export type PublicPortalLoaderData = Pick<
  PublicPortalData,
  'portal' | 'categories' | 'links'
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
    ...state,
  }
}
