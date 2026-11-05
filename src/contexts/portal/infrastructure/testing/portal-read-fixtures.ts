import { randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import {
  portalGroups,
  portalHealthIntervals,
  portalTokens,
} from '#/shared/db/schema/portal.schema'
import { portalGroupMemberships } from '#/shared/db/schema/people-access.schema'
import type { OrganizationId, PortalGroupId, PortalId } from '#/shared/domain/ids'
import type { PortalToken } from '../../domain/portal-token'
import type { PortalHealthInterval } from '../../domain/portal-health'

export async function seedPortalToken(db: Database, token: PortalToken): Promise<void> {
  await db.insert(portalTokens).values(token).onConflictDoUpdate({
    target: portalTokens.id,
    set: token,
  })
}

export async function seedPortalGroupMembership(
  db: Database,
  organizationId: OrganizationId,
  groupId: PortalGroupId,
  portalId: PortalId,
  effectiveFrom: Date,
  createdBy: string,
): Promise<void> {
  const [group] = await db
    .select({ propertyId: portalGroups.propertyId })
    .from(portalGroups)
    .where(
      and(eq(portalGroups.organizationId, organizationId), eq(portalGroups.id, groupId)),
    )
  if (!group) throw new Error('Seed the group before its membership')
  await db.insert(portalGroupMemberships).values({
    id: randomUUID(),
    organizationId,
    propertyId: group.propertyId,
    portalId,
    portalGroupId: groupId,
    effectiveFrom,
    createdBy,
  })
}

export async function seedPortalHealthInterval(
  db: Database,
  interval: Omit<PortalHealthInterval, 'status' | 'reason' | 'effectiveTo'> &
    Readonly<{
      health: Pick<PortalHealthInterval, 'status' | 'reason'>
      effectiveTo?: Date | null
    }>,
): Promise<void> {
  const { health, effectiveTo = null, ...row } = interval
  await db.insert(portalHealthIntervals).values({ ...row, ...health, effectiveTo })
}
