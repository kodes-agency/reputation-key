// Portal context — the health interval and locale-set fact every Portal command
// records. Creating and updating a Portal derive them here, so the two agree.

import { portalLocaleSetUpdated } from '../domain/events'
import { derivePortalHealth } from '../domain/portal-health'
import type { PortalHealth } from '../domain/portal-health'
import type { PortalPublicationState } from '../domain/portal-publication'
import type { Portal } from '../domain/types'

export type PortalHealthFact = Readonly<{
  id: string
  value: PortalHealth
  sourceVersion: string
  effectiveAt: Date
  observedAt: Date
}>

/**
 * A published Portal reaching this point has its snapshot, address and verified
 * destination (publishing pins them); the manager is the only open question.
 */
export function buildPortalHealthFact(
  input: Readonly<{
    id: string
    publicationState: PortalPublicationState
    hasResponsibleManager: boolean
    sourceVersion: string
    at: Date
  }>,
): PortalHealthFact {
  const isPublished = input.publicationState === 'published'
  return {
    id: input.id,
    value: derivePortalHealth({
      publicationState: input.publicationState,
      propertyAvailable: true,
      hasActivePublicationSnapshot: isPublished,
      hasResolvablePublicAddress: isPublished,
      hasResponsibleManager: input.hasResponsibleManager,
      googleDestinationState: isPublished ? 'verified' : 'unavailable',
    }),
    sourceVersion: input.sourceVersion,
    effectiveAt: input.at,
    observedAt: input.at,
  }
}

type GuestLocales = Pick<Portal, 'primaryGuestLocale' | 'additionalGuestLocales'>

export function guestLocalesChanged(before: GuestLocales, after: GuestLocales): boolean {
  return (
    before.primaryGuestLocale !== after.primaryGuestLocale ||
    JSON.stringify(before.additionalGuestLocales) !==
      JSON.stringify(after.additionalGuestLocales)
  )
}

/** The locale-set fact, only when the Portal's guest languages actually changed. */
export function buildLocaleSetFact(
  before: Pick<Portal, 'id' | 'organizationId' | 'propertyId'> & GuestLocales,
  after: GuestLocales,
  revision: Date,
  occurredAt: Date,
) {
  if (!guestLocalesChanged(before, after)) return undefined
  return portalLocaleSetUpdated({
    portalId: before.id,
    organizationId: before.organizationId,
    propertyId: before.propertyId,
    primaryGuestLocale: after.primaryGuestLocale,
    additionalGuestLocales: after.additionalGuestLocales,
    sourceAggregateVersion: revision.toISOString(),
    occurredAt,
  })
}
