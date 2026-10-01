import type { OrganizationId, PortalId, PropertyId } from '#/shared/domain/ids'
import type { HistoryBound } from '../../domain/portal-history'
import type { PortalPageEditKind } from '../../domain/portal-page-edit'
import type { PortalPublicationConfiguration } from '../../domain/portal-publication-snapshot'

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

/** One row of the page-edit ledger: who changed which part of the page, what it said, and when. */
export type PortalPageEditRow = Readonly<{
  editId: string
  kind: PortalPageEditKind
  /** The part of the page and what was done to it; `describePageEdit` reads it. */
  key: string
  /** Null for the system (an automatic name, a failed destination check). */
  actorUserId: string | null
  occurredAt: Date
  /** The row belongs to the whole Property, not to this Portal alone. */
  propertyWide: boolean
  /** Wording before the change; only for a change of wording, and the first save's when several folded. */
  previousText: string | null
  /** Wording after the change; the latest save's when several folded. */
  newText: string | null
  /** How many saves this row stands for (saves of one part by one person fold together). */
  editCount: number
}>

/** One published version: an immutable snapshot, read back verified. */
export type PortalPublishedVersionRow = Readonly<{
  version: number
  publishedAt: Date
  publishedBy: string
  configuration: PortalPublicationConfiguration
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
  /**
   * The Portal's published versions, newest first: at most `limit` of them. A
   * snapshot that no longer verifies is left out (it could not be served or
   * made live again either), so the numbers may skip.
   */
  listPublishedVersions: (
    organizationId: OrganizationId,
    propertyId: PropertyId,
    portalId: PortalId,
    limit: number,
  ) => Promise<readonly PortalPublishedVersionRow[]>
  /**
   * Page edits of this Portal plus Property-wide edits made since `since`
   * (the Portal's creation: a look changed before the page existed is not its
   * history).
   */
  listPageEdits: (
    organizationId: OrganizationId,
    propertyId: PropertyId,
    portalId: PortalId,
    page: PortalHistoryPage,
    since: Date,
  ) => Promise<readonly PortalPageEditRow[]>
}>
