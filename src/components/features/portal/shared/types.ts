// Shared types for portal feature components.
// Extracted from portal-detail-page and the portal editor sections to eliminate
// duplication and ensure consistency.

import type { GuestLocale, OfferedGuestLocale } from '#/shared/domain/guest-locale'

export type PortalPublicationState = 'draft' | 'published' | 'disabled' | 'archived'

/**
 * The manager-editable theme. All three colours are strict 6-digit hex — the
 * server rejects anything else (`validatePortalTheme`, portal/domain/rules.ts).
 * Background and text are optional because portals created before theming was
 * exposed only ever stored a primary colour.
 */
export type PortalThemeDraft = Readonly<{
  primaryColor: string
  backgroundColor?: string
  textColor?: string
}>

export type PortalData = Readonly<{
  id: string
  name: string
  slug: string
  description: string | null
  heroImageUrl: string | null
  theme: PortalThemeDraft
  privateFeedbackThreshold: number
  publicationState: PortalPublicationState
  primaryGuestLocale?: GuestLocale
  additionalGuestLocales?: readonly GuestLocale[]
}>

export type UpdatePortalVariables = {
  data: {
    portalId: string
    name?: string
    slug?: string
    description?: string | null
    heroImageUrl?: null
    theme?: PortalThemeDraft
    privateFeedbackThreshold?: number
    publicationState?: PortalPublicationState
    primaryGuestLocale?: OfferedGuestLocale
    additionalGuestLocales?: OfferedGuestLocale[]
  }
}

/**
 * Governed Portal workflow fact: the only producer of
 * `portal.content_review.completed`, `portal.configuration_completeness` and
 * `portal.approved_destination_ratio`. `reviewId` is the manager-visible
 * idempotency key; `revision` is 1 for an initial review (corrections need the
 * superseded fact ids, which no UI surface can supply yet).
 */
export type CompleteReviewVariables = {
  data: { portalId: string; reviewId: string; revision: number }
}

export type CompleteReviewResult = { status: 'recorded' | 'duplicate' }
