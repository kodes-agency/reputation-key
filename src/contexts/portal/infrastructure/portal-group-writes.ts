// Portal command store — the writes the group commands share: the group fence,
// the Portal and membership locks, ending and beginning a membership, and the
// history ledger. Every group command takes its fences before it locks a Portal
// and locks a Portal before its membership row, so two commands over the same
// groups and Portals queue instead of deadlocking.

import { and, eq, isNull, sql } from 'drizzle-orm'
import { portals } from '#/shared/db/schema'
import { portalGroups } from '#/shared/db/schema/portal-group.schema'
import { portalGroupHistory } from '#/shared/db/schema/portal-group.schema'
import { portalGroupMemberships } from '#/shared/db/schema/people-access.schema'
import type { Tx } from '#/shared/outbox/commit'
import type {
  OrganizationId,
  PortalGroupId,
  PortalId,
  PropertyId,
} from '#/shared/domain/ids'
import { unbrand } from '#/shared/domain/ids'
import { portalError } from '../domain/errors'
import type { PortalGroupHistoryDraft } from '../domain/portal-group-history'
import { assertCommittedRevision } from './portal-command-guards'

export type PortalGroupFence = Readonly<{
  organizationId: OrganizationId
  propertyId: PropertyId
  portalGroupId: PortalGroupId
  expectedUpdatedAt: Date
  revision: Date
}>

/** Why a membership ended; free text in the table, closed here. */
export type MembershipEndReason =
  'removed_from_group' | 'moved_to_group' | 'group_archived'

export type ActiveMembership = Readonly<{
  id: string
  portalGroupId: string
  effectiveFrom: Date
}>

/** Advance a group's revision if it is still the one the command read. */
export async function fencePortalGroup(
  tx: Tx,
  fence: PortalGroupFence,
  patch: Readonly<{ name?: string }> = {},
): Promise<void> {
  if (fence.revision.getTime() <= fence.expectedUpdatedAt.getTime()) {
    throw portalError(
      'revision_conflict',
      'Portal Group command revision must advance monotonically',
    )
  }
  const [updated] = await tx
    .update(portalGroups)
    .set({ ...patch, updatedAt: fence.revision })
    .where(
      and(
        eq(portalGroups.organizationId, unbrand(fence.organizationId)),
        eq(portalGroups.propertyId, unbrand(fence.propertyId)),
        eq(portalGroups.id, unbrand(fence.portalGroupId)),
        eq(portalGroups.updatedAt, fence.expectedUpdatedAt),
        isNull(portalGroups.deletedAt),
      ),
    )
    .returning({ updatedAt: portalGroups.updatedAt })
  assertCommittedRevision(
    updated,
    fence.revision,
    'Portal Group',
    'Portal Group changed while the command was being committed',
  )
}

/** Fence several groups in sorted id order, the order every group command uses. */
export async function fencePortalGroupsInOrder(
  tx: Tx,
  fences: ReadonlyArray<PortalGroupFence>,
): Promise<void> {
  const ordered = [...fences].sort((left, right) =>
    String(left.portalGroupId).localeCompare(String(right.portalGroupId)),
  )
  for (const fence of ordered) await fencePortalGroup(tx, fence)
}

/** Lock an active Portal of the Property, or refuse the membership change. */
export async function lockSamePropertyPortal(
  tx: Tx,
  scope: Readonly<{
    organizationId: OrganizationId
    propertyId: PropertyId
    portalId: PortalId
  }>,
  refusal: string,
): Promise<void> {
  await tx.execute(sql`
    SELECT id FROM portals
    WHERE organization_id = ${unbrand(scope.organizationId)}
      AND property_id = ${unbrand(scope.propertyId)}
      AND id = ${unbrand(scope.portalId)}
      AND deleted_at IS NULL
    FOR UPDATE
  `)
  const [portal] = await tx
    .select({ id: portals.id })
    .from(portals)
    .where(
      and(
        eq(portals.organizationId, unbrand(scope.organizationId)),
        eq(portals.propertyId, unbrand(scope.propertyId)),
        eq(portals.id, unbrand(scope.portalId)),
        isNull(portals.deletedAt),
      ),
    )
    .limit(1)
  if (!portal) throw portalError('forbidden', refusal)
}

/** The Portal's current membership, locked, or undefined when it has none. */
export async function lockActiveMembership(
  tx: Tx,
  scope: Readonly<{ organizationId: OrganizationId; portalId: PortalId }>,
): Promise<ActiveMembership | undefined> {
  await tx.execute(sql`
    SELECT id FROM portal_group_memberships
    WHERE organization_id = ${unbrand(scope.organizationId)}
      AND portal_id = ${unbrand(scope.portalId)}
      AND effective_to IS NULL
    FOR UPDATE
  `)
  const [active] = await tx
    .select({
      id: portalGroupMemberships.id,
      portalGroupId: portalGroupMemberships.portalGroupId,
      effectiveFrom: portalGroupMemberships.effectiveFrom,
    })
    .from(portalGroupMemberships)
    .where(
      and(
        eq(portalGroupMemberships.organizationId, unbrand(scope.organizationId)),
        eq(portalGroupMemberships.portalId, unbrand(scope.portalId)),
        isNull(portalGroupMemberships.effectiveTo),
      ),
    )
    .limit(1)
  return active
}

/**
 * End a membership at `at`. One that began at or after `at` never took effect
 * for any reading, so it is deleted instead of being closed to an empty interval.
 */
export async function endMembership(
  tx: Tx,
  active: ActiveMembership,
  at: Date,
  reason: MembershipEndReason,
): Promise<void> {
  if (active.effectiveFrom >= at) {
    await tx
      .delete(portalGroupMemberships)
      .where(eq(portalGroupMemberships.id, active.id))
    return
  }
  await tx
    .update(portalGroupMemberships)
    .set({ effectiveTo: at, endReason: reason })
    .where(eq(portalGroupMemberships.id, active.id))
}

export async function beginMembership(
  tx: Tx,
  membership: Readonly<{
    organizationId: OrganizationId
    propertyId: PropertyId
    portalId: PortalId
    portalGroupId: PortalGroupId
    at: Date
    createdBy: string
  }>,
): Promise<void> {
  await tx.insert(portalGroupMemberships).values({
    organizationId: unbrand(membership.organizationId),
    propertyId: unbrand(membership.propertyId),
    portalId: unbrand(membership.portalId),
    portalGroupId: unbrand(membership.portalGroupId),
    effectiveFrom: membership.at,
    createdBy: membership.createdBy,
  })
}

export async function recordGroupHistory(
  tx: Tx,
  entries: ReadonlyArray<PortalGroupHistoryDraft>,
): Promise<void> {
  if (entries.length === 0) return
  await tx.insert(portalGroupHistory).values(
    entries.map((entry) => ({
      organizationId: unbrand(entry.organizationId),
      propertyId: unbrand(entry.propertyId),
      portalGroupId: unbrand(entry.portalGroupId),
      kind: entry.kind,
      portalId: entry.portalId === null ? null : unbrand(entry.portalId),
      otherGroupId: entry.otherGroupId === null ? null : unbrand(entry.otherGroupId),
      name: entry.name,
      previousName: entry.previousName,
      actorUserId: entry.actorUserId,
      occurredAt: entry.occurredAt,
    })),
  )
}
