// Staff context — DTOs

import { z } from 'zod/v4'

export const createStaffAssignmentInputSchema = z.object({
  userId: z.string().min(1, 'User ID is required'),
  propertyId: z.string().min(1, 'Property ID is required'),
  teamId: z.string().min(1, 'This field is required').optional(),
})

export type CreateStaffAssignmentInput = z.infer<typeof createStaffAssignmentInputSchema>

export const removeStaffAssignmentInputSchema = z.object({
  assignmentId: z.string().min(1, 'Assignment ID is required'),
})

export type RemoveStaffAssignmentInput = z.infer<typeof removeStaffAssignmentInputSchema>

export const listStaffAssignmentsInputSchema = z.object({
  propertyId: z.string().min(1, 'This field is required').optional(),
  userId: z.string().min(1, 'This field is required').optional(),
  teamId: z.string().min(1, 'This field is required').optional(),
})

export type ListStaffAssignmentsInput = z.infer<typeof listStaffAssignmentsInputSchema>
