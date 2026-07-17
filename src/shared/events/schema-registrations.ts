// Event schema registrations for the outbox (PRE17A A4).
//
// Registers Zod schemas for all domain event types that flow through the
// transactional outbox. Payloads are identifier-only (ADR 0030): no review
// text, reviewer identity, reply text, prompt content, or provider output.
//
// Events that previously carried content (review.created, review.updated,
// inbox.inbox_item.created, inbox.inbox_note.added, review.reply.rejected)
// are slimmed to identifiers — consumers re-fetch via lookup ports.
//
// Orphan events (15 of 40 — emitted but never consumed) are NOT registered.
// They will be removed from producers in a follow-up cleanup.

import { z } from 'zod'
import { registerEventSchema } from './schema-registry'

// ── Review event schemas ────────────────────────────────────────────

// BQR-2.5: schemas match domain event field names after denylist strip
// (not legacy googleReviewId / previousStatus aliases).
// BQC-1.2: no rating — identifier-only payloads; rating resolves via
// authorized read at consume time.

const reviewCreatedSchema = z.object({
  reviewId: z.string(),
  organizationId: z.string(),
  propertyId: z.string(),
  externalId: z.string(),
  platform: z.string().optional(),
  occurredAt: z.string().optional(),
})

const reviewUpdatedSchema = reviewCreatedSchema

const reviewExpiredSchema = z.object({
  reviewId: z.string(),
  organizationId: z.string(),
  propertyId: z.string(),
  occurredAt: z.string().optional(),
})

const replyEventSchema = z.object({
  replyId: z.string(),
  reviewId: z.string(),
  organizationId: z.string(),
  propertyId: z.string(),
  userId: z.string().nullable().optional(),
  authorId: z.string().nullable().optional(),
  source: z.string().optional(),
  occurredAt: z.string().optional(),
})

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

const inboxItemEscalatedSchema = z.object({
  inboxItemId: z.string(),
  organizationId: z.string(),
  propertyId: z.string(),
  escalatedBy: z.string(),
})

const inboxItemEscalationResolvedSchema = z.object({
  inboxItemId: z.string(),
  organizationId: z.string(),
  propertyId: z.string(),
  resolvedBy: z.string(),
})

const inboxNoteAddedSchema = z.object({
  inboxItemId: z.string(),
  noteId: z.string(),
  organizationId: z.string(),
  propertyId: z.string(),
  authorId: z.string(),
})

const inboxItemAssignedSchema = z.object({
  inboxItemId: z.string(),
  organizationId: z.string(),
  propertyId: z.string(),
  staffId: z.string(),
})

const inboxItemUnassignedSchema = z.object({
  inboxItemId: z.string(),
  organizationId: z.string(),
  propertyId: z.string(),
  staffId: z.string(),
})

const inboxItemBulkStatusChangedSchema = z.object({
  organizationId: z.string(),
  propertyId: z.string(),
  inboxItemIds: z.array(z.string()),
  previousStatus: z.string(),
  newStatus: z.string(),
})

// ── Metric event schemas ────────────────────────────────────────────

const metricRecordedSchema = z.object({
  organizationId: z.string(),
  propertyId: z.string(),
  metricKey: z.string(),
  value: z.number(),
  recordedAt: z.string(),
})

// ── Property event schemas ──────────────────────────────────────────

const propertyCreatedSchema = z.object({
  propertyId: z.string(),
  organizationId: z.string(),
  name: z.string(),
  slug: z.string(),
  gbpPlaceId: z.string().optional(),
  googleConnectionId: z.string().optional(),
})

// ── Guest event schemas ─────────────────────────────────────────────

const guestScanSchema = z.object({
  organizationId: z.string(),
  propertyId: z.string(),
  portalId: z.string(),
})

const guestRatingSchema = z.object({
  organizationId: z.string(),
  propertyId: z.string(),
  portalId: z.string(),
  rating: z.number().int().min(1).max(5),
})

