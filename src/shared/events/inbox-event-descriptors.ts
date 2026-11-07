import { z } from 'zod/v4'
import type { EventDescriptor } from './descriptor'
import { inboxActorShape } from './inbox-item-event-schemas'
import { databaseUuidSchema } from './reply-publication-cancelled-schema'

// ── Inbox event schemas ─────────────────────────────────────────────

const inboxItemCreatedSchema = z.object({
  inboxItemId: z.string(),
  organizationId: z.string(),
  propertyId: z.string().nullable().optional(),
  reviewId: z.string().optional(),
  sourceType: z.string().optional(),
  sourceId: z.string().optional(),
})

const inboxItemStatusChangedSchema = z.object({
  inboxItemId: z.string(),
  organizationId: z.string(),
  propertyId: z.string().nullable().optional(),
  oldStatus: z.string(),
  newStatus: z.string(),
  userId: z.string().nullable().optional(),
  source: z.string().optional(),
  occurredAt: z.string().optional(),
})

// BQC-3.4: the six schemas below are corrected IN PLACE at version 1 — no
// version bump. Justification: they never successfully recorded (every
// insert would have thrown invalid_payload against the producer payloads)
// and the inbox use-case wiring never passed outboxRepo, so zero historical
// rows exist for these types. The two compatible inbox schemas
// (inbox_item.created, inbox_item.status_changed) are unchanged.

// `inboxActorShape` and the escalation and priority facts are in
// ./inbox-item-event-schemas.ts.
const inboxNoteAddedSchema = z.object({
  inboxItemId: z.string(),
  noteId: z.string(),
  organizationId: z.string(),
  ...inboxActorShape,
})

// Per-item shape — one event per affected item, linked by bulkId (the
// Recent Activity groups per-item entries via payload.bulkId).
const inboxItemBulkStatusChangedSchema = z.object({
  inboxItemId: z.string(),
  organizationId: z.string(),
  oldStatus: z.string(),
  newStatus: z.string(),
  bulkId: z.string(),
  userId: z.string().nullable().optional(),
  propertyId: z.string().nullable().optional(),
  source: z.string().optional(),
  occurredAt: z.string().optional(),
})

// One release of a departing or newly ineligible member's assignments:
// identifiers, a closed reason and a count. No item content of any kind.
const inboxAssignmentsReleasedSchema = z.object({
  organizationId: z.string(),
  userId: z.string().nullable(),
  releasedFrom: z.string(),
  releaseReason: z.enum(['member_offboarded', 'member_became_ineligible']),
  releases: z
    .array(
      z.object({
        propertyId: z.string(),
        anchorInboxItemId: z.string(),
        count: z.number().int().min(1),
      }),
    )
    .min(1),
  count: z.number().int().min(1),
  occurredAt: z.string().optional(),
})

const inboxBulkAssignmentCompletedSchema = z.object({
  organizationId: z.string(),
  userId: z.string(),
  bulkId: z.string(),
  transitions: z
    .array(
      z.object({
        inboxItemId: z.string(),
        propertyId: z.string(),
        previousAssignee: z.string().nullable(),
        nextAssignee: z.string().nullable(),
      }),
    )
    .min(1)
    .max(100),
  count: z.number().int().min(1).max(100),
  source: z.literal('web'),
  occurredAt: z.string().optional(),
})

const inboxBulkReopenCompletedSchema = z.object({
  organizationId: z.string(),
  userId: z.string(),
  bulkId: z.string(),
  reopened: z
    .array(
      z.object({
        inboxItemId: databaseUuidSchema,
        propertyId: databaseUuidSchema,
        sourceType: z.enum(['review', 'feedback']),
        sourceId: databaseUuidSchema,
        cycleNumber: z.number().int().positive().safe(),
        sourceRevision: z.number().int().positive().safe(),
        stateRevision: z.number().int().positive().safe(),
      }),
    )
    .min(1)
    .max(100),
  count: z.number().int().min(1).max(100),
  source: z.literal('web'),
  occurredAt: z.string().optional(),
})

const handlingCycleFactScopeSchema = z.object({
  inboxItemId: databaseUuidSchema,
  cycleNumber: z.number().int().positive().safe(),
  stateRevision: z.number().int().positive().safe(),
  organizationId: z.string().trim().min(1),
  propertyId: databaseUuidSchema,
  sourceType: z.enum(['review', 'feedback']),
  sourceId: databaseUuidSchema,
  sourceRevision: z.number().int().positive().safe(),
  actorType: z.enum(['user', 'guest', 'provider', 'system']),
  userId: z.string().trim().min(1).nullable(),
  triggerEventId: z.string().trim().min(1).nullable(),
  source: z.enum(['web', 'import']),
  occurredAt: z.iso.datetime(),
})

const inboxHandlingCycleOpenedSchema = handlingCycleFactScopeSchema
  .extend({
    openReason: z.enum([
      'legacy_backfill',
      'review_observed',
      'feedback_submitted',
      'material_revision_changed',
      'provider_reply_deleted',
      'provider_reply_diverged',
    ]),
    // True when the command that created the item opened this cycle.
    // Optional: facts recorded before the mark existed lack it.
    openedWithItem: z.boolean().optional(),
  })
  .refine((value) => (value.actorType === 'user') === (value.userId !== null), {
    message: 'Handling Cycle actor attribution is invalid',
  })

const inboxHandlingCycleClosedSchema = handlingCycleFactScopeSchema
  .extend({
    closeReason: z.enum([
      'confirmed_on_google',
      'external_reply_observed',
      'guest_withdrawn',
      'private_feedback_handled',
      'source_ineligible',
      'superseded_by_source_revision',
    ]),
  })
  .refine((value) => (value.actorType === 'user') === (value.userId !== null), {
    message: 'Handling Cycle actor attribution is invalid',
  })

