// Staff context — build function.
// Wires staff repos, use cases, and the PublicApi surface.
// Per ADR-0001: the composition root calls this and passes publicApi to consumers.

import type { StaffAssignmentRepository } from './application/ports/staff-assignment.repository'
import type { StaffPublicApi } from './application/public-api'
import type { OrganizationId, UserId } from '#/shared/domain/ids'
import type { Role } from '#/shared/domain/roles'
import type { EventBus } from '#/shared/events/event-bus'
import { createStaffAssignment } from './application/use-cases/create-staff-assignment'
import { removeStaffAssignment } from './application/use-cases/remove-staff-assignment'
import { listStaffAssignments } from './application/use-cases/list-staff-assignments'
import { staffAssignmentId } from '#/shared/domain/ids'
import { randomUUID } from 'crypto'

type StaffContextDeps = Readonly<{
  repo: StaffAssignmentRepository
  events: EventBus
  clock: () => Date
}>

export const buildStaffContext = (deps: StaffContextDeps) => {
  const idGen = () => staffAssignmentId(randomUUID())

  const useCases = {
    createStaffAssignment: createStaffAssignment({
      assignmentRepo: deps.repo,
      events: deps.events,
      idGen,
      clock: deps.clock,
    }),
    removeStaffAssignment: removeStaffAssignment({
      assignmentRepo: deps.repo,
      events: deps.events,
      clock: deps.clock,
    }),
    listStaffAssignments: listStaffAssignments({
      assignmentRepo: deps.repo,
    }),
  } as const

  const publicApi: StaffPublicApi = {
    getAccessiblePropertyIds: async (
      orgId: OrganizationId,
      userId: UserId,
      role: Role,
    ) => {
      if (role === 'AccountAdmin') return null
      return deps.repo.getAccessiblePropertyIds(orgId, userId)
    },
  }

  return { useCases, publicApi } as const
}
