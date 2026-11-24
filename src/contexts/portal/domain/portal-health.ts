import type { OrganizationId, PortalId, PropertyId } from '#/shared/domain/ids'
import type { PortalPublicationState } from './portal-publication'

export const PORTAL_HEALTH_STATUSES = ['healthy', 'degraded', 'unavailable'] as const
export type PortalHealthStatus = (typeof PORTAL_HEALTH_STATUSES)[number]

export const PORTAL_HEALTH_REASONS = [
  'operational',
  'publication_draft',
  'publication_disabled',
  'publication_archived',
  'property_unavailable',
  'publication_snapshot_unavailable',
  'public_address_unavailable',
  'responsibility_needed',
  'google_destination_awaiting_refresh',
  'google_destination_unavailable',
] as const
export type PortalHealthReason = (typeof PORTAL_HEALTH_REASONS)[number]

export function isPortalHealthStatus(value: string): value is PortalHealthStatus {
  return (PORTAL_HEALTH_STATUSES as readonly string[]).includes(value)
}

export function isPortalHealthReason(value: string): value is PortalHealthReason {
  return (PORTAL_HEALTH_REASONS as readonly string[]).includes(value)
}

export type PortalHealth = Readonly<{
  status: PortalHealthStatus
  reason: PortalHealthReason
}>

export type PortalHealthInterval = PortalHealth &
  Readonly<{
    id: string
    organizationId: OrganizationId
    propertyId: PropertyId
    portalId: PortalId
    sourceVersion: string
    effectiveFrom: Date
    effectiveTo: Date | null
    observedAt: Date
  }>

export function derivePortalHealth(
  input: Readonly<{
    publicationState: PortalPublicationState
    propertyAvailable: boolean
    hasActivePublicationSnapshot: boolean
    hasResolvablePublicAddress: boolean
    hasResponsibleManager: boolean
    googleDestinationState: 'verified' | 'awaiting_refresh' | 'unavailable'
  }>,
): PortalHealth {
  if (input.publicationState !== 'published') {
    return {
      status: 'unavailable',
      reason:
        input.publicationState === 'archived'
          ? 'publication_archived'
          : input.publicationState === 'disabled'
            ? 'publication_disabled'
            : 'publication_draft',
    }
  }
  if (!input.propertyAvailable) {
    return { status: 'unavailable', reason: 'property_unavailable' }
  }
  if (!input.hasActivePublicationSnapshot) {
    return { status: 'unavailable', reason: 'publication_snapshot_unavailable' }
  }
  if (!input.hasResolvablePublicAddress) {
    return { status: 'unavailable', reason: 'public_address_unavailable' }
  }
  if (!input.hasResponsibleManager) {
    return { status: 'degraded', reason: 'responsibility_needed' }
  }
  if (input.googleDestinationState === 'awaiting_refresh') {
    return { status: 'degraded', reason: 'google_destination_awaiting_refresh' }
  }
  if (input.googleDestinationState === 'unavailable') {
    return { status: 'degraded', reason: 'google_destination_unavailable' }
  }
  return { status: 'healthy', reason: 'operational' }
}
