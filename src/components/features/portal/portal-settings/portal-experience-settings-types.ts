import type { Action } from '#/components/hooks/use-action'
import type {
  PortalLookSettings,
  PropertyLookMedia,
} from '#/contexts/portal/application/public-api'
import type { GuestLocale, OfferedGuestLocale } from '#/shared/domain/guest-locale'

export type PortalExperienceSettings = Readonly<{
  profile: Readonly<{
    displayName: string
    primaryColor: string
    backgroundColor: string
    textColor: string
    /** How the background is chosen: from the accent ("auto") or typed ("manual"). */
    backgroundMode?: 'auto' | 'manual'
    /** The short name at the top of a page until a logo replaces it. */
    wordmark?: string | null
  }> | null
  /** The Property's photograph and logo, as a page draws them. */
  media?: PropertyLookMedia
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
  /**
   * A Portal's own look (ADR 0070): the three fields below are the settings
   * read's. Left out, as in a story that predates them, the portal follows the
   * property look and the own-look controls are not offered.
   */
  portalLook?: PortalLookSettings['portalLook']
  siblingPortalCount?: PortalLookSettings['siblingPortalCount']
  portalLookEnabled?: PortalLookSettings['portalLookEnabled']
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
