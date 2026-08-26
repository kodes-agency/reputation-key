export const PORTAL_PUBLICATION_SCHEMA_VERSION = 1 as const
export const PRIMARY_GUEST_LOCALE = 'en' as const
export const PRIMARY_GUEST_LANGUAGE_PACK_VERSION = 'guest-ui-en-v1' as const

export type PortalPublicationSource = Readonly<{
  portal: Readonly<{
    id: string
    name: string
    slug: string
    description: string | null
    heroImageUrl: string | null
    theme: Readonly<Record<string, string | number | boolean | null>> | null
    organizationName: string
  }>
  categories: ReadonlyArray<Readonly<{ id: string; title: string; sortKey: string }>>
  links: ReadonlyArray<
    Readonly<{
      id: string
      label: string
      url: string
      categoryId: string | null
      sortKey: string
    }>
  >
  privateFeedbackThreshold: number
  organizationId: string
  propertyId: string
}>

export type VerifiedPublicationDestination = Readonly<{
  state: 'verified'
  uri: string
  retrievedAt: Date
  sourceEpoch: number
  profileVersion: number
}>

export type PortalPublicationConfiguration = Readonly<{
  schemaVersion: typeof PORTAL_PUBLICATION_SCHEMA_VERSION
  guestLocale: typeof PRIMARY_GUEST_LOCALE
  languagePackVersion: typeof PRIMARY_GUEST_LANGUAGE_PACK_VERSION
  portal: PortalPublicationSource['portal']
  categories: PortalPublicationSource['categories']
  links: PortalPublicationSource['links']
  reviewGateway: Readonly<{
    privateFeedbackThreshold: number
    googleReview: Readonly<{ status: 'available'; uri: string }>
  }>
  googleReviewBinding: Readonly<{
    retrievedAt: string
    sourceEpoch: number
    profileVersion: number
  }>
}>

export type PortalPublicationSnapshot = Readonly<{
  id: string
  organizationId: string
  propertyId: string
  portalId: string
  version: number
  configurationDigest: string
  configuration: PortalPublicationConfiguration
  destinationUri: string
  destinationRetrievedAt: Date
  destinationSourceEpoch: number
  destinationProfileVersion: number
  createdBy: string
  createdAt: Date
}>

export type PortalPublicationActivation = Readonly<{
  id: string
  organizationId: string
  propertyId: string
  portalId: string
  snapshotId: string
  activationSequence: number
  kind: 'publish' | 'rollback'
  activatedBy: string
  activatedAt: Date
  deactivatedAt: Date | null
  deactivationReason: 'disabled' | 'archived' | 'replaced' | null
}>
