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

// BQC-3.4: the six schemas below are corrected IN PLACE at version 1 — no
// version bump. Justification: they never successfully recorded (every
// insert would have thrown invalid_payload against the producer payloads)
// and the inbox use-case wiring never passed outboxRepo, so zero historical
// rows exist for these types. The two compatible inbox schemas
// (inbox_item.created, inbox_item.status_changed) are unchanged.

const inboxItemEscalatedSchema = z.object({
  inboxItemId: z.string(),
  organizationId: z.string(),
  userId: z.string(),
  propertyId: z.string().nullable().optional(),
  source: z.string().optional(),
  occurredAt: z.string().optional(),
})

const inboxItemEscalationResolvedSchema = z.object({
  inboxItemId: z.string(),
  organizationId: z.string(),
  userId: z.string(),
  propertyId: z.string().nullable().optional(),
  source: z.string().optional(),
  occurredAt: z.string().optional(),
})

const inboxNoteAddedSchema = z.object({
  inboxItemId: z.string(),
  noteId: z.string(),
  organizationId: z.string(),
  userId: z.string(),
  propertyId: z.string().nullable().optional(),
  source: z.string().optional(),
  occurredAt: z.string().optional(),
})

const inboxItemAssignedSchema = z.object({
  inboxItemId: z.string(),
  organizationId: z.string(),
  assignedTo: z.string(),
  propertyId: z.string().nullable().optional(),
  userId: z.string().optional(),
  source: z.string().optional(),
  occurredAt: z.string().optional(),
})

const inboxItemUnassignedSchema = z.object({
  inboxItemId: z.string(),
  organizationId: z.string(),
  previousAssignee: z.string(),
  propertyId: z.string().nullable().optional(),
  userId: z.string().nullable().optional(),
  source: z.string().optional(),
  occurredAt: z.string().optional(),
})

// Per-item shape — one event per affected item, linked by bulkId (the
// activity log groups per-item entries via payload.bulkId).
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

// ── Metric event schemas ────────────────────────────────────────────

// BQC-3.5: corrected IN PLACE at version 1 — no version bump. Justification:
// buildMetricContext never forwarded outboxRepo to recordMetric, so
// emitAndRecord short-circuited after the bus emit and zero historical
// outbox rows exist for metric.recorded; and had it been wired, every insert
// would have thrown invalid_payload — the registered schema required
// `recordedAt` while the domain event (and its consumers) carry
// `occurredAt`. Now recorded atomically via the metric command store.
const metricRecordedSchema = z.object({
  organizationId: z.string(),
  propertyId: z.string(),
  metricKey: z.string(),
  value: z.number(),
  occurredAt: z.string(),
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

// BQC-3.5: registered so the orphan audit facts record with their state
// (never registered before → zero historical rows; additive at v1).
const propertyUpdatedSchema = z.object({
  propertyId: z.string(),
  organizationId: z.string(),
  name: z.string(),
  slug: z.string(),
})

const propertyDeletedSchema = z.object({
  propertyId: z.string(),
  organizationId: z.string(),
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

// BQC-3.5: staff schemas corrected IN PLACE at version 1 — no version bump.
// Justification: they never successfully recorded — the producer payloads
// carry assignmentId/userId/portalId (NO staffId), so every insert would
// have thrown invalid_payload, and the staff build never passed outboxRepo.
// Zero historical rows exist for these types. The activity consumer reads
// assignmentId/propertyId/organizationId/userId — domain side wins.
const staffAssignedSchema = z.object({
  assignmentId: z.string(),
  organizationId: z.string(),
  userId: z.string(),
  propertyId: z.string(),
  teamId: z.string().nullable().optional(),
  portalId: z.string().nullable().optional(),
})

const staffUnassignedSchema = z.object({
  assignmentId: z.string(),
  organizationId: z.string(),
  userId: z.string(),
  propertyId: z.string(),
  portalId: z.string().nullable().optional(),
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

// BQC-3.5: memberRoleChangedSchema gains `memberUserId` IN PLACE at version 1.
// Justification: the identity use-case wiring never passed outboxRepo, so
// these events only ever emitted on the bus — zero historical outbox rows
// exist for any identity type. The activity consumer reads
// event.memberUserId as the audit resourceId (the TARGET); the schema
// previously kept only userId (the ACTOR) and silently stripped the target.
const memberRoleChangedSchema = z.object({
  organizationId: z.string(),
  userId: z.string(),
  memberUserId: z.string(),
  previousRole: z.string(),
  newRole: z.string(),
})

// BQC-3.5: registered so the registration path records the audit fact
// (orphan event — no consumers; the fact is the trail). Same zero-row
// justification as above: never wired, never recorded.
const organizationCreatedSchema = z.object({
  organizationId: z.string(),
  organizationName: z.string(),
  slug: z.string(),
  ownerId: z.string(),
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

// BQC-3.5: connected/disconnected/visibility_changed were never registered,
// so the outbox adapter silently skipped them (bus-only). Registered with
// identifier-only allowlists so the atomic command store can record them —
// zero historical rows existed. googleEmail is deliberately NOT allowlisted
// (provider identity stays out of the durable trail).
const googleAccountConnectedSchema = z.object({
  connectionId: z.string(),
  organizationId: z.string(),
})

const googleAccountDisconnectedSchema = z.object({
  connectionId: z.string(),
  organizationId: z.string(),
})

const connectionVisibilityChangedSchema = z.object({
  connectionId: z.string(),
  organizationId: z.string(),
  visibility: z.string(),
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
  registerEventSchema({
    type: 'property.updated',
    version: EVENT_VERSION,
    schema: propertyUpdatedSchema,
  })
  registerEventSchema({
    type: 'property.deleted',
    version: EVENT_VERSION,
    schema: propertyDeletedSchema,
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
    schema: staffAssignedSchema,
  })
  registerEventSchema({
    type: 'staff.unassigned',
    version: EVENT_VERSION,
    schema: staffUnassignedSchema,
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
  registerEventSchema({
    type: 'identity.organization.created',
    version: EVENT_VERSION,
    schema: organizationCreatedSchema,
  })

  // Integration events
  registerEventSchema({
    type: 'integration.property_import.completed',
    version: EVENT_VERSION,
    schema: propertyImportCompletedSchema,
  })
  registerEventSchema({
    type: 'integration.google_account.connected',
    version: EVENT_VERSION,
    schema: googleAccountConnectedSchema,
  })
  registerEventSchema({
    type: 'integration.google_account.disconnected',
    version: EVENT_VERSION,
    schema: googleAccountDisconnectedSchema,
  })
  registerEventSchema({
    type: 'integration.google_connection.visibility_changed',
    version: EVENT_VERSION,
    schema: connectionVisibilityChangedSchema,
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
