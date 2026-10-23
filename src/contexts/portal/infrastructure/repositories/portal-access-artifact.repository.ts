import { and, eq, gt, isNull, lte, or } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import {
  portalAccessArtifacts,
  portals,
  portalTokens,
} from '#/shared/db/schema/portal.schema'
import { portalPublicationActivations } from '#/shared/db/schema/portal-publication.schema'
import type {
  OrganizationId,
  PortalAccessArtifactId,
  PortalGroupId,
  PortalId,
  PropertyId,
} from '#/shared/domain/ids'
import {
  organizationId,
  portalAccessArtifactId,
  portalId,
  propertyId,
} from '#/shared/domain/ids'
import { trace } from '#/shared/observability/trace'
import type { PortalAccessArtifactChannel } from '../../domain/portal-access-artifact'
import type { PortalGroupRepository } from '../../application/ports/portal-group.repository'
import type { PresentedAddressDigest } from '../../application/ports/portal-token-codec.port'

export type PublishedAccessArtifact = Readonly<{
  accessArtifactId: PortalAccessArtifactId
  organizationId: OrganizationId
  propertyId: PropertyId
  portalId: PortalId
  portalGroupId: PortalGroupId | null
  channel: PortalAccessArtifactChannel
}>

export type ResolvePublishedAccessArtifactInput = Readonly<{
  /**
   * The marker the visit claimed. A print code needs none, because its own channel
   * column names the artifact (ADR 0069), and when it does claim one the artifact
   * must be that one. A long address with no marker names nothing.
   */
  accessArtifactId: PortalAccessArtifactId | null
  organizationId: OrganizationId
  propertyId: PropertyId
  portalId: PortalId
  publicationSnapshotId: string
  tokenDigest: PresentedAddressDigest
  asOf: Date
}>

/**
 * What ties the presented address to the artifact's code row. A long address is
 * its three hash columns, as it has always been. A print code is its keyed hash in
 * the column of the artifact's own channel, so the QR code of a row never opens
 * the NFC artifact and the reverse.
 */
const addressMatch = (digest: PresentedAddressDigest) =>
  digest.kind === 'short'
    ? [
        or(
          and(
            eq(portalTokens.qrPrintCodeHash, digest.printCodeHash),
            eq(portalAccessArtifacts.channel, 'qr'),
          ),
          and(
            eq(portalTokens.nfcPrintCodeHash, digest.printCodeHash),
            eq(portalAccessArtifacts.channel, 'nfc'),
          ),
        ),
      ]
    : [
        eq(portalTokens.tokenIdentifier, digest.tokenIdentifier),
        eq(portalTokens.tokenHash, digest.tokenHash),
        eq(portalTokens.tokenKeyVersion, digest.tokenKeyVersion),
      ]

export type PortalAccessArtifactRepository = Readonly<{
  resolvePublished(
    input: ResolvePublishedAccessArtifactInput,
  ): Promise<PublishedAccessArtifact | null>
}>

export const createPortalAccessArtifactRepository = (
  db: Database,
  portalGroups: Pick<PortalGroupRepository, 'findGroupForPortal'>,
): PortalAccessArtifactRepository => {
  return {
    resolvePublished: (input) =>
      trace('portalAccessArtifact.resolvePublished', async () => {
        // A website or "Public address" visit is a long address with no marker. It
        // is never a scan, so it does not reach the lookup at all.
        if (input.tokenDigest.kind === 'long' && input.accessArtifactId === null) {
          return null
        }
        const [row] = await db
          .select({
            accessArtifactId: portalAccessArtifacts.id,
            organizationId: portalAccessArtifacts.organizationId,
            propertyId: portalAccessArtifacts.propertyId,
            portalId: portalAccessArtifacts.portalId,
            channel: portalAccessArtifacts.channel,
          })
          .from(portalAccessArtifacts)
          .innerJoin(
            portalTokens,
            eq(portalTokens.id, portalAccessArtifacts.portalTokenId),
          )
          .innerJoin(
            portalPublicationActivations,
            and(
              eq(
                portalPublicationActivations.organizationId,
                portalAccessArtifacts.organizationId,
              ),
              eq(
                portalPublicationActivations.propertyId,
                portalAccessArtifacts.propertyId,
              ),
              eq(portalPublicationActivations.portalId, portalAccessArtifacts.portalId),
              eq(portalPublicationActivations.snapshotId, input.publicationSnapshotId),
              lte(portalPublicationActivations.activatedAt, input.asOf),
              or(
                isNull(portalPublicationActivations.deactivatedAt),
                gt(portalPublicationActivations.deactivatedAt, input.asOf),
              ),
            ),
          )
          .innerJoin(
            portals,
            and(
              eq(portals.organizationId, portalAccessArtifacts.organizationId),
              eq(portals.propertyId, portalAccessArtifacts.propertyId),
              eq(portals.id, portalAccessArtifacts.portalId),
            ),
          )
          .where(
            and(
              ...(input.accessArtifactId === null
                ? []
                : [eq(portalAccessArtifacts.id, input.accessArtifactId)]),
              eq(portalAccessArtifacts.organizationId, input.organizationId),
              eq(portalAccessArtifacts.propertyId, input.propertyId),
              eq(portalAccessArtifacts.portalId, input.portalId),
              eq(portalAccessArtifacts.status, 'published'),
              lte(portalAccessArtifacts.publishedAt, input.asOf),
              isNull(portalAccessArtifacts.retiredAt),
              eq(portalTokens.organizationId, portalAccessArtifacts.organizationId),
              eq(portalTokens.propertyId, portalAccessArtifacts.propertyId),
              eq(portalTokens.portalId, portalAccessArtifacts.portalId),
              ...addressMatch(input.tokenDigest),
              or(
                eq(portalTokens.status, 'active'),
                and(
                  eq(portalTokens.status, 'rotating'),
                  gt(portalTokens.gracePeriodEnds, input.asOf),
                ),
              ),
              eq(portals.publicationState, 'published'),
              isNull(portals.deletedAt),
            ),
          )
          .limit(1)
        if (!row || (row.channel !== 'qr' && row.channel !== 'nfc')) return null
        const resolvedOrganizationId = organizationId(row.organizationId)
        const resolvedPropertyId = propertyId(row.propertyId)
        const resolvedPortalId = portalId(row.portalId)
        const group = await portalGroups.findGroupForPortal(
          resolvedOrganizationId,
          resolvedPortalId,
          input.asOf,
        )
        if (group && group.propertyId !== row.propertyId) return null
        return {
          accessArtifactId: portalAccessArtifactId(row.accessArtifactId),
          organizationId: resolvedOrganizationId,
          propertyId: resolvedPropertyId,
          portalId: resolvedPortalId,
          portalGroupId: group?.id ?? null,
          channel: row.channel,
        }
      }),
  }
}
