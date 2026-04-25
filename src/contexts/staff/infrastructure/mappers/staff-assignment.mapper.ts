// Staff context — row ↔ domain mapper

import type { staffAssignments } from '#/shared/db/schema/staff-assignment.schema'
import type { StaffAssignment } from '../../domain/types'
import type {
  OrganizationId,
  PropertyId,
  StaffAssignmentId,
  TeamId,
  UserId,
} from '#/shared/domain/ids'

type StaffAssignmentRow = typeof staffAssignments.$inferSelect
type StaffAssignmentInsertRow = typeof staffAssignments.$inferInsert

export const staffAssignmentFromRow = (row: StaffAssignmentRow): StaffAssignment => ({
  id: row.id as StaffAssignmentId,
  organizationId: row.organizationId as OrganizationId,
  userId: row.userId as UserId,
  propertyId: row.propertyId as PropertyId,
  teamId: row.teamId as TeamId | null,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
  deletedAt: row.deletedAt,
})

export const staffAssignmentToRow = (
  assignment: StaffAssignment,
): StaffAssignmentInsertRow => ({
  id: assignment.id as string,
  organizationId: assignment.organizationId as string,
  userId: assignment.userId as string,
  propertyId: assignment.propertyId as string,
  teamId: assignment.teamId as string | null,
  createdAt: assignment.createdAt,
  updatedAt: assignment.updatedAt,
  deletedAt: assignment.deletedAt,
})
