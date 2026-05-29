// Portal context — PortalGroup DTOs
import { z } from 'zod/v4'

export const createPortalGroupSchema = z.object({
  propertyId: z.string().min(1, 'Property ID is required'),
  name: z
    .string()
    .min(1, 'Group name is required')
    .max(100, 'Name must be at most 100 characters'),
})

export type CreatePortalGroupInput = z.infer<typeof createPortalGroupSchema>

export const updatePortalGroupSchema = z.object({
  groupId: z.string().min(1, 'Group ID is required'),
  name: z
    .string()
    .min(1, 'Group name is required')
    .max(100, 'Name must be at most 100 characters'),
})

export type UpdatePortalGroupInput = z.infer<typeof updatePortalGroupSchema>

export const deletePortalGroupSchema = z.object({
  groupId: z.string().min(1, 'Group ID is required'),
})

export type DeletePortalGroupInput = z.infer<typeof deletePortalGroupSchema>

export const listPortalGroupsSchema = z.object({
  propertyId: z.string().min(1, 'Property ID is required'),
})

export type ListPortalGroupsInput = z.infer<typeof listPortalGroupsSchema>