const guestFeedbackSchema = z.object({
  organizationId: z.string(),
  propertyId: z.string(),
  portalId: z.string(),
  feedbackId: z.string(),
})

// ── Goal event schemas ──────────────────────────────────────────────

const goalCompletedSchema = z.object({
  goalId: z.string(),
  organizationId: z.string(),
  propertyId: z.string(),
  completedValue: z.number(),
  targetValue: z.number(),
})

// ── Team/Staff event schemas ────────────────────────────────────────

const teamEventSchema = z.object({
  teamId: z.string(),
  organizationId: z.string(),
  propertyId: z.string(),
})

const staffEventSchema = z.object({
  staffId: z.string(),
  organizationId: z.string(),
  propertyId: z.string(),
  teamId: z.string().optional(),
})

// ── Identity event schemas ──────────────────────────────────────────

const memberInvitedSchema = z.object({
  invitationId: z.string(),
  organizationId: z.string(),
  email: z.string(),
  role: z.string(),
})

const invitationAcceptedSchema = z.object({
  organizationId: z.string(),
  userId: z.string(),
  invitationId: z.string(),
})

const invitationCanceledSchema = z.object({
  invitationId: z.string(),
  organizationId: z.string(),
})

const memberRemovedSchema = z.object({
  organizationId: z.string(),
  userId: z.string(),
})

const memberRoleChangedSchema = z.object({
  organizationId: z.string(),
  userId: z.string(),
  previousRole: z.string(),
  newRole: z.string(),
})

// ── Integration event schemas ───────────────────────────────────────

const propertyImportCompletedSchema = z.object({
  importJobId: z.string(),
  organizationId: z.string(),
  totalCount: z.number(),
  importedCount: z.number(),
  skippedCount: z.number(),
  failedCount: z.number(),
})

// ── Portal event schemas (only consumed ones) ───────────────────────

const portalDeletedSchema = z.object({
  portalId: z.string(),
  organizationId: z.string(),
  propertyId: z.string(),
})

const portalGroupDeletedSchema = z.object({
  portalGroupId: z.string(),
  organizationId: z.string(),
  propertyId: z.string(),
})

// ── Registration ────────────────────────────────────────────────────

const EVENT_VERSION = 1

/**
 * Register all outbox event schemas. Called once during application startup
 * (before the relay or dispatcher starts processing events).
 */
