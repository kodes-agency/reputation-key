// Staff context — Drizzle repository implementation

import { and, eq, isNull } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { baseWhere } from '#/shared/db/base-where'
import { staffAssignments } from '#/shared/db/schema/staff-assignment.schema'
import type { StaffAssignmentRepository } from '../../application/ports/staff-assignment.repository'
import {
  staffAssignmentFromRow,
  staffAssignmentToRow,
} from '../mappers/staff-assignment.mapper'
import { staffError } from '../../domain/errors'
import { propertyId } from '#/shared/domain/ids'
import { trace } from '#/shared/observability/trace'

export const createStaffAssignmentRepository = (
  db: Database,
): StaffAssignmentRepository => ({
  findById: async (orgId, id) => {
    return trace('staffAssignment.findById', async () => {
      const rows = await db
        .select()
        .from(staffAssignments)
        .where(
          and(
            ...baseWhere(staffAssignments, orgId),
            eq(staffAssignments.id, id as string),
          ),
        )
        .limit(1)
      return rows[0] ? staffAssignmentFromRow(rows[0]) : null
    })
  },

  listByUser: async (orgId, userId) => {
    return trace('staffAssignment.listByUser', async () => {
      const rows = await db
        .select()
        .from(staffAssignments)
        .where(
          and(
            ...baseWhere(staffAssignments, orgId),
            eq(staffAssignments.userId, userId as string),
          ),
        )
      return rows.map(staffAssignmentFromRow)
    })
  },

  listByProperty: async (orgId, propertyId) => {
    return trace('staffAssignment.listByProperty', async () => {
      const rows = await db
        .select()
        .from(staffAssignments)
        .where(
          and(
            ...baseWhere(staffAssignments, orgId),
            eq(staffAssignments.propertyId, propertyId as string),
          ),
        )
      return rows.map(staffAssignmentFromRow)
    })
  },

  listByTeam: async (orgId, teamId) => {
    return trace('staffAssignment.listByTeam', async () => {
      const rows = await db
        .select()
        .from(staffAssignments)
        .where(
          and(
            ...baseWhere(staffAssignments, orgId),
            eq(staffAssignments.teamId, teamId as string),
          ),
        )
      return rows.map(staffAssignmentFromRow)
    })
  },

  assignmentExists: async (orgId, userId, propertyId, teamId) => {
    return trace('staffAssignment.assignmentExists', async () => {
      const conditions = [
        ...baseWhere(staffAssignments, orgId),
        eq(staffAssignments.userId, userId as string),
        eq(staffAssignments.propertyId, propertyId as string),
      ]
      // Must distinguish NULL teamId (direct assignment) from non-null (team assignment).
      // Without this filter, a direct-property check would match team-based assignments.
      if (teamId) {
        conditions.push(eq(staffAssignments.teamId, teamId as string))
      } else {
        conditions.push(isNull(staffAssignments.teamId))
      }

      const rows = await db
        .select({ id: staffAssignments.id })
        .from(staffAssignments)
        .where(and(...conditions))
        .limit(1)
      return rows.length > 0
    })
  },

  insert: async (orgId, assignment) => {
    return trace('staffAssignment.insert', async () => {
      if (assignment.organizationId !== orgId) {
        throw staffError('forbidden', 'Tenant mismatch on staff assignment insert')
      }
      await db.insert(staffAssignments).values(staffAssignmentToRow(assignment))
    })
  },

  softDelete: async (orgId, id) => {
    return trace('staffAssignment.softDelete', async () => {
      const now = new Date()
      await db
        .update(staffAssignments)
        .set({ deletedAt: now, updatedAt: now })
        .where(
          and(
            ...baseWhere(staffAssignments, orgId),
            eq(staffAssignments.id, id as string),
          ),
        )
    })
  },

  getAccessiblePropertyIds: async (orgId, userId) => {
    return trace('staffAssignment.getAccessiblePropertyIds', async () => {
      const rows = await db
        .selectDistinct({ propertyId: staffAssignments.propertyId })
        .from(staffAssignments)
        .where(
          and(
            ...baseWhere(staffAssignments, orgId),
            eq(staffAssignments.userId, userId as string),
          ),
        )
      return rows.map((r) => propertyId(r.propertyId))
    })
  },
})
