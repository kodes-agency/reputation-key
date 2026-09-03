import { and, eq, gt, isNull, lte, or } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import {
  portalAccessArtifacts,
  portalPublicationActivations,
  portals,
  portalTokens,
} from '#/shared/db/schema/portal.schema'
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
import type { PortalTokenDigest } from '../../application/ports/portal-token-codec.port'

export type PublishedAccessArtifact = Readonly<{
  accessArtifactId: PortalAccessArtifactId
  organizationId: OrganizationId
  propertyId: PropertyId
  portalId: PortalId
  portalGroupId: PortalGroupId | null
  channel: PortalAccessArtifactChannel
}>

export type ResolvePublishedAccessArtifactInput = Readonly<{
  accessArtifactId: PortalAccessArtifactId
  organizationId: OrganizationId
  propertyId: PropertyId
  portalId: PortalId
  publicationSnapshotId: string
  tokenDigest: PortalTokenDigest
  asOf: Date
}>

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
              eq(portalAccessArtifacts.id, input.accessArtifactId),
              eq(portalAccessArtifacts.organizationId, input.organizationId),
              eq(portalAccessArtifacts.propertyId, input.propertyId),
              eq(portalAccessArtifacts.portalId, input.portalId),
              eq(portalAccessArtifacts.status, 'published'),
              lte(portalAccessArtifacts.publishedAt, input.asOf),
              isNull(portalAccessArtifacts.retiredAt),
              eq(portalTokens.organizationId, portalAccessArtifacts.organizationId),
              eq(portalTokens.propertyId, portalAccessArtifacts.propertyId),
              eq(portalTokens.portalId, portalAccessArtifacts.portalId),
              eq(portalTokens.tokenIdentifier, input.tokenDigest.tokenIdentifier),
              eq(portalTokens.tokenHash, input.tokenDigest.tokenHash),
              eq(portalTokens.tokenKeyVersion, input.tokenDigest.tokenKeyVersion),
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
