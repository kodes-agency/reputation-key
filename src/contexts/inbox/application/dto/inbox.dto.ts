// Inbox context — Zod schemas for server function validation
// Per architecture: "Zod schema for HTTP input, also reused as the form schema."
// Note: organizationId and userId are derived from the authenticated session
// via resolveTenantContext(headers), never from client input.

import { z } from 'zod/v4'

// GET inbox items — query params
export const getInboxItemsDto = z.object({
  propertyId: z.string().optional(),
  status: z.enum(['new', 'read', 'addressed', 'escalated', 'archived']).optional(),
  sourceType: z.enum(['review', 'feedback']).optional(),
  platform: z.string().optional(),
  ratingMin: z.number().int().min(1).max(5).optional(),
  ratingMax: z.number().int().min(1).max(5).optional(),
  sourceDateFrom: z.coerce.date().optional(),
  sourceDateTo: z.coerce.date().optional(),
  cursor: z.string().optional(), // base64-encoded cursor JSON
  limit: z.number().int().min(1).max(100).default(50),
})

// POST update status
// 'new' excluded — domain rules enforce forward-only transitions
export const updateStatusDto = z.object({
  inboxItemId: z.string().uuid(),
  status: z.enum(['read', 'addressed', 'escalated', 'archived']),
})

// POST bulk update status
export const bulkUpdateStatusDto = z.object({
  inboxItemIds: z.array(z.string().uuid()).min(1).max(100),
  status: z.enum(['read', 'addressed', 'archived']),
})

// POST assign
export const assignInboxItemDto = z.object({
  inboxItemId: z.string().uuid(),
  assignedToUserId: z.string().nullable(),
})

// POST add note
export const addInboxNoteDto = z.object({
  inboxItemId: z.string().uuid(),
  text: z.string().min(1).max(5000),
})

// GET unread count
export const getUnreadCountDto = z.object({})

// GET inbox item detail
export const getInboxItemDetailDto = z.object({
  inboxItemId: z.string().uuid(),
})

// Type exports
export type GetInboxItemsInput = z.infer<typeof getInboxItemsDto>
export type UpdateStatusInput = z.infer<typeof updateStatusDto>
export type BulkUpdateStatusInput = z.infer<typeof bulkUpdateStatusDto>
export type AssignInboxItemInput = z.infer<typeof assignInboxItemDto>
export type AddInboxNoteInput = z.infer<typeof addInboxNoteDto>
