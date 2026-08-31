// Inbox context — Zod schemas for server function validation
// Per architecture: "Zod schema for HTTP input, also reused as the form schema."
// Note: organizationId and userId are derived from the authenticated session
// via resolveTenantContext(headers), never from client input.

import { z } from 'zod/v4'
import { AI_PRIMARY_CATEGORIES } from '#/shared/openai-route-output-schemas'
import { SAFE_OPAQUE_IDENTIFIER_PATTERN } from '#/shared/domain/safe-identifier'
import { PRIVATE_FEEDBACK_HANDLING_OUTCOMES } from '../../domain/feedback-handling'

export const INBOX_BULK_LIMIT = 100
const commandRevisionSchema = z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
const handlingRevisionSchema = z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
const opaqueUserIdSchema = z
  .string()
  .regex(SAFE_OPAQUE_IDENTIFIER_PATTERN, 'Invalid user identifier')
const feedbackHandlingOutcomeSchema = z.enum(PRIVATE_FEEDBACK_HANDLING_OUTCOMES)
const feedbackHandlingInternalNoteTextSchema = z
  .string()
  .max(2_000, 'Keep the internal note under 2,000 characters')
const inboxManualReopenReasonSchema = z.enum([
  'guest_follow_up_still_needed',
  'internal_follow_up_still_needed',
  'new_information',
  'correcting_handling_status',
  'other',
])

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
  attention: z
    .union([
      z.enum(['urgent', 'high', 'medium', 'low']),
      z.array(z.enum(['urgent', 'high', 'medium', 'low'])),
    ])
    .optional(),
  category: z
    .union([z.enum(AI_PRIMARY_CATEGORIES), z.array(z.enum(AI_PRIMARY_CATEGORIES))])
    .optional(),
  sourceDateFrom: z.coerce.date().optional(),
  sourceDateTo: z.coerce.date().optional(),
  cursor: z.string().optional(), // base64-encoded cursor JSON
  limit: z.number().int().min(1).max(100).default(50),
  q: z.string().optional(), // full-text search on snippet
  sort: z.enum(['newest', 'oldest']).default('newest'),
})

// POST update status (open ⇄ closed — ADR 0023)
export const updateStatusDto = z
  .object({
    inboxItemId: z.uuid(),
    status: z.enum(['open', 'closed']),
    expectedCommandRevision: commandRevisionSchema,
    reopenReason: inboxManualReopenReasonSchema.optional(),
    reopenExplanation: z.string().max(280).nullable().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.status === 'open' && value.reopenReason === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['reopenReason'],
        message: 'Choose a reason for reopening this work',
      })
      return
    }
    if (value.reopenReason === 'other') {
      if (!value.reopenExplanation?.trim()) {
        ctx.addIssue({
          code: 'custom',
          path: ['reopenExplanation'],
          message: 'Add a short explanation for Other',
        })
      }
      return
    }
    if (value.reopenExplanation != null) {
      ctx.addIssue({
        code: 'custom',
        path: ['reopenExplanation'],
        message: 'An explanation is only used with Other',
      })
    }
  })

// POST bulk reopen. Bulk Close is deliberately unavailable for the initial
// beta because it needs per-cycle compatibility preview and revision fencing.
export const bulkUpdateStatusDto = z
  .object({
    items: z
      .array(
        z.object({
          inboxItemId: z.uuid(),
          expectedCommandRevision: commandRevisionSchema,
        }),
      )
      .min(1)
      .max(INBOX_BULK_LIMIT)
      .refine(
        (items) => new Set(items.map((item) => item.inboxItemId)).size === items.length,
        'Inbox bulk commands cannot contain duplicate items',
      ),
    status: z.literal('open'),
    reopenReason: inboxManualReopenReasonSchema,
    reopenExplanation: z.string().max(280).nullable().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.reopenReason === 'other') {
      if (!value.reopenExplanation?.trim()) {
        ctx.addIssue({
          code: 'custom',
          path: ['reopenExplanation'],
          message: 'Add a short explanation for Other',
        })
      }
      return
    }
    if (value.reopenExplanation != null) {
      ctx.addIssue({
        code: 'custom',
        path: ['reopenExplanation'],
        message: 'An explanation is only used with Other',
      })
    }
  })

// POST escalate inbox item (set escalation flag)
export const escalateInboxItemDto = z.object({
  inboxItemId: z.uuid(),
  expectedCommandRevision: commandRevisionSchema,
})

// POST resolve escalation (clear escalation flag)
export const resolveEscalationDto = z.object({
  inboxItemId: z.uuid(),
  expectedCommandRevision: commandRevisionSchema,
})