const inboxHandlingCycleReopenedSchema = handlingCycleFactScopeSchema
  .extend({
    reopenReason: z.enum([
      'guest_follow_up_still_needed',
      'internal_follow_up_still_needed',
      'new_information',
      'correcting_handling_status',
      'other',
      'provider_reply_deleted',
      'provider_reply_diverged',
      // A guest edit of an answered Review: the old reply does not answer
      // the new revision, so the closed item is open again.
      'material_revision_changed',
    ]),
    // Set when a bulk reopen owns the notice through its completion fact.
    // Optional: facts recorded before bulk reopens were marked lack it.
    bulkId: z.string().trim().min(1).nullable().optional(),
  })
  .refine((value) => (value.actorType === 'user') === (value.userId !== null), {
    message: 'Handling Cycle actor attribution is invalid',
  })

const inboxResponseTargetReminderDueSchema = z.object({
  inboxItemId: databaseUuidSchema,
  cycleNumber: z.number().int().positive().safe(),
  organizationId: z.string().trim().min(1).max(255),
  propertyId: databaseUuidSchema,
  targetKind: z.enum(['google_review_response', 'private_feedback_handling']),
  reminderKind: z.enum(['halfway', 'target_passed']),
  scheduledFor: z.iso.datetime(),
  userId: z.null(),
  source: z.literal('import'),
  occurredAt: z.iso.datetime(),
})

const inboxResponseTargetPolicyChangedSchema = z
  .object({
    organizationId: z.string().trim().min(1).max(255),
    propertyId: databaseUuidSchema.nullable(),
    targetKind: z.enum(['google_review_response', 'private_feedback_handling']),
    policyScope: z.enum(['organization', 'property']),
    durationMinutes: z.number().int().min(1).max(43_200).nullable(),
    policyVersion: z.number().int().positive().safe(),
    userId: z.string().trim().min(1).max(255),
    source: z.literal('web'),
    occurredAt: z.iso.datetime(),
  })
  .superRefine((value, ctx) => {
    if ((value.policyScope === 'organization') !== (value.propertyId === null)) {
      ctx.addIssue({
        code: 'custom',
        message: 'Response Target policy scope is invalid',
      })
    }
    if (
      value.policyScope === 'property' &&
      value.targetKind !== 'private_feedback_handling'
    ) {
      ctx.addIssue({
        code: 'custom',
        message: 'Google Review Response Target has no Property policy scope',
      })
    }
    if (value.policyScope === 'organization' && value.durationMinutes === null) {
      ctx.addIssue({
        code: 'custom',
        message: 'Organization Response Target policy requires a duration',
      })
    }
  })

export const inboxEventDescriptors = [
  {
    type: 'inbox.inbox_item.created',
    // Earlier v1 writers identified Review-backed items by their Review.
    aggregate: (payload, eventId) => {
      if (payload.reviewId != null)
        return { type: 'review', id: String(payload.reviewId) }
      return payload.inboxItemId != null
        ? { type: 'inbox_item', id: String(payload.inboxItemId) }
        : { type: 'event', id: eventId }
    },
    version: 1,
    schema: inboxItemCreatedSchema,
  },
  {
    type: 'inbox.inbox_item.status_changed',
    aggregate: { type: 'inbox_item', id: 'inboxItemId' },
    version: 1,
    schema: inboxItemStatusChangedSchema,
  },
  {
    type: 'inbox.inbox_note.added',
    aggregate: { type: 'inbox_item', id: 'inboxItemId' },
    version: 1,
    schema: inboxNoteAddedSchema,
  },
  {
    type: 'inbox.inbox_item.bulk_status_changed',
    aggregate: { type: 'inbox_item', id: 'inboxItemId' },
    version: 1,
    schema: inboxItemBulkStatusChangedSchema,
  },
  {
    type: 'inbox.inbox_items.bulk_assignment_completed',
    aggregate: { type: 'user', id: 'userId' },
    version: 1,
    schema: inboxBulkAssignmentCompletedSchema,
  },
  {
    type: 'inbox.inbox_items.assignments_released',
    aggregate: { type: 'user', id: 'userId' },
    version: 1,
    schema: inboxAssignmentsReleasedSchema,
  },
  {
    type: 'inbox.inbox_items.bulk_reopen_completed',
    aggregate: { type: 'user', id: 'userId' },
    version: 1,
    schema: inboxBulkReopenCompletedSchema,
  },
  {
    type: 'inbox.handling_cycle.opened',
    aggregate: { type: 'inbox_item', id: 'inboxItemId' },
    version: 1,
    schema: inboxHandlingCycleOpenedSchema,
  },
  {
    type: 'inbox.handling_cycle.closed',
    aggregate: { type: 'inbox_item', id: 'inboxItemId' },
    version: 1,
    schema: inboxHandlingCycleClosedSchema,
  },
  {
    type: 'inbox.handling_cycle.reopened',
    aggregate: { type: 'inbox_item', id: 'inboxItemId' },
    version: 1,
    schema: inboxHandlingCycleReopenedSchema,
  },
  {
    type: 'inbox.response_target.reminder_due',
    aggregate: { type: 'inbox_item', id: 'inboxItemId' },
    version: 1,
    schema: inboxResponseTargetReminderDueSchema,
  },
  {
    type: 'inbox.response_target.policy_changed',
    aggregate: (payload, eventId) => {
      if (payload.propertyId != null)
        return { type: 'property', id: String(payload.propertyId) }
      return payload.userId != null
        ? { type: 'user', id: String(payload.userId) }
        : { type: 'event', id: eventId }
    },
    version: 1,
    schema: inboxResponseTargetPolicyChangedSchema,
  },
] as const satisfies readonly EventDescriptor[]
