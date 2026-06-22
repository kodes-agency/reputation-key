// Staff context — update staff portals use case
// Replaces all portal assignments for a user in a property with the given set.
// Diff current vs new → creates missing, removes extra.

import type { StaffAssignmentRepository } from '../ports/staff-assignment.repository'
import type { StaffPortalLookupPort } from '../ports/portal-lookup.port'
import type { EventBus } from '#/shared/events/event-bus'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { UserId, PropertyId, PortalId } from '#/shared/domain/ids'
import type { StaffAssignment } from '../../domain/types'
import type { StaffPublicApi } from '../public-api'
import { can } from '#/shared/domain/permissions'
import { hasRole } from '#/shared/domain/roles'
import { staffError } from '../../domain/errors'
import { staffAssigned, staffUnassigned } from '../../domain/events'
import { buildStaffAssignment } from '../../domain/constructors'
import { isPropertyAccessible } from '#/shared/domain/property-access'
import { staffAssignmentId } from '#/shared/domain/ids'

// fallow-ignore-next-line unused-type
export type UpdateStaffPortalsInput = Readonly<{
  userId: UserId
  propertyId: PropertyId
  portalIds: ReadonlyArray<PortalId>
}>

// fallow-ignore-next-line unused-type
export type UpdateStaffPortalsDeps = Readonly<{
  assignmentRepo: StaffAssignmentRepository
  portalLookup: StaffPortalLookupPort
  events: EventBus
  staffPublicApi: StaffPublicApi
  clock: () => Date
  idGen: () => string
}>

export const updateStaffPortals =
  (deps: UpdateStaffPortalsDeps) =>
  async (
    input: UpdateStaffPortalsInput,
    ctx: AuthContext,
  ): Promise<{ added: number; removed: number }> => {
    // 1. Authorize — update is create + delete combined
    if (
      !can(ctx.role, 'staff_assignment.create') ||
      !can(ctx.role, 'staff_assignment.delete')
    ) {
      throw staffError('forbidden', 'this role cannot manage staff assignments')
    }

    // 1b. Property-access scoping (D6-001):
    // AccountAdmin bypasses; PropertyManager/Staff must be assigned to the target property.
    const accessible = await isPropertyAccessible(
      (orgId, uId, role) =>
        deps.staffPublicApi.getAccessiblePropertyIds(orgId, uId, role),
      ctx.organizationId,
      ctx.userId,
      ctx.role,
      input.propertyId,
    )
    if (!accessible) {
      throw staffError('forbidden', 'no access to this property')
    }

    const correlationId = deps.idGen()

    // 2. Validate — all requested portalIds must belong to the property
    const validPortalIds = new Set(
      await deps.portalLookup.listPortalIdsByProperty(
        ctx.organizationId,
        input.propertyId,
      ),
    )
    const invalidPortalIds = input.portalIds.filter((id) => !validPortalIds.has(id))
    if (invalidPortalIds.length > 0) {
      throw staffError(
        'invalid_input',
        `Portals not in property: ${invalidPortalIds.join(', ')}`,
      )
    }

    // 3. Load current assignments for this user in this property
    const current = await deps.assignmentRepo.listByUserAndProperty(
      ctx.organizationId,
      input.userId,
      input.propertyId,
    )

    // 4. Build lookup: portalId → assignment
    const currentByPortal: Map<PortalId, StaffAssignment> = new Map(
      current
        .filter((a): a is StaffAssignment & { portalId: PortalId } => a.portalId != null)
        .map((a) => [a.portalId, a] as const),
    )
    const currentPortalIds = new Set(currentByPortal.keys())

    let added = 0
    let removed = 0

    // 5. Create assignments for missing portals
    //    Use the teamId from the first assignment if there is one (all rows share same team)
    const referenceAssignment = current[0]
    const teamId = referenceAssignment?.teamId ?? null

    const desiredSet = new Set(input.portalIds)

    for (const pId of input.portalIds) {
      if (!currentPortalIds.has(pId)) {
        const id = staffAssignmentId(deps.idGen())

        const buildResult = buildStaffAssignment({
          id,
          organizationId: ctx.organizationId,
          userId: input.userId,
          propertyId: input.propertyId,
          teamId,
          portalId: pId,
          actingUserId: hasRole(ctx.role, 'AccountAdmin') ? undefined : ctx.userId,
          now: deps.clock(),
        })

        if (buildResult.isErr()) {
          throw staffError(buildResult.error.code, buildResult.error.message)
        }

        await deps.assignmentRepo.insert(ctx.organizationId, buildResult.value)

        await deps.events.emit({
          ...staffAssigned({
            assignmentId: buildResult.value.id,
            organizationId: buildResult.value.organizationId,
            userId: buildResult.value.userId,
            propertyId: buildResult.value.propertyId,
            teamId: buildResult.value.teamId,
            portalId: buildResult.value.portalId,
            occurredAt: buildResult.value.createdAt,
          }),
          correlationId,
        })

        added++
      }
    }

    // 6. Remove assignments for portals no longer desired
    for (const [portalId, assignment] of currentByPortal) {
      if (!desiredSet.has(portalId)) {
        await deps.assignmentRepo.softDelete(ctx.organizationId, assignment.id)

        await deps.events.emit({
          ...staffUnassigned({
            assignmentId: assignment.id,
            organizationId: assignment.organizationId,
            userId: assignment.userId,
            propertyId: assignment.propertyId,
            portalId: assignment.portalId,
            occurredAt: deps.clock(),
          }),
          correlationId,
        })

        removed++
      }
    }

    return { added, removed }
  }

export type UpdateStaffPortalsResult = Readonly<{ added: number; removed: number }>

/** Concrete use case instance type — named, not derived via ReturnType. */
export type UpdateStaffPortals = (
  input: UpdateStaffPortalsInput,
  ctx: AuthContext,
) => Promise<UpdateStaffPortalsResult>
