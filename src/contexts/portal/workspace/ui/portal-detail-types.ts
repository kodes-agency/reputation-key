// The Portal as the workspace's screens read it, and the responsible-manager
// shapes the editor and the Share tab both take.

import type { GuestLocale } from '#/shared/domain/guest-locale'
import type {
  PortalPublicationState,
  PortalThemeDraft,
} from '#/contexts/portal/workspace/ui/shared/types'

export type PortalDetailPortal = Readonly<{
  kind?: 'place' | 'personal'
  publicName?: string | null
  id: string
  name: string
  slug: string
  description: string | null
  heroImageUrl: string | null
  theme: PortalThemeDraft
  privateFeedbackThreshold: number
  skipPrivateRating: boolean
  contactRequestsEnabled: boolean
  propertyId: string
  organizationId: string
  publicationState: PortalPublicationState
  primaryGuestLocale?: GuestLocale
  additionalGuestLocales?: readonly GuestLocale[]
}>

export type PortalResponsibleManagerState = Readonly<{
  assignments: readonly Readonly<{ userId: string }>[]
  eligibleManagers: readonly Readonly<{
    userId: string
    role: 'AccountAdmin' | 'PropertyManager'
  }>[]
  revision: number
  responsibilityNeeded: boolean
  responsibilityNeededSince: string | Date | null
}>

export type ResponsibleManagerMember = Readonly<{
  userId: string
  name: string
  email: string
  role: string | null
}>
