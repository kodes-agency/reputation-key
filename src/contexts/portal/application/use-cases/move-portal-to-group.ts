// Portal context — move portal to group use case
// Full pattern: authorize → find both groups and the Portal → atomically end the old
// membership and begin the new one with their facts → return.
// A Portal in no group joins the group, which is a plain addition. A Portal in
// another group leaves it in the same commit, so it is never in two groups and
// never in none: the results it earned stay with the group it left.

import type { PortalGroupRepository } from '../ports/portal-group.repository'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { PortalRepository } from '../ports/portal.repository'
import { portalError } from '../../domain/errors'
import { portalAddedToGroup, portalRemovedFromGroup } from '../../domain/events'
import type { StaffPublicApi } from '#/contexts/identity/application/public-api'
import {
  loadGroupAndPortalForMembership,
  loadPortalOfGroupProperty,
} from '../load-accessible-portal'
import type { PortalCommandStore } from '../ports/portal-command-store.port'
import { nextPortalCommandAt } from '../portal-command-version'

export type MovePortalToGroupDeps = Readonly<{
  portalGroupRepo: PortalGroupRepository
  portalRepo: PortalRepository
  staffPublicApi: StaffPublicApi
  commandStore: PortalCommandStore
  clock: () => Date
}>

export const movePortalToGroup =
  (deps: MovePortalToGroupDeps) =>
  async (
    input: { portalGroupId: string; portalId: string },
    ctx: AuthContext,
  ): Promise<void> => {
    const { gid, pid, group } = await loadGroupAndPortalForMembership(deps, ctx, input)

    await loadPortalOfGroupProperty(deps, ctx, pid, group)

    const currentGroupId = await deps.portalGroupRepo.findPortalMembership(
      ctx.organizationId,
      pid,
    )
    if (currentGroupId === gid) {
      throw portalError('portal_already_grouped', 'portal is already in this group')
    }
    const source = currentGroupId
      ? await deps.portalGroupRepo.findById(ctx.organizationId, currentGroupId)
      : null
    if (currentGroupId && !source) {
      throw portalError('group_not_found', 'portal group not found in this organization')
    }
    if (source && String(source.propertyId) !== String(group.propertyId)) {
      throw portalError('forbidden', 'groups must belong to the same property')
    }

    const occurredAt = deps.clock()
    const toRevision = nextPortalCommandAt(occurredAt, group.updatedAt)
    const fromRevision = source ? nextPortalCommandAt(occurredAt, source.updatedAt) : null
    await deps.commandStore.movePortalToGroup({
      organizationId: ctx.organizationId,
      propertyId: group.propertyId,
      portalId: pid,
      changedBy: ctx.userId,
      occurredAt,
      to: {
        portalGroupId: gid,
        expectedUpdatedAt: group.updatedAt,
        revision: toRevision,
        event: portalAddedToGroup({
          portalGroupId: gid,
          portalId: pid,
          organizationId: ctx.organizationId,
          propertyId: group.propertyId,
          sourceAggregateVersion: toRevision.toISOString(),
          occurredAt,
        }),
      },
      from:
        source && fromRevision
          ? {
              portalGroupId: source.id,
              expectedUpdatedAt: source.updatedAt,
              revision: fromRevision,
              event: portalRemovedFromGroup({
                portalGroupId: source.id,
                portalId: pid,
                organizationId: ctx.organizationId,
                propertyId: group.propertyId,
                sourceAggregateVersion: fromRevision.toISOString(),
                occurredAt,
              }),
            }
          : null,
    })
  }

export type MovePortalToGroup = ReturnType<typeof movePortalToGroup>
