// Portal context — create portal group use case
// Full pattern: authorize → validate refs → check uniqueness → build → atomically persist with facts → return

import type { PortalGroupRepository } from '../ports/portal-group.repository'
import type { PortalRepository } from '../ports/portal.repository'
import type { PropertyPublicApi } from '#/contexts/property/application/public-api'
import type { PortalGroup, PortalGroupId } from '../../domain/types'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { CreatePortalGroupInput } from '../dto/create-portal-group.dto'
import { buildPortalGroup } from '../../domain/constructors'
import { portalError } from '../../domain/errors'
import { portalGroupCreated, portalAddedToGroup } from '../../domain/events'
import { portalId } from '#/shared/domain/ids'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import { assertNewPortalPropertyAccess } from '../load-accessible-portal'
import type { PortalCommandStore } from '../ports/portal-command-store.port'

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
      now: deps.clock(),
    })

    if (groupResult.isErr()) {
      throw groupResult.error
    }

    const group = groupResult.value

    // 5. Validate every initial membership before the atomic commit.
    const brandedPids = (input.portalIds ?? []).map((candidate) => portalId(candidate))
    if (brandedPids.length) {
      for (const brandedPid of brandedPids) {
        const existing = await deps.portalGroupRepo.findPortalMembership(
          ctx.organizationId,
          brandedPid,
        )
        if (existing) {
          throw portalError(
            'portal_already_grouped',
            `portal ${brandedPid} is already in a group`,
          )
        }
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
      }
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
      memberships: brandedPids.map((brandedPid) => ({
        portalId: brandedPid,
        createdBy: ctx.userId,
      })),
      events: [created, ...added],
    })

    // 7. Return
    return group
  }

export type CreatePortalGroup = ReturnType<typeof createPortalGroup>
