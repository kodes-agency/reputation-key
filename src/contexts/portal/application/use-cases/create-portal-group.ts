// Portal context — create portal group use case
// Full pattern: authorize → validate refs → check uniqueness → build → atomically persist with facts → return
// A Portal that is already in another group of the Property moves into the new
// one in the same commit (create-with-move): its old membership ends with
// `moved_to_group`, so the results it earned stay with the old group.

import type { PortalGroupRepository } from '../ports/portal-group.repository'
import type { PortalRepository } from '../ports/portal.repository'
import type { PropertyPublicApi } from '#/contexts/property/application/public-api'
import type { PortalGroup, PortalGroupId } from '../../domain/types'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { CreatePortalGroupInput } from '../dto/create-portal-group.dto'
import { buildPortalGroup } from '../../domain/constructors'
import { portalError } from '../../domain/errors'
import {
  portalGroupCreated,
  portalAddedToGroup,
  portalRemovedFromGroup,
} from '../../domain/events'
import { portalId, type PortalId } from '#/shared/domain/ids'
import type { StaffPublicApi } from '#/contexts/identity/application/public-api'
import { assertNewPortalPropertyAccess } from '../load-accessible-portal'
import type {
  CreatePortalGroupCommand,
  PortalCommandStore,
  PortalGroupDeparture,
  PortalGroupSourceFence,
} from '../ports/portal-command-store.port'
import { nextPortalCommandAt } from '../portal-command-version'

export type CreatePortalGroupDeps = Readonly<{
  portalGroupRepo: PortalGroupRepository
  portalRepo: PortalRepository
  propertyApi: PropertyPublicApi
  staffPublicApi: StaffPublicApi
  commandStore: PortalCommandStore
  idGen: () => PortalGroupId
  clock: () => Date
}>

export const createPortalGroup =
  (deps: CreatePortalGroupDeps) =>
  async (input: CreatePortalGroupInput, ctx: AuthContext): Promise<PortalGroup> => {
    // 1. Authorize + 2. validate referenced property exists + assignment access (D6-001)
    const pid = await assertNewPortalPropertyAccess(
      deps,
      ctx,
      input.propertyId,
      'this role cannot create portal groups',
    )

    // 3. Check uniqueness — group name must be unique per org+property
    if (await deps.portalGroupRepo.nameExists(ctx.organizationId, pid, input.name)) {
      throw portalError('group_name_taken', 'a group with this name already exists')
    }

    // 4. Build domain object
    const groupResult = buildPortalGroup({
      id: deps.idGen(),
      organizationId: ctx.organizationId,
      propertyId: pid,
      name: input.name,
      createdBy: ctx.userId,
      now: deps.clock(),
    })

    if (groupResult.isErr()) {
      throw groupResult.error
    }

    const group = groupResult.value

    // 5. Validate every initial Portal before the atomic commit. One that is in
    // another group leaves it, and that group is fenced once however many leave.
    const brandedPids = [...new Set(input.portalIds ?? [])].map((candidate) =>
      portalId(candidate),
    )
    const sources = new Map<string, PortalGroupSourceFence>()
    const memberships: Array<CreatePortalGroupCommand['memberships'][number]> = []
    for (const brandedPid of brandedPids) {
      // Verify the portal exists and belongs to the same property as the group.
      const portal = await deps.portalRepo.findById(ctx.organizationId, brandedPid)
      if (!portal) {
        throw portalError('portal_not_found', `portal ${brandedPid} not found`)
      }
      if (String(portal.propertyId) !== String(group.propertyId)) {
        throw portalError(
          'forbidden',
          `portal ${brandedPid} must belong to the same property as the group`,
        )
      }
      const currentGroupId = await deps.portalGroupRepo.findPortalMembership(
        ctx.organizationId,
        brandedPid,
      )
      const movedFrom = currentGroupId
        ? await departureOf(deps, ctx, group, brandedPid, currentGroupId, sources)
        : null
      memberships.push({ portalId: brandedPid, createdBy: ctx.userId, movedFrom })
    }

    // 6. State, memberships, and all facts share one transaction.
    const created = portalGroupCreated({
      portalGroupId: group.id,
      organizationId: group.organizationId,
      propertyId: group.propertyId,
      name: group.name,
      sourceAggregateVersion: group.updatedAt.toISOString(),
      occurredAt: group.createdAt,
    })
    const added = brandedPids.map((brandedPid) =>
      portalAddedToGroup({
        portalGroupId: group.id,
        portalId: brandedPid,
        organizationId: ctx.organizationId,
        propertyId: group.propertyId,
        sourceAggregateVersion: group.updatedAt.toISOString(),
        occurredAt: group.createdAt,
      }),
    )
    await deps.commandStore.createPortalGroup({
      organizationId: ctx.organizationId,
      group,
      changedBy: ctx.userId,
      memberships,
      sourceGroups: [...sources.values()],
      events: [created, ...added],
    })

    // 7. Return
    return group
  }

/**
 * The departure of a Portal from the group it is in today. The group is read
 * once and its fence recorded; the departure fact carries that fence's revision.
 */
async function departureOf(
  deps: CreatePortalGroupDeps,
  ctx: AuthContext,
  group: PortalGroup,
  portalIdToMove: PortalId,
  currentGroupId: PortalGroupId,
  sources: Map<string, PortalGroupSourceFence>,
): Promise<PortalGroupDeparture> {
  const source = await deps.portalGroupRepo.findById(ctx.organizationId, currentGroupId)
  if (!source) {
    throw portalError('group_not_found', 'portal group not found in this organization')
  }
  const known = sources.get(String(source.id))
  const fence: PortalGroupSourceFence = known ?? {
    portalGroupId: source.id,
    expectedUpdatedAt: source.updatedAt,
    revision: nextPortalCommandAt(group.createdAt, source.updatedAt),
  }
  sources.set(String(source.id), fence)
  return {
    portalGroupId: source.id,
    event: portalRemovedFromGroup({
      portalGroupId: source.id,
      portalId: portalIdToMove,
      organizationId: ctx.organizationId,
      propertyId: group.propertyId,
      sourceAggregateVersion: fence.revision.toISOString(),
      occurredAt: group.createdAt,
    }),
  }
}

export type CreatePortalGroup = ReturnType<typeof createPortalGroup>
