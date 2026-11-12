import { sql } from 'drizzle-orm'
import type { OrganizationId, PropertyId } from '#/shared/domain/ids'
import type { Tx } from '#/shared/outbox/commit'
import type { CreatePortalCommand } from '../publication/portal-command-store-port.server'
import { portalError } from '../domain/errors'
import { assertSnapshotMatchesCommittedWorkingCopy } from './portal-publication-commands'
import {
  lockPortalPublicationProperty,
  lockPortalPublicationWorkingCopy,
} from './portal-publication-serialization'

/** Copy only the reviewed source, under the same fences as its content writers. */
export async function assertPersonalSourceFence(
  tx: Tx,
  scope: Readonly<{ organizationId: OrganizationId; propertyId: PropertyId }>,
  fence: CreatePortalCommand['personalSourceFence'],
) {
  if (!fence) return
  const { organizationId, propertyId } = scope
  await lockPortalPublicationProperty(tx, organizationId, propertyId)
  await lockPortalPublicationWorkingCopy(tx, organizationId, propertyId, fence.portalId)
  const rows = await tx.execute(sql`
    SELECT p.id FROM portals p JOIN portal_publication_activations a
      ON a.organization_id = p.organization_id AND a.property_id = p.property_id AND a.portal_id = p.id
    WHERE p.organization_id = ${organizationId} AND p.property_id = ${propertyId} AND p.id = ${fence.portalId}
      AND p.updated_at = ${fence.updatedAt} AND p.publication_state <> 'archived' AND p.deleted_at IS NULL
      AND a.deactivated_at IS NULL AND a.snapshot_id = ${fence.snapshot.id}`)
  if (rows.rows.length !== 1)
    throw portalError(
      'source_has_unpublished_changes',
      'The source Portal changed. Review and publish it before retrying staff setup',
    )
  try {
    await assertSnapshotMatchesCommittedWorkingCopy(
      tx,
      { organizationId, propertyId, portalId: fence.portalId },
      fence.snapshot,
    )
  } catch {
    throw portalError(
      'source_has_unpublished_changes',
      'The source Portal changed. Review and publish it before retrying staff setup',
    )
  }
}
