// Staff context — row ↔ domain mapper

import type { staffAssignments } from '#/shared/db/schema/staff-assignment.schema'
import type { StaffAssignment } from '../../domain/types'
import {
  unbrand,
  staffAssignmentId,
  organizationId,
  userId,
  propertyId,
  teamId,
  portalId,
} from '#/shared/domain/ids'

type StaffAssignmentRow = typeof staffAssignments.$inferSelect
type StaffAssignmentInsertRow = typeof staffAssignments.$inferInsert

export const staffAssignmentFromRow = (row: StaffAssignmentRow): StaffAssignment => ({
  id: staffAssignmentId(row.id),
  organizationId: organizationId(row.organizationId),
  userId: userId(row.userId),
  propertyId: propertyId(row.propertyId),
  teamId: row.teamId != null ? teamId(row.teamId) : null,
  portalId: row.portalId != null ? portalId(row.portalId) : null,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
  deletedAt: row.deletedAt,
})

export const staffAssignmentToRow = (
  assignment: StaffAssignment,
): StaffAssignmentInsertRow => ({
  id: unbrand(assignment.id),
  organizationId: unbrand(assignment.organizationId),
  userId: unbrand(assignment.userId),
  propertyId: unbrand(assignment.propertyId),
  teamId: assignment.teamId != null ? unbrand(assignment.teamId) : null,
  portalId: assignment.portalId != null ? unbrand(assignment.portalId) : null,
  createdAt: assignment.createdAt,
  updatedAt: assignment.updatedAt,
  deletedAt: assignment.deletedAt,
})
