import { and, eq, inArray, isNull, lte } from 'drizzle-orm'
import {
  portalPendingContentChanges,
  portalPublicationSnapshots,
} from '#/shared/db/schema/portal.schema'
import type { Tx } from '#/shared/outbox/commit'

export type PortalPendingContentChangeKind =
  | 'portal_configuration'
  | 'portal_links'
  | 'property_brand_profile'
  | 'property_brand_content'
  | 'portal_localized_override'
  | 'approved_destination'

export async function recordPortalPendingContentChange(
  tx: Tx,
  input: Readonly<{
    organizationId: string
    propertyId: string
    portalId?: string
    portalIds?: readonly string[]
    kind: PortalPendingContentChangeKind
    key?: string
    sourceVersion: string
    changedAt: Date
  }>,
): Promise<number> {
  const key = input.key?.trim() || 'all'
  if (key.length > 160 || input.sourceVersion.length > 160) {
    throw new Error('Portal pending-content fence exceeds its storage contract')
  }
  if (input.portalIds && input.portalIds.length === 0) return 0
  const snapshotPortalRows = await tx
    .select({ portalId: portalPublicationSnapshots.portalId })
    .from(portalPublicationSnapshots)
    .where(
      and(
        eq(portalPublicationSnapshots.organizationId, input.organizationId),
        eq(portalPublicationSnapshots.propertyId, input.propertyId),
        input.portalId
          ? eq(portalPublicationSnapshots.portalId, input.portalId)
          : input.portalIds
            ? inArray(portalPublicationSnapshots.portalId, [...input.portalIds])
            : undefined,
      ),
    )
  const portalIds = [...new Set(snapshotPortalRows.map((row) => row.portalId))].sort()
  if (portalIds.length === 0) return 0
  const inserted = await tx
    .insert(portalPendingContentChanges)
    .values(
      portalIds.map((portalId) => ({
        organizationId: input.organizationId,
        propertyId: input.propertyId,
        portalId,
        changeKind: input.kind,
        changeKey: key,
        sourceVersion: input.sourceVersion,
        changedAt: input.changedAt,
      })),
    )
    .onConflictDoNothing()
    .returning({ id: portalPendingContentChanges.id })
  return inserted.length
}

export async function resolvePortalPendingContentChanges(
  tx: Tx,
  input: Readonly<{
    organizationId: string
    propertyId: string
    portalId: string
    snapshotId: string
    resolvedAt: Date
  }>,
): Promise<number> {
  const rows = await tx
    .update(portalPendingContentChanges)
    .set({
      resolvedSnapshotId: input.snapshotId,
      resolvedAt: input.resolvedAt,
    })
    .where(
      and(
        eq(portalPendingContentChanges.organizationId, input.organizationId),
        eq(portalPendingContentChanges.propertyId, input.propertyId),
        eq(portalPendingContentChanges.portalId, input.portalId),
        isNull(portalPendingContentChanges.resolvedAt),
        lte(portalPendingContentChanges.changedAt, input.resolvedAt),
      ),
    )
    .returning({ id: portalPendingContentChanges.id })
  return rows.length
}

export async function listOpenPortalPendingContentChanges(
  tx: Tx,
  input: Readonly<{
    organizationId: string
    propertyId: string
    portalId: string
  }>,
) {
  return tx
    .select({
      kind: portalPendingContentChanges.changeKind,
      key: portalPendingContentChanges.changeKey,
      sourceVersion: portalPendingContentChanges.sourceVersion,
      changedAt: portalPendingContentChanges.changedAt,
    })
    .from(portalPendingContentChanges)
    .where(
      and(
        eq(portalPendingContentChanges.organizationId, input.organizationId),
        eq(portalPendingContentChanges.propertyId, input.propertyId),
        eq(portalPendingContentChanges.portalId, input.portalId),
        isNull(portalPendingContentChanges.resolvedAt),
      ),
    )
}
