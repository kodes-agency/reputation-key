// In-memory StaffAssignmentRepository fake — for use in use case tests.

import type { StaffAssignmentRepository } from '#/contexts/staff/application/ports/staff-assignment.repository'
import type { StaffAssignment } from '#/contexts/staff/domain/types'
import type { OrganizationId, PropertyId } from '#/shared/domain/ids'

export type InMemoryStaffAssignmentRepo = StaffAssignmentRepository &
  Readonly<{
    seed: (assignments: ReadonlyArray<StaffAssignment>) => void
    all: () => ReadonlyArray<StaffAssignment>
  }>

export const createInMemoryStaffAssignmentRepo = (): InMemoryStaffAssignmentRepo => {
  const store = new Map<string, StaffAssignment>()

  const isAccessible = (orgId: OrganizationId, a: StaffAssignment) =>
    a.organizationId === orgId && a.deletedAt === null

  return {
    findById: async (orgId, id) => {
      const a = store.get(id as string)
      return a && isAccessible(orgId, a) ? a : null
    },

    listByUser: async (orgId, userId) =>
      [...store.values()].filter((a) => isAccessible(orgId, a) && a.userId === userId),

    listByProperty: async (orgId, propertyId) =>
      [...store.values()].filter(
        (a) => isAccessible(orgId, a) && a.propertyId === propertyId,
      ),

    listByTeam: async (orgId, teamId) =>
      [...store.values()].filter((a) => isAccessible(orgId, a) && a.teamId === teamId),

    assignmentExists: async (orgId, userId, propertyId, teamId) =>
      [...store.values()].some(
        (a) =>
          isAccessible(orgId, a) &&
          a.userId === userId &&
          a.propertyId === propertyId &&
          a.teamId === teamId,
      ),

    insert: async (_orgId, assignment) => {
      store.set(assignment.id as string, assignment)
    },

    softDelete: async (orgId, id) => {
      const existing = store.get(id as string)
      if (!existing || !isAccessible(orgId, existing)) return
      store.set(
        id as string,
        {
          ...existing,
          deletedAt: new Date(),
          updatedAt: new Date(),
        } as StaffAssignment,
      )
    },

    getAccessiblePropertyIds: async (orgId, userId) => {
      const assignments = [...store.values()].filter(
        (a) => isAccessible(orgId, a) && a.userId === userId,
      )
      const ids = new Set<PropertyId>()
      for (const a of assignments) {
        ids.add(a.propertyId)
      }
      return [...ids]
    },

    seed: (assignments) => {
      for (const a of assignments) store.set(a.id as string, a)
    },

    all: () => [...store.values()],
  }
}
