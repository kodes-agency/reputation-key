import type { Action } from '#/components/hooks/use-action'
import type { GuestLocale, OfferedGuestLocale } from '#/shared/domain/guest-locale'

export type PortalExperienceSettings = Readonly<{
  profile: Readonly<{
    displayName: string
    primaryColor: string
    backgroundColor: string
    textColor: string
  }> | null
  content: readonly Readonly<{
    locale: GuestLocale
    title: string
    shortDescription: string
    version: number
  }>[]
  overrides: readonly Readonly<{
    locale: GuestLocale
    title: string | null
    shortDescription: string | null
    version: number
  }>[]
  canManagePropertyBrand: boolean
}>

type Destination = Readonly<{
  id: string
  normalizedUri: string
  hostname: string
  sourceType: 'recognized' | 'custom' | 'provider'
  approvalState: 'pending' | 'approved' | 'disabled' | 'quarantined'
  lastValidatedAt: Date | string
}>

export type PortalApprovedDestinationList = Readonly<{
  destinations: readonly Destination[]
  canApprove: boolean
}>

export type PortalExperienceActions = Readonly<{
  saveContent: Action<{
    data: {
      propertyId: string
      locale: OfferedGuestLocale
      title: string
      shortDescription: string
    }
  }>
  saveOverride: Action<{
    data: {
      portalId: string
      locale: OfferedGuestLocale
      title: string | null
      shortDescription: string | null
    }
  }>
  requestDestination: Action<{
    data: { portalId: string; uri: string }
  }>
  approveDestination: Action<{
    data: { portalId: string; destinationId: string }
  }>
  disableDestination: Action<{
    data: { portalId: string; destinationId: string; reason: string }
  }>
}>
