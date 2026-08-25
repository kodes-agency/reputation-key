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
import { registerEventSchema, isEventRegistered } from './schema-registry'

// ── Review event schemas ────────────────────────────────────────────

// BQR-2.5: schemas match domain event field names after denylist strip
// (not legacy googleReviewId / previousStatus aliases).
// BQC-1.2: no rating — identifier-only payloads; rating resolves via
// authorized read at consume time.

const reviewCreatedSchema = z.object({
  reviewId: z.string(),
  organizationId: z.string(),
  propertyId: z.string(),
  platform: z.string().optional(),
  sourceEpoch: z.number().int().nonnegative().default(0),
  sourceRevision: z.number().int().positive(),
  analysisSequence: z.number().int().positive(),
  occurredAt: z.string().optional(),
})

const reviewUpdatedSchema = reviewCreatedSchema

const reviewExpiredSchema = z.object({
  reviewId: z.string(),
  organizationId: z.string(),
  propertyId: z.string(),
  occurredAt: z.string().optional(),
})

const reviewSourceTransitionedSchema = z.object({
  reviewId: z.string(),
  organizationId: z.string(),
  propertyId: z.string(),
  sourceEpoch: z.number().int().nonnegative(),
  sourceRevision: z.number().int().positive(),
  analysisSequence: z.number().int().positive(),
  change: z.enum(['source_expired', 'provider_deleted']),
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

// BQC-3.8: publication cancellation — identifier-only (reply/review/property/
// org + cause). No reply text, no actor content.
const replyPublicationCancelledSchema = z.object({
  replyId: z.string(),
  reviewId: z.string(),
  organizationId: z.string(),
  propertyId: z.string(),
  cause: z.enum(['disconnect', 'policy']),
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
  readingId: z.string(),
  organizationId: z.string(),
  propertyId: z.string(),
  portalId: z.string().nullable(),
  portalGroupId: z.string().nullable(),
  definitionVersionId: z.string(),
  sourceEventId: z.string(),
  sourcePolicy: z.string(),
  metricKey: z.string(),
  value: z.number(),
  numerator: z.number().nullable(),
  denominator: z.number().nullable(),
  sampleCount: z.number().int().nonnegative(),
  attributionQuality: z.string(),
  permittedConsumers: z.array(z.string()),
  occurredAt: z.string(),
})

const metricCorrectedSchema = z.object({
  correctionId: z.string(),
  correctedReadingId: z.string(),
  replacementReadingId: z.string().nullable(),
  organizationId: z.string(),
  propertyId: z.string(),
  definitionVersionId: z.string(),
  sourceEventId: z.string(),
  supersededSourceEventId: z.string(),
  occurredAt: z.string(),
})

// ── Property event schemas ──────────────────────────────────────────

const propertyCreatedSchema = z.object({
  propertyId: z.string(),
  organizationId: z.string(),
  name: z.string(),
  slug: z.string(),
  // BQC-4.1: content-free routing fact (ADR 0048) — durable evidence of the
  // region the property was created with.
  processingRegion: z.string().optional(),
  dataCellId: z.enum(['us', 'europe', 'global']).optional(),
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

const propertyResponsibilityNeededSchema = z.object({
  propertyId: z.string(),
  organizationId: z.string(),
  occurredAt: z.string().datetime(),
})

const propertyGoogleBindingChangedSchema = z
  .object({
    _tag: z.literal('property.google_binding.changed').optional(),
    eventId: z.string().optional(),
    correlationId: z.string().nullable().optional(),
    occurredAt: z.string().optional(),
    organizationId: z.string(),
    propertyId: z.string(),
    connectionId: z.string(),
    sourceEpoch: z.number().int().nonnegative(),
    change: z.enum(['created', 'relinked', 'disconnected', 'deletion_started']),
  })
  .strict()
  .transform(({ organizationId, propertyId, connectionId, sourceEpoch, change }) => ({
    organizationId,
    propertyId,
    connectionId,
    sourceEpoch,
    change,
  }))

const integrationPropertyImportRetentionReleasedSchema = z
  .object({
    _tag: z.literal('integration.property_import.retention_released').optional(),
    eventId: z.string().optional(),
    correlationId: z.string().nullable().optional(),
    occurredAt: z.string().optional(),
    organizationId: z.string(),
    // Optional for v1 compatibility with already-enqueued release facts.
    // Every new producer supplies it so the durable envelope has a stable
    // import aggregate rather than falling back to the event ID.
    importJobId: z.uuid().optional(),
    idempotencyKeys: z.array(z.uuid()).min(1).max(100),
  })
  .strict()
  .transform(({ organizationId, importJobId, idempotencyKeys }) => ({
    organizationId,
    ...(importJobId ? { importJobId } : {}),
    idempotencyKeys,
  }))
const aiPropertyTrendGenerationRequestedSchema = z.object({
  scheduleId: z.uuid(),
  organizationId: z.string().min(1),
  propertyId: z.uuid(),
  occurredAt: z.string(),
})
// Envelope metadata is reattached after producer-side allowlist validation
// and stripped again during consumer-side validation.
// Operator review-analysis backfill (ops:ai-reanalyze). Identifier-only, and
// the same field set the AI review consumer already validates — `analysisSequence`
// is the FRESH sequence allocated for the replay, not the review's stored one.
// Not `.strict()`, matching the review event schemas: the outbox re-attaches
// `correlationId` after allowlist validation and the dispatcher re-runs this
// same schema on delivery.
const aiReviewAnalysisBackfillRequestedSchema = z.object({
  reviewId: z.string(),
  organizationId: z.string(),
  propertyId: z.string(),
  sourceEpoch: z.number().int().nonnegative(),
  sourceRevision: z.number().int().positive(),
  analysisSequence: z.number().int().positive(),
  occurredAt: z.string(),
})
const integrationPropertyImportRequestedSchema = z
  .object({
    _tag: z.literal('integration.property_import.requested').optional(),
    eventId: z.string().optional(),
    correlationId: z.string().nullable().optional(),
    occurredAt: z.string().optional(),
    organizationId: z.string(),
    importJobId: z.uuid(),
  })
  .strict()
  .transform(({ organizationId, importJobId }) => ({
    organizationId,
    importJobId,
  }))

// ── Guest event schemas ─────────────────────────────────────────────

const guestScanSchema = z.object({
  scanId: z.string(),
  organizationId: z.string(),
  propertyId: z.string(),
  portalId: z.string(),
  source: z.enum(['qr', 'nfc', 'direct']),
  occurredAt: z.string(),
})

const guestRatingSchema = z.object({
  ratingId: z.string(),
  organizationId: z.string(),
  propertyId: z.string(),
  portalId: z.string(),
  value: z.number().int().min(1).max(5),
  supersedesSourceEventId: z.string().min(1).nullable().optional(),
  occurredAt: z.string(),
})

const guestRatingRetractedSchema = z.object({
  ratingId: z.string(),
  organizationId: z.string(),
  propertyId: z.string(),
  portalId: z.string(),
  supersedesSourceEventId: z.string().min(1),
  occurredAt: z.string(),
})

const guestFeedbackSchema = z.object({
  feedbackId: z.string(),
  organizationId: z.string(),
  propertyId: z.string(),
  portalId: z.string(),
  ratingId: z.string().nullable(),
  occurredAt: z.string(),
})

const guestFeedbackRetractedSchema = z.object({
  feedbackId: z.string(),
  organizationId: z.string(),
  propertyId: z.string(),
  portalId: z.string(),
  supersedesSourceEventId: z.string().min(1),
  occurredAt: z.string(),
})

const guestReviewLinkClickedSchema = z.object({
  linkId: z.string(),
  organizationId: z.string(),
  propertyId: z.string(),
  portalId: z.string(),
  occurredAt: z.string(),
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

const merchantAiChangedSchema = z
  .object({
    _tag: z.literal('identity.merchant_ai.changed').optional(),
    eventId: z.string().optional(),
    correlationId: z.string().nullable().optional(),
    organizationId: z.string(),
    propertyId: z.string().uuid(),
    authorizationLineageId: z.string().uuid(),
    state: z.enum(['disabled', 'enabled', 'revoked']),
    reviewAnalysisEpoch: z.number().int().safe().positive(),
    replyDraftingEpoch: z.number().int().safe().positive(),
    propertyTrendsEpoch: z.number().int().safe().positive(),
    // 0-based source epoch (drizzle/0060); the capability epochs above are 1-based.
    authorizedSourceEpoch: z.number().int().safe().nonnegative(),
    analysisStartSequence: z.number().int().safe().nonnegative(),
    stateVersion: z.number().int().safe().positive(),
    occurredAt: z.string(),
  })
  .strict()
  .transform((event) => ({
    organizationId: event.organizationId,
    propertyId: event.propertyId,
    authorizationLineageId: event.authorizationLineageId,
    state: event.state,
    reviewAnalysisEpoch: event.reviewAnalysisEpoch,
    replyDraftingEpoch: event.replyDraftingEpoch,
    propertyTrendsEpoch: event.propertyTrendsEpoch,
    authorizedSourceEpoch: event.authorizedSourceEpoch,
    analysisStartSequence: event.analysisStartSequence,
    stateVersion: event.stateVersion,
    occurredAt: event.occurredAt,
  }))

// ── Integration event schemas ───────────────────────────────────────

// Connected events are identifier-only v2; the final binary has no v1 decoder.
const googleAccountConnectedV2Schema = z.object({
  connectionId: z.string(),
  organizationId: z.string(),
  connectedBy: z.string(),
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

// ── Portal event schemas ───────────────────────────────────────────

const portalWorkflowFactSchema = z.object({
  reviewId: z.string().min(1),
  revision: z.number().int().positive(),
  organizationId: z.string().min(1),
  propertyId: z.string().min(1),
  portalId: z.string().min(1),
  portalGroupId: z.string().nullable(),
  supersedesSourceEventId: z.string().min(1).nullable(),
  occurredAt: z.string(),
})

const portalContentReviewCompletedSchema = portalWorkflowFactSchema
const portalConfigurationCompletenessRecordedSchema = portalWorkflowFactSchema.extend({
  completedFields: z.number().int().nonnegative(),
  requiredFields: z.number().int().positive(),
})
const portalApprovedDestinationRatioRecordedSchema = portalWorkflowFactSchema.extend({
  approvedDestinations: z.number().int().nonnegative(),
  configuredDestinations: z.number().int().nonnegative(),
})

const portalDeletedSchema = z.object({
  portalId: z.string(),
  organizationId: z.string(),
  propertyId: z.string(),
})

const portalResponsibilityNeededSchema = z.object({
  portalId: z.string(),
  organizationId: z.string(),
  propertyId: z.string(),
  occurredAt: z.string().datetime(),
})

const portalTokenIssuedSchema = z.object({
  portalId: z.string(),
  organizationId: z.string(),
  propertyId: z.string(),
  tokenIdentifier: z.string(),
  version: z.number().int().positive(),
})

const portalTokenRotatedSchema = z.object({
  portalId: z.string(),
  organizationId: z.string(),
  propertyId: z.string(),
  previousVersion: z.number().int().positive(),
  version: z.number().int().positive(),
  gracePeriodEnds: z.string().datetime(),
})

const portalTokenRevokedSchema = z.object({
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
 *
 * Idempotent: composition may build more than one container in a process
 * (the dashboardCold in-process restart seam, tests). The registration set
 * is fixed constants, so a repeat call is definitionally identical and is
 * skipped — the registry's own duplicate guard still catches a conflicting
 * registration under an existing key. Tests that clearEventSchemas() get a
 * fresh registration on the next call.
 */
export function registerAllEventSchemas(): void {
  if (isEventRegistered('review.created', EVENT_VERSION)) return
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
    type: 'review.source_transitioned',
    version: EVENT_VERSION,
    schema: reviewSourceTransitionedSchema,
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
  registerEventSchema({
    type: 'review.reply.publication_cancelled',
    version: EVENT_VERSION,
    schema: replyPublicationCancelledSchema,
  })
  registerEventSchema({
    type: 'review.reply.updated',
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
  registerEventSchema({
    type: 'metric.corrected',
    version: EVENT_VERSION,
    schema: metricCorrectedSchema,
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
  registerEventSchema({
    type: 'property.google_binding.changed',
    version: EVENT_VERSION,
    schema: propertyGoogleBindingChangedSchema,
  })
  registerEventSchema({
    type: 'property.responsibility_became_needed',
    version: EVENT_VERSION,
    schema: propertyResponsibilityNeededSchema,
  })
  registerEventSchema({
    type: 'integration.property_import.requested',
    version: EVENT_VERSION,
    schema: integrationPropertyImportRequestedSchema,
  })
  registerEventSchema({
    type: 'integration.property_import.retention_released',
    version: EVENT_VERSION,
    schema: integrationPropertyImportRetentionReleasedSchema,
  })
  registerEventSchema({
    type: 'ai.property_trend.generation_requested',
    version: EVENT_VERSION,
    schema: aiPropertyTrendGenerationRequestedSchema,
  })
  registerEventSchema({
    type: 'ai.review_analysis.backfill_requested',
    version: EVENT_VERSION,
    schema: aiReviewAnalysisBackfillRequestedSchema,
  })

  // Guest events (consumed by metric). Corrected in place at v1: the three
  // legacy names below were never emitted, while the four domain tags here
  // were never registered and therefore could not create historical outbox
  // rows. Payloads contain identifiers and governed numeric facts only.
  registerEventSchema({
    type: 'guest.scan.recorded',
    version: EVENT_VERSION,
    schema: guestScanSchema,
  })
  registerEventSchema({
    type: 'guest.rating.submitted',
    version: EVENT_VERSION,
    schema: guestRatingSchema,
  })
  registerEventSchema({
    type: 'guest.rating.retracted',
    version: EVENT_VERSION,
    schema: guestRatingRetractedSchema,
  })
  registerEventSchema({
    type: 'guest.feedback.submitted',
    version: EVENT_VERSION,
    schema: guestFeedbackSchema,
  })
  registerEventSchema({
    type: 'guest.feedback.retracted',
    version: EVENT_VERSION,
    schema: guestFeedbackRetractedSchema,
  })
  registerEventSchema({
    type: 'guest.review_link.clicked',
    version: EVENT_VERSION,
    schema: guestReviewLinkClickedSchema,
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
  registerEventSchema({
    type: 'identity.merchant_ai.changed',
    version: EVENT_VERSION,
    schema: merchantAiChangedSchema,
  })

  // Integration events
  registerEventSchema({
    type: 'integration.google_account.connected',
    version: 2,
    schema: googleAccountConnectedV2Schema,
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

  // Portal events
  registerEventSchema({
    type: 'portal.deleted',
    version: EVENT_VERSION,
    schema: portalDeletedSchema,
  })
  registerEventSchema({
    type: 'portal.responsibility_became_needed',
    version: EVENT_VERSION,
    schema: portalResponsibilityNeededSchema,
  })
  registerEventSchema({
    type: 'portal.content_review.completed',
    version: EVENT_VERSION,
    schema: portalContentReviewCompletedSchema,
  })
  registerEventSchema({
    type: 'portal.configuration_completeness.recorded',
    version: EVENT_VERSION,
    schema: portalConfigurationCompletenessRecordedSchema,
  })
  registerEventSchema({
    type: 'portal.approved_destination_ratio.recorded',
    version: EVENT_VERSION,
    schema: portalApprovedDestinationRatioRecordedSchema,
  })
  registerEventSchema({
    type: 'portal.token.issued',
    version: EVENT_VERSION,
    schema: portalTokenIssuedSchema,
  })
  registerEventSchema({
    type: 'portal.token.rotated',
    version: EVENT_VERSION,
    schema: portalTokenRotatedSchema,
  })
  registerEventSchema({
    type: 'portal.token.revoked',
    version: EVENT_VERSION,
    schema: portalTokenRevokedSchema,
  })
  registerEventSchema({
    type: 'portal_group.deleted',
    version: EVENT_VERSION,
    schema: portalGroupDeletedSchema,
  })
}
