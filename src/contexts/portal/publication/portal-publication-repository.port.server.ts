import type {
  PortalPublicationActivation,
  PortalPublicationSnapshot,
} from '../domain/portal-publication-snapshot'
import type { PortalPageEditKind } from '../domain/portal-page-edit'
import type { PortalPublicationSource } from '../domain/portal-publication-source'
import type { PortalLookSources } from '../domain/portal-look'
import type { OrganizationId, PortalId, PropertyId } from '#/shared/domain/ids'
import type { PresentedAddressDigest } from '../addresses/portal-token-codec.port.server'

/**
 * A Portal's working copy and, beside it, where its look groups come from (ADR
 * 0070). The sources are not part of the source: publishing never reads them,
 * so they reach no snapshot and no digest.
 */
export type PortalWorkingCopyWithLook = Readonly<{
  source: PortalPublicationSource
  lookSources: PortalLookSources
}>

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

export type PortalCurrentAndLatestActivation = Readonly<{
  /** Newest activation in the scoped history. */
  latest: PortalPublicationActivationRecord | null
  /** Open activation, if the Portal is currently Published. */
  current: PortalPublicationActivationRecord | null
}>

export type PortalPendingContentChange = Readonly<{
  kind: PortalPageEditKind
  key: string
  sourceVersion: string
  changedAt: Date
  /** Who made the change; null for the system and for a row written before it was recorded. */
  changedBy: string | null
}>

export type PortalPublicationRepository = Readonly<{
  loadWorkingCopy: (
    organizationId: OrganizationId,
    portalId: PortalId,
  ) => Promise<PortalPublicationSource | null>
  /** `loadWorkingCopy`, with where the Portal's look groups come from read alongside. */
  loadWorkingCopyWithLook: (
    organizationId: OrganizationId,
    portalId: PortalId,
  ) => Promise<PortalWorkingCopyWithLook | null>
  getCursor: (
    organizationId: OrganizationId,
    portalId: PortalId,
  ) => Promise<PortalPublicationCursor>
  findSnapshotByVersion: (
    organizationId: OrganizationId,
    portalId: PortalId,
    version: number,
  ) => Promise<PortalPublicationSnapshot | null>
  /** The open activation of the Portal with its snapshot, newest sequence. */
  findLiveRecord: (
    organizationId: OrganizationId,
    portalId: PortalId,
  ) => Promise<PortalPublicationActivationRecord | null>
  findActiveForPortal: (
    organizationId: OrganizationId,
    portalId: PortalId,
  ) => Promise<PortalPublicationSnapshot | null>
  findCurrentAndLatestActivation: (
    organizationId: OrganizationId,
    propertyId: PropertyId,
    portalId: PortalId,
  ) => Promise<PortalCurrentAndLatestActivation>
  /**
   * The versions that went live in `[startAt, endAt)`, oldest first: a fresh
   * publication or a rollback, with the version number and the instant. Bounded,
   * for markers on a chart; it is not the history read.
   */
  listActivationsBetween: (
    organizationId: OrganizationId,
    propertyId: PropertyId,
    portalId: PortalId,
    window: Readonly<{ startAt: Date; endAt: Date }>,
  ) => Promise<
    ReadonlyArray<
      Readonly<{ version: number; kind: 'publish' | 'rollback'; activatedAt: Date }>
    >
  >
  /**
   * For several Portals of one Organization in one read, ordered by Portal and
   * sequence: the activations that bound each run, over the Portal's whole
   * history. That is each Portal's first activation, every one a disable or an
   * archive closed, the one after each of those, and the open one. No time
   * bound: a Portal has as many rows as it has runs, about two each. Enough for
   * `liveRunStart` and `liveIntervals`, however long ago the run began.
   */
  listActivationsForPortals: (
    organizationId: OrganizationId,
    portalIds: readonly PortalId[],
  ) => Promise<readonly PortalPublicationActivation[]>
  listOpenPendingContentChanges: (
    organizationId: OrganizationId,
    propertyId: PropertyId,
    portalId: PortalId,
  ) => Promise<readonly PortalPendingContentChange[]>
  /**
   * How many open changes each Portal has, counted as `listOpenPendingContentChanges`
   * would list them, for a set of Portals in one read. A Portal with none is absent.
   */
  countOpenPendingContentChanges: (
    organizationId: OrganizationId,
    portalIds: readonly PortalId[],
  ) => Promise<readonly Readonly<{ portalId: PortalId; count: number }>[]>
  /**
   * The live publication a presented address opens, by its long address digest or
   * its print code digest (ADR 0069): the same statement for both, the address
   * match aside.
   */
  resolveActiveByTokenDigest: (
    digest: PresentedAddressDigest,
    asOf: Date,
  ) => Promise<ResolvedPortalPublication | null>
}>
