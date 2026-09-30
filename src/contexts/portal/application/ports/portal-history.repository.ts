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
  listCodeRevocations: (
    organizationId: OrganizationId,
    propertyId: PropertyId,
    portalId: PortalId,
    page: PortalHistoryPage,
  ) => Promise<readonly PortalCodeRevocationRow[]>
}>
