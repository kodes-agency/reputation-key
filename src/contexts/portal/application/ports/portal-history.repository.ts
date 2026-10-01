import type { OrganizationId, PortalId, PropertyId } from '#/shared/domain/ids'
import type { HistoryBound } from '../../domain/portal-history'

/** One read of one source: rows strictly before `bound`, newest first. */
export type PortalHistoryPage = Readonly<{
  bound: HistoryBound | null
  limit: number
}>

export type PortalPublicationEventRow = Readonly<{
  activationId: string
  version: number
  kind: 'publish' | 'rollback'
  activatedBy: string
  activatedAt: Date
}>

export type PortalCodeIssuanceRow = Readonly<{
  tokenId: string
  version: number
  issuedAt: Date
  /** Who made the code; null for a code made before that was recorded. */
  issuedBy: string | null
  /** The address one version earlier, if any: the facts that decide replace vs issue. */
  predecessor: Readonly<{
    revokedAt: Date | null
    gracePeriodEnds: Date | null
  }> | null
}>

/** One "turn off all codes" act: every address revoked at the same instant. */
export type PortalCodeRevocationRow = Readonly<{
  revokedAt: Date
  revokedBy: string | null
  reason: string | null
}>

/** One time a manager was handed an existing address. */
export type PortalCodeDownloadRow = Readonly<{
  downloadId: string
  /** The version of the code that was handed out. */
  version: number
  downloadedBy: string
  purpose: 'download' | 'copy' | 'show'
  downloadedAt: Date
}>

/**
 * The Portal's own History sources. Health history comes from
 * `PortalHealthRepository.listHistory`; every read is scoped to one
 * Organization, Property and Portal.
 */
export type PortalHistoryRepository = Readonly<{
  listPublicationEvents: (
    organizationId: OrganizationId,
    propertyId: PropertyId,
    portalId: PortalId,
    page: PortalHistoryPage,
  ) => Promise<readonly PortalPublicationEventRow[]>
  listCodeIssuances: (
    organizationId: OrganizationId,
    propertyId: PropertyId,
    portalId: PortalId,
    page: PortalHistoryPage,
  ) => Promise<readonly PortalCodeIssuanceRow[]>
  listCodeDownloads: (
    organizationId: OrganizationId,
    propertyId: PropertyId,
    portalId: PortalId,
    page: PortalHistoryPage,
  ) => Promise<readonly PortalCodeDownloadRow[]>
  listCodeRevocations: (
    organizationId: OrganizationId,
    propertyId: PropertyId,
    portalId: PortalId,
    page: PortalHistoryPage,
  ) => Promise<readonly PortalCodeRevocationRow[]>
}>
