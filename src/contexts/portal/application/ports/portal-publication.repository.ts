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
  listActivationHistory: (
    organizationId: OrganizationId,
    propertyId: PropertyId,
    portalId: PortalId,
  ) => Promise<ReadonlyArray<PortalPublicationActivationRecord>>
  resolveActiveByTokenDigest: (
    digest: Readonly<{
      tokenIdentifier: string
      tokenHash: string
      tokenKeyVersion: number
    }>,
    asOf: Date,
  ) => Promise<ResolvedPortalPublication | null>
}>
