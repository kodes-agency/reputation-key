// Staff context — get assigned portals use case

import type { StaffAssignmentRepository } from '../ports/staff-assignment.repository'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { PortalId, PropertyId, UserId } from '#/shared/domain/ids'
import { staffError } from '../../domain/errors'
import { can } from '#/shared/domain/permissions'

// fallow-ignore-next-line unused-type
export type GetAssignedPortalsInput = Readonly<{
  userId: UserId
  propertyId: PropertyId
}>

// fallow-ignore-next-line unused-type
export type GetAssignedPortalsDeps = Readonly<{
  assignmentRepo: StaffAssignmentRepository
}>

export const getAssignedPortals =
  (deps: GetAssignedPortalsDeps) =>
  async (
    input: GetAssignedPortalsInput,
    ctx: AuthContext,
  ): Promise<ReadonlyArray<PortalId>> => {
    if (!can(ctx.role, 'staff_assignment.read')) {
      throw staffError('forbidden', 'No staff assignment read permission')
    }

    const assignments = await deps.assignmentRepo.listByUserAndProperty(
      ctx.organizationId,
      input.userId,
      input.propertyId,
    )

    // Extract unique non-null portalIds
    const seen = new Set<PortalId>()
    const portals: PortalId[] = []

    for (const a of assignments) {
      if (a.portalId !== null && !seen.has(a.portalId)) {
        seen.add(a.portalId)
        portals.push(a.portalId)
      }
    }

    return portals
  }

// fallow-ignore-next-line unused-type
export type GetAssignedPortals = ReturnType<typeof getAssignedPortals>