export function registerAllEventSchemas(): void {
  // Review events
  registerEventSchema({
    type: 'review.created',
    version: EVENT_VERSION,
    schema: reviewCreatedSchema,
  })
  registerEventSchema({
    type: 'review.updated',
    version: EVENT_VERSION,
    schema: reviewUpdatedSchema,
  })
  registerEventSchema({
    type: 'review.expired',
    version: EVENT_VERSION,
    schema: reviewExpiredSchema,
  })
  registerEventSchema({
    type: 'review.reply.submitted',
    version: EVENT_VERSION,
    schema: replyEventSchema,
  })
  registerEventSchema({
    type: 'review.reply.approved',
    version: EVENT_VERSION,
    schema: replyEventSchema,
  })
  registerEventSchema({
    type: 'review.reply.rejected',
    version: EVENT_VERSION,
    schema: replyEventSchema,
  })
  registerEventSchema({
    type: 'review.reply.published',
    version: EVENT_VERSION,
    schema: replyEventSchema,
  })
  registerEventSchema({
    type: 'review.reply.publish_failed',
    version: EVENT_VERSION,
    schema: replyEventSchema,
  })

  // Inbox events
  registerEventSchema({
    type: 'inbox.inbox_item.created',
    version: EVENT_VERSION,
    schema: inboxItemCreatedSchema,
  })
  registerEventSchema({
    type: 'inbox.inbox_item.status_changed',
    version: EVENT_VERSION,
    schema: inboxItemStatusChangedSchema,
  })
  registerEventSchema({
    type: 'inbox.inbox_item.escalated',
    version: EVENT_VERSION,
    schema: inboxItemEscalatedSchema,
  })
  registerEventSchema({
    type: 'inbox.inbox_item.escalation_resolved',
    version: EVENT_VERSION,
    schema: inboxItemEscalationResolvedSchema,
  })
  registerEventSchema({
    type: 'inbox.inbox_note.added',
    version: EVENT_VERSION,
    schema: inboxNoteAddedSchema,
  })
  registerEventSchema({
    type: 'inbox.inbox_item.assigned',
    version: EVENT_VERSION,
    schema: inboxItemAssignedSchema,
  })
  registerEventSchema({
    type: 'inbox.inbox_item.unassigned',
    version: EVENT_VERSION,
    schema: inboxItemUnassignedSchema,
  })
  registerEventSchema({
    type: 'inbox.inbox_item.bulk_status_changed',
    version: EVENT_VERSION,
    schema: inboxItemBulkStatusChangedSchema,
  })

  // Metric events
  registerEventSchema({
    type: 'metric.recorded',
    version: EVENT_VERSION,
    schema: metricRecordedSchema,
  })

  // Property events (only consumed ones — created triggers inbox/metric/notification)
  registerEventSchema({
    type: 'property.created',
    version: EVENT_VERSION,
    schema: propertyCreatedSchema,
  })

  // Guest events (consumed by metric)
  registerEventSchema({
    type: 'guest.scanned',
    version: EVENT_VERSION,
    schema: guestScanSchema,
  })
  registerEventSchema({
    type: 'guest.rated',
    version: EVENT_VERSION,
    schema: guestRatingSchema,
  })
  registerEventSchema({
    type: 'guest.feedback_submitted',
    version: EVENT_VERSION,
    schema: guestFeedbackSchema,
  })

  // Goal events
  registerEventSchema({
    type: 'goal.completed',
    version: EVENT_VERSION,
    schema: goalCompletedSchema,
  })

  // Team/Staff events (consumed by activity)
  registerEventSchema({
    type: 'team.created',
    version: EVENT_VERSION,
    schema: teamEventSchema,
  })
  registerEventSchema({
    type: 'team.updated',
    version: EVENT_VERSION,
    schema: teamEventSchema,
  })
  registerEventSchema({
    type: 'team.deleted',
    version: EVENT_VERSION,
    schema: teamEventSchema,
  })
  registerEventSchema({
    type: 'staff.assigned',
    version: EVENT_VERSION,
    schema: staffEventSchema,
  })
  registerEventSchema({
    type: 'staff.unassigned',
    version: EVENT_VERSION,
    schema: staffEventSchema,
  })

  // Identity events (consumed by activity)
  registerEventSchema({
    type: 'identity.member.invited',
    version: EVENT_VERSION,
    schema: memberInvitedSchema,
  })
  registerEventSchema({
    type: 'identity.invitation.accepted',
    version: EVENT_VERSION,
    schema: invitationAcceptedSchema,
  })
  registerEventSchema({
    type: 'identity.invitation.canceled',
    version: EVENT_VERSION,
    schema: invitationCanceledSchema,
  })
  registerEventSchema({
    type: 'identity.member.removed',
    version: EVENT_VERSION,
    schema: memberRemovedSchema,
  })
  registerEventSchema({
    type: 'identity.member.role_changed',
    version: EVENT_VERSION,
    schema: memberRoleChangedSchema,
  })

  // Integration events
  registerEventSchema({
    type: 'integration.property_import.completed',
    version: EVENT_VERSION,
    schema: propertyImportCompletedSchema,
  })

  // Portal events (only consumed ones)
  registerEventSchema({
    type: 'portal.deleted',
    version: EVENT_VERSION,
    schema: portalDeletedSchema,
  })
  registerEventSchema({
    type: 'portal_group.deleted',
    version: EVENT_VERSION,
    schema: portalGroupDeletedSchema,
  })
}
