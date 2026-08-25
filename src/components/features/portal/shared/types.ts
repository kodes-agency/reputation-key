// Shared types for portal feature components.
// Extracted from portal-detail-page, portal-settings, and edit-portal-form
// to eliminate duplication and ensure consistency.

export type FormLike = {
  handleSubmit: () => void
  /**
   * Value-based (not touched-based) so it flips back to false once the user
   * undoes every edit. Read lazily from a ref by the route-level unsaved-changes
   * blocker, which only needs the answer at navigation time.
   */
  hasUnsavedChanges: () => boolean
}

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
}>

export type UpdatePortalVariables = {
  data: {
    portalId: string
    name?: string
    slug?: string
    description?: string | null
    heroImageUrl?: string | null
    theme?: PortalThemeDraft
    privateFeedbackThreshold?: number
    publicationState?: PortalPublicationState
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
