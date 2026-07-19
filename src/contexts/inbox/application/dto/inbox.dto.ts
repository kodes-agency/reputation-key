// Inbox context — Zod schemas for server function validation
// Per architecture: "Zod schema for HTTP input, also reused as the form schema."
// Note: organizationId and userId are derived from the authenticated session
// via resolveTenantContext(headers), never from client input.

import { z } from 'zod/v4'

// GET inbox items — query params
export const getInboxItemsDto = z.object({
  propertyId: z.string().optional(),
  status: z
    .union([z.enum(['open', 'closed']), z.array(z.enum(['open', 'closed']))])
    .optional(),
  isEscalated: z.boolean().optional(),
  sourceType: z.enum(['review', 'feedback']).optional(),
  platform: z.string().optional(),
  ratingMin: z.number().int().min(1).max(5).optional(),
  ratingMax: z.number().int().min(1).max(5).optional(),
  sourceDateFrom: z.coerce.date().optional(),
  sourceDateTo: z.coerce.date().optional(),
  cursor: z.string().optional(), // base64-encoded cursor JSON
  limit: z.number().int().min(1).max(100).default(50),
  q: z.string().optional(), // full-text search on snippet
})

// POST update status (open ⇄ closed — ADR 0023)
export const updateStatusDto = z.object({
  inboxItemId: z.string().uuid(),
  status: z.enum(['open', 'closed']),
})

// POST bulk update status
export const bulkUpdateStatusDto = z.object({
  inboxItemIds: z.array(z.string().uuid()).min(1).max(100),
  status: z.enum(['open', 'closed']),
})

// POST escalate inbox item (set escalation flag)
export const escalateInboxItemDto = z.object({
  inboxItemId: z.string().uuid(),
})

// POST resolve escalation (clear escalation flag)
export const resolveEscalationDto = z.object({
  inboxItemId: z.string().uuid(),
})

// POST assign
export const assignInboxItemDto = z.object({
  inboxItemId: z.string().uuid(),
  assignedToUserId: z.string().uuid().nullable(),
})

// POST add note
export const addInboxNoteDto = z.object({
  inboxItemId: z.string().uuid(),
  text: z.string().min(1).max(5000),
})

// GET last-visit count (open items since last visit)
export const getLastVisitCountDto = z.object({})

// POST stamp last-visit (called on inbox page load)
export const stampLastInboxViewDto = z.object({})

// GET inbox item detail
export const getInboxItemDetailDto = z.object({
  inboxItemId: z.string().uuid(),
})

// GET inbox notes
export const getInboxNotesDto = z.object({
  inboxItemId: z.string().uuid(),
})

// GET folder counts — for the email-style sidebar (open, escalated, closed).
// propertyId scopes the counts to one property (permission-checked); omitted
// means every accessible property (org-wide for org-wide roles).
export const getInboxFolderCountsDto = z.object({
  propertyId: z.string().optional(),
})

// Type exports
export type GetInboxItemsInput = z.infer<typeof getInboxItemsDto>
export type UpdateStatusInput = z.infer<typeof updateStatusDto>
export type BulkUpdateStatusInput = z.infer<typeof bulkUpdateStatusDto>
export type EscalateInboxItemInput = z.infer<typeof escalateInboxItemDto>
export type ResolveEscalationInput = z.infer<typeof resolveEscalationDto>
export type AssignInboxItemInput = z.infer<typeof assignInboxItemDto>
export type AddInboxNoteInput = z.infer<typeof addInboxNoteDto>