// POST assign
export const assignInboxItemDto = z.object({
  inboxItemId: z.uuid(),
  assignedToUserId: opaqueUserIdSchema.nullable(),
  expectedCommandRevision: commandRevisionSchema,
})

// POST bounded all-or-nothing assign/reassign/release.
export const bulkAssignInboxItemsDto = z.object({
  items: z
    .array(
      z.object({
        inboxItemId: z.uuid(),
        expectedCommandRevision: commandRevisionSchema,
      }),
    )
    .min(1)
    .max(INBOX_BULK_LIMIT)
    .refine(
      (items) => new Set(items.map((item) => item.inboxItemId)).size === items.length,
      'Inbox bulk commands cannot contain duplicate items',
    ),
  assignedToUserId: opaqueUserIdSchema.nullable(),
})

const inboxNoteTextSchema = z
  .string()
  .trim()
  .min(1, 'Write a note before adding it')
  .max(5_000, 'Keep the note under 5,000 characters')

// POST add note
export const addInboxNoteDto = z.object({
  inboxItemId: z.uuid(),
  text: inboxNoteTextSchema,
  expectedCommandRevision: commandRevisionSchema,
})

export const addInboxNoteFormDto = addInboxNoteDto.pick({ text: true })

const feedbackHandlingCommandDto = z.object({
  inboxItemId: z.uuid(),
  outcome: feedbackHandlingOutcomeSchema,
  internalNote: feedbackHandlingInternalNoteTextSchema.nullable().optional(),
  expectedCommandRevision: commandRevisionSchema,
  expectedCycleNumber: handlingRevisionSchema,
  expectedSourceRevision: handlingRevisionSchema,
  expectedStateRevision: handlingRevisionSchema,
})

// POST source-specific close for private feedback. A manager must choose one
// outcome; the optional note is an internal-only fact and never guest-facing.
export const markFeedbackHandledDto = feedbackHandlingCommandDto

export const feedbackHandlingDecisionDto = z.object({
  outcome: feedbackHandlingOutcomeSchema,
  internalNote: feedbackHandlingInternalNoteTextSchema,
})

// POST correction for an already-recorded outcome. The current outcome fact
// is fenced explicitly so corrections append a single superseding revision.
export const correctFeedbackHandlingOutcomeDto = feedbackHandlingCommandDto.extend({
  expectedOutcomeId: z.uuid(),
  expectedOutcomeRevision: handlingRevisionSchema,
})

// GET last-visit count (open items since last visit)
export const getLastVisitCountDto = z.object({})

// POST stamp last-visit (called on inbox page load)
export const stampLastInboxViewDto = z.object({
  responseCutoff: z.coerce.date(),
})

// GET inbox item detail
export const getInboxItemDetailDto = z.object({
  inboxItemId: z.uuid(),
})

const responseTargetDurationMinutesSchema = z.number().int().min(1).max(43_200)

export const getResponseTargetPolicySettingsDto = z.object({
  propertyId: z.uuid().optional(),
})

export const getPrivateFeedbackTargetAnalyticsDto = z.object({
  propertyId: z.uuid().optional(),
})

export const setResponseTargetPolicyDto = z.discriminatedUnion('scope', [
  z.object({
    scope: z.literal('organization'),
    targetKind: z.enum(['google_review_response', 'private_feedback_handling']),
    durationMinutes: responseTargetDurationMinutesSchema,
    expectedPolicyVersion: z.number().int().positive().nullable(),
  }),
  z.object({
    scope: z.literal('property'),
    propertyId: z.uuid(),
    targetKind: z.literal('private_feedback_handling').optional(),
    durationMinutes: responseTargetDurationMinutesSchema.nullable(),
    expectedPolicyVersion: z.number().int().positive().nullable(),
  }),
])

export const organizationResponseTargetFormDto = z.object({
  durationHours: z.number().int().min(1).max(720),
})

export const privateFeedbackPropertyTargetFormDto = z
  .object({
    useOrganizationTarget: z.boolean(),
    durationHours: z.number().int().min(1).max(720),
  })
  .strict()

// GET inbox notes
export const getInboxNotesDto = z.object({
  inboxItemId: z.uuid(),
})

// GET inbox item Handling History (IBX-01-T5). Validated at the boundary so a
// non-UUID id is rejected before the use case, and therefore before any store.
export const getInboxItemHistoryDto = z.object({
  inboxItemId: z.uuid(),
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
export type MarkFeedbackHandledDtoInput = z.infer<typeof markFeedbackHandledDto>
export type CorrectFeedbackHandlingOutcomeDtoInput = z.infer<
  typeof correctFeedbackHandlingOutcomeDto
>
export type SetResponseTargetPolicyDtoInput = z.infer<typeof setResponseTargetPolicyDto>
