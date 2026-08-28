import type {
  PortalPublicationActivation,
  PortalPublicationSnapshot,
  PortalPublicationSource,
} from '../../domain/portal-publication-snapshot'
import type { OrganizationId, PortalId, PropertyId } from '#/shared/domain/ids'

export type PortalPublicationCursor = Readonly<{
  nextSnapshotVersion: number
  nextActivationSequence: number
}>

export type ResolvedPortalPublication = Readonly<{
  token: Readonly<{
    organizationId: string
    propertyId: string
    portalId: string
    version: number
  }>
  snapshot: PortalPublicationSnapshot
}>

export type PortalPublicationActivationRecord = Readonly<{
  activation: PortalPublicationActivation
  snapshot: PortalPublicationSnapshot
}>

export type PortalPublicationActivationPage = Readonly<{
  records: ReadonlyArray<PortalPublicationActivationRecord>
  /** Newest activation in the full scoped history, independent of this page. */
  latest: PortalPublicationActivationRecord | null
  /** Open activation, if the Portal is currently Published. */
  current: PortalPublicationActivationRecord | null
  /** Exclusive activation-sequence cursor for the next page. */
  nextCursor: number | null
}>

export type PortalPendingContentChange = Readonly<{
  kind:
    | 'portal_configuration'
    | 'portal_links'
    | 'property_brand_profile'
    | 'property_brand_content'
    | 'portal_localized_override'
    | 'approved_destination'
  key: string
  sourceVersion: string
  changedAt: Date
}>

export type PortalPublicationRepository = Readonly<{
  loadWorkingCopy: (
    organizationId: OrganizationId,
    portalId: PortalId,
  ) => Promise<PortalPublicationSource | null>
  getCursor: (
    organizationId: OrganizationId,
    portalId: PortalId,
  ) => Promise<PortalPublicationCursor>
  findSnapshotByVersion: (
    organizationId: OrganizationId,
    portalId: PortalId,
    version: number,
  ) => Promise<PortalPublicationSnapshot | null>
  findActiveForPortal: (
    organizationId: OrganizationId,
    portalId: PortalId,
  ) => Promise<PortalPublicationSnapshot | null>
  listActivationHistoryPage: (
    organizationId: OrganizationId,
    propertyId: PropertyId,
    portalId: PortalId,
    page: Readonly<{ beforeSequence: number | null; limit: number }>,
  ) => Promise<PortalPublicationActivationPage>
  listOpenPendingContentChanges?: (
    organizationId: OrganizationId,
    propertyId: PropertyId,
    portalId: PortalId,
  ) => Promise<readonly PortalPendingContentChange[]>
  resolveActiveByTokenDigest: (
    digest: Readonly<{
      tokenIdentifier: string
      tokenHash: string
      tokenKeyVersion: number
    }>,
    asOf: Date,
  ) => Promise<ResolvedPortalPublication | null>
}>
