// Portal context — add portal to group use case
// Full pattern: authorize → find group → check not already grouped → atomically add with fact → return

import type { PortalGroupRepository } from '../ports/portal-group.repository'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { PortalRepository } from '../ports/portal.repository'
import { portalError } from '../../domain/errors'
import { portalAddedToGroup } from '../../domain/events'
import type { StaffPublicApi } from '#/contexts/identity/application/public-api'
import {
  loadGroupAndPortalForMembership,
  loadPortalOfGroupProperty,
} from '../load-accessible-portal'
import type { PortalCommandStore } from '../ports/portal-command-store.port'
import { nextPortalCommandAt } from '../portal-command-version'

export type AddPortalToGroupDeps = Readonly<{
  portalGroupRepo: PortalGroupRepository
  portalRepo: PortalRepository
  staffPublicApi: StaffPublicApi
  commandStore: PortalCommandStore
  clock: () => Date
}>

export const addPortalToGroup =
  (deps: AddPortalToGroupDeps) =>
  async (
    input: { portalGroupId: string; portalId: string },
    ctx: AuthContext,
  ): Promise<void> => {
    const { gid, pid, group } = await loadGroupAndPortalForMembership(deps, ctx, input)

    // The portal must exist and belong to the same property as the group, so a
    // group of one property never collects a portal of another.
    await loadPortalOfGroupProperty(deps, ctx, pid, group)
    const existingGroupId = await deps.portalGroupRepo.findPortalMembership(
      ctx.organizationId,
      pid,
    )
    if (existingGroupId) {
      throw portalError('portal_already_grouped', 'portal is already in a group')
    }

    const occurredAt = deps.clock()
    const revision = nextPortalCommandAt(occurredAt, group.updatedAt)
    const event = portalAddedToGroup({
      portalGroupId: gid,
      portalId: pid,
      organizationId: ctx.organizationId,
      propertyId: group.propertyId,
      sourceAggregateVersion: revision.toISOString(),
      occurredAt,
    })
    await deps.commandStore.addPortalToGroup({
      organizationId: ctx.organizationId,
      propertyId: group.propertyId,
      portalGroupId: gid,
      portalId: pid,
      expectedUpdatedAt: group.updatedAt,
      revision,
      occurredAt,
      changedBy: ctx.userId,
      event,
    })
  }

export type AddPortalToGroup = ReturnType<typeof addPortalToGroup>
