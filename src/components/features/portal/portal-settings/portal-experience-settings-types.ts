import type { Action } from '#/components/hooks/use-action'
import {
  GUEST_LOCALE_METADATA,
  OFFERED_GUEST_LOCALES,
  type GuestLocale,
  type OfferedGuestLocale,
} from '#/shared/domain/guest-locale'

/** The locales a manager can edit and publish today. */
export const PORTAL_GUEST_LOCALES: readonly OfferedGuestLocale[] = OFFERED_GUEST_LOCALES

export const PORTAL_GUEST_LOCALE_LABEL: Readonly<Record<OfferedGuestLocale, string>> = {
  en: GUEST_LOCALE_METADATA.en.englishName,
  bg: GUEST_LOCALE_METADATA.bg.englishName,
}

/** The one locale a manager can switch on beside English today. */
export const OPTIONAL_GUEST_LOCALE = 'bg' satisfies OfferedGuestLocale

/** The locales a Portal offers with the optional locale switched on or off. */
export function guestLocalesWithOptional(
  isOptionalEnabled: boolean,
): readonly OfferedGuestLocale[] {
  return isOptionalEnabled ? ['en', OPTIONAL_GUEST_LOCALE] : ['en']
}

/** Whether the Portal offers the optional locale, as primary or additional. */
export function isOptionalGuestLocaleEnabled(
  portal: Readonly<{
    primaryGuestLocale?: GuestLocale
    additionalGuestLocales?: readonly GuestLocale[]
  }>,
): boolean {
  return (
    portal.primaryGuestLocale === OPTIONAL_GUEST_LOCALE ||
    portal.additionalGuestLocales?.includes(OPTIONAL_GUEST_LOCALE) === true
  )
}

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
  saveProfile: Action<{
    data: {
      propertyId: string
      displayName: string
      primaryColor: string
      backgroundColor: string
      textColor: string
    }
  }>
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
