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
  organizationId: assignment.organizationId as string,
  userId: assignment.userId as string,
  propertyId: assignment.propertyId as string,
  teamId: assignment.teamId as string | null,
  portalId: assignment.portalId as string | null,
  createdAt: assignment.createdAt,
  updatedAt: assignment.updatedAt,
  deletedAt: assignment.deletedAt,
})
