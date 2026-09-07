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

import { z } from 'zod/v4'
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

const databaseUuidSchema = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu)

const reviewGoogleReputationSnapshotVerifiedSchema = z
  .object({
    organizationId: z.string().trim().min(1).max(255),
    propertyId: databaseUuidSchema,
    sourceEpoch: z.number().int().safe().nonnegative(),
    runId: databaseUuidSchema,
    reviewCount: z.number().int().safe().min(0).max(10_000),
    averageRating: z.number().finite().min(0).max(5).nullable(),
    evaluatedAt: z.iso.datetime(),
    occurredAt: z.iso.datetime(),
    sourceAggregateVersion: z.iso.datetime(),
  })
  .superRefine((value, context) => {
    if (!(
      (value.reviewCount === 0 && value.averageRating === null) ||
      (value.reviewCount > 0 && value.averageRating !== null)
    )) {
      context.addIssue({
        code: 'custom',
        path: ['averageRating'],
        message: 'The provider average must match the review count',
      })
    }
    if (
      value.sourceAggregateVersion !== value.evaluatedAt ||
      value.occurredAt !== value.evaluatedAt
    ) {
      context.addIssue({
        code: 'custom',
        path: ['sourceAggregateVersion'],
        message: 'The source aggregate version must equal evaluatedAt',
      })
    }
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

const googleReviewPushAcceptedSchema = z.object({
  organizationId: z.string().trim().min(1).max(255),
  propertyId: databaseUuidSchema,
  connectionId: databaseUuidSchema,
  sourceEpoch: z.number().int().safe().nonnegative(),
  referenceRef: z
    .string()
    .regex(/^[a-z][a-z0-9_-]{0,31}\.[A-Za-z0-9_-]{43}$/u)
    .nullable(),
  notificationKind: z.enum(['NEW_REVIEW', 'UPDATED_REVIEW', 'REVIEW_CHANGED']),
  occurredAt: z.iso.datetime(),
})

const primaryStaffAttributionSchema = z
  .object({
    staffParticipantId: databaseUuidSchema,
    staffParticipationId: databaseUuidSchema,
    portalResponsibilityId: databaseUuidSchema,
    effectiveFrom: z.iso.datetime(),
    effectiveTo: z.iso.datetime().nullable(),
  })
  .superRefine((value, context) => {
    if (
      value.effectiveTo !== null &&
      new Date(value.effectiveTo).getTime() <= new Date(value.effectiveFrom).getTime()
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Primary Staff attribution interval must be half-open and non-empty',
      })
    }
  })

// BQC-3.8: publication cancellation — identifier-only (reply/review/property/
// org + cause). No reply text, no actor content.
const replyPublicationCancelledSchema = z.object({
  replyId: databaseUuidSchema,
  reviewId: databaseUuidSchema,
  organizationId: z.string().trim().min(1),
  propertyId: databaseUuidSchema,
  cause: z.enum(['disconnect', 'policy', 'source_changed', 'provider_truth']),
  occurredAt: z.iso.datetime(),
})

const replyPublicationRequestedV1Schema = z.object({
  replyId: z.string(),
  reviewId: z.string(),
  organizationId: z.string(),
  propertyId: z.string(),
  userId: z.string(),
  publicationCycle: z.number().int().positive().safe(),
  occurredAt: z.string(),
})

// New writes use a standalone strict identifier contract. Keep v1 unchanged
// above so historical rows remain replayable without weakening current facts.
const replyPublicationRequestedV2Schema = z.object({
  replyId: databaseUuidSchema,
  reviewId: databaseUuidSchema,
  organizationId: z.string().trim().min(1),
  propertyId: databaseUuidSchema,
  userId: z.string().trim().min(1),
  publicationCycle: z.number().int().positive().safe(),
  sourceEpoch: z.number().int().nonnegative().safe(),
  materialReviewRevision: z.number().int().positive().safe(),
  baseObservationRevision: z.number().int().nonnegative().safe(),
  occurredAt: z.iso.datetime(),
})

const replyObservedSchema = z
  .object({
    reviewId: databaseUuidSchema,
    organizationId: z.string().trim().min(1),
    propertyId: databaseUuidSchema,
    observationRevision: z.number().int().positive().safe(),
    sourceEpoch: z.number().int().nonnegative().safe(),
    materialReviewRevision: z.number().int().positive().safe(),
    change: z.enum(['added', 'edited', 'deleted', 'unchanged']),
    resolution: z.enum([
      'confirmed_on_google',
      'external_current_live',
      'diverged',
      'absent',
    ]),
    provenance: z.enum(['repkey_confirmed', 'external_or_unknown', 'none']),
    matchedReplyId: databaseUuidSchema.nullable(),
    matchedPublicationCycle: z.number().int().positive().safe().nullable(),
    occurredAt: z.iso.datetime(),
  })
  .refine(
    (value) =>
      (value.matchedReplyId === null) === (value.matchedPublicationCycle === null),
    { message: 'matched Reply and publication cycle must be present together' },
  )
  .refine(
    (value) => {
      const hasMatch =
        value.matchedReplyId !== null && value.matchedPublicationCycle !== null
      const hasNoMatch =
        value.matchedReplyId === null && value.matchedPublicationCycle === null

      switch (value.resolution) {
        case 'confirmed_on_google':
          return (
            value.change !== 'deleted' &&
            value.provenance === 'repkey_confirmed' &&
            hasMatch
          )
        case 'external_current_live':
          return (
            value.change !== 'deleted' &&
            value.provenance === 'external_or_unknown' &&
            hasNoMatch
          )
        case 'diverged':
          return (
            value.change !== 'deleted' &&
            value.provenance === 'external_or_unknown' &&
            hasNoMatch
          )
        case 'absent':
          return value.change === 'deleted' && value.provenance === 'none' && hasNoMatch
      }
    },
    { message: 'review reply observation semantics are invalid' },
  )

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
  userId: z.string().nullable().optional(),
  propertyId: z.string().nullable().optional(),
  source: z.string().optional(),
  occurredAt: z.string().optional(),
})

const inboxItemEscalationResolvedSchema = z.object({
  inboxItemId: z.string(),
  organizationId: z.string(),
  userId: z.string().nullable().optional(),
  propertyId: z.string().nullable().optional(),
  source: z.string().optional(),
  occurredAt: z.string().optional(),
})

const inboxNoteAddedSchema = z.object({
  inboxItemId: z.string(),
  noteId: z.string(),
  organizationId: z.string(),
  userId: z.string().nullable().optional(),
  propertyId: z.string().nullable().optional(),
  source: z.string().optional(),
  occurredAt: z.string().optional(),
})

const inboxItemAssignedSchema = z.object({
  inboxItemId: z.string(),
  organizationId: z.string(),
  assignedTo: z.string(),
  bulkId: z.string().optional(),
  propertyId: z.string().nullable().optional(),
  userId: z.string().optional(),
  source: z.string().optional(),
  occurredAt: z.string().optional(),
})

const inboxItemUnassignedSchema = z.object({
  inboxItemId: z.string(),
  organizationId: z.string(),
  previousAssignee: z.string(),
  bulkId: z.string().optional(),
  propertyId: z.string().nullable().optional(),
  userId: z.string().nullable().optional(),
  source: z.string().optional(),
  occurredAt: z.string().optional(),
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
    ]),
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

// ── Metric event schemas ────────────────────────────────────────────

// BQC-3.5: corrected IN PLACE at version 1 — no version bump. Justification:
// buildMetricContext never forwarded outboxRepo to recordMetric, so zero
// historical outbox rows exist for metric.recorded; and had it been wired, every insert
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

const metricRecordedV2Schema = metricRecordedSchema.extend({
  staffAttribution: primaryStaffAttributionSchema.nullable(),
})

const metricCorrectedV2Schema = metricCorrectedSchema.extend({
  staffAttribution: primaryStaffAttributionSchema.nullable(),
})

// ── Property event schemas ──────────────────────────────────────────

const propertyCreatedSchema = z.object({
  propertyId: z.string(),
  organizationId: z.string(),
  name: z.string(),
  slug: z.string(),
})

// BQC-3.5: registered so the orphan audit facts record with their state
// (never registered before → zero historical rows; additive at v1).
const propertyUpdatedSchema = z.object({
  propertyId: z.string(),
  organizationId: z.string(),
  name: z.string(),
  slug: z.string(),
  occurredAt: z.iso.datetime().optional(),
})

const propertyDeletedSchema = z.object({
  propertyId: z.string(),
  organizationId: z.string(),
  occurredAt: z.iso.datetime().optional(),
})

const propertyLifecycleSchema = z.object({
  propertyId: z.uuid(),
  organizationId: z.string().trim().min(1),
  userId: z.string().trim().min(1),
  previousState: z.enum([
    'active',
    'suspended',
    'archived',
    'disconnecting',
    'purge_pending',
    'purging',
    'purged',
  ]),
  sourceEpoch: z.number().int().positive(),
  occurredAt: z.iso.datetime(),
})

const propertyArchivedSchema = propertyLifecycleSchema
  .extend({
    previousState: z.enum(['active', 'suspended']),
    recoveryDeadline: z.iso.datetime(),
  })
  .refine(
    ({ occurredAt, recoveryDeadline }) =>
      Date.parse(recoveryDeadline) > Date.parse(occurredAt),
    { message: 'Property recovery deadline must follow archive time' },
  )

const propertyRestoredSchema = propertyLifecycleSchema.extend({
  previousState: z.literal('archived'),
  googleBindingReadiness: z.enum(['ready', 'reconnect_required']),
})

const propertyResponsibilityNeededSchema = z.object({
  propertyId: z.string(),
  organizationId: z.string(),
  occurredAt: z.iso.datetime(),
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
  .transform(
    ({ organizationId, propertyId, connectionId, sourceEpoch, change, occurredAt }) => ({
      organizationId,
      propertyId,
      connectionId,
      sourceEpoch,
      change,
      occurredAt,
    }),
  )

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
// and stripped from the delivered fact payload before consumer-side validation.
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

const guestScanV1Schema = z.object({
  scanId: z.string(),
  organizationId: z.string(),
  propertyId: z.string(),
  portalId: z.string(),
  source: z.enum(['qr', 'nfc', 'direct']),
  occurredAt: z.string(),
})

const guestScanV2Schema = z.object({
  scanId: z.string(),
  organizationId: z.string(),
  propertyId: z.string(),
  portalId: z.string(),
  scanSource: z.enum(['qr', 'nfc', 'direct']),
  occurredAt: z.string(),
})

const guestQualifiedScanSchema = z.object({
  qualifiedScanId: z.uuid(),
  organizationId: z.string(),
  propertyId: z.uuid(),
  portalId: z.uuid(),
  portalGroupId: z.uuid().nullable(),
  accessArtifactId: z.uuid(),
  occurredAt: z.string(),
})

const guestQualifiedScanRetractedSchema = guestQualifiedScanSchema.extend({
  supersedesSourceEventId: z.uuid(),
})

const guestQualifiedScanV2Schema = guestQualifiedScanSchema.extend({
  staffAttribution: primaryStaffAttributionSchema.nullable(),
})

const guestQualifiedScanRetractedV2Schema = guestQualifiedScanRetractedSchema.extend({
  staffAttribution: primaryStaffAttributionSchema.nullable(),
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

const guestRatingV2Schema = guestRatingSchema.extend({
  staffAttribution: primaryStaffAttributionSchema.nullable(),
})

const guestRatingRetractedV2Schema = guestRatingRetractedSchema.extend({
  staffAttribution: primaryStaffAttributionSchema.nullable(),
})

const guestFeedbackV2Schema = guestFeedbackSchema.extend({
  staffAttribution: primaryStaffAttributionSchema.nullable(),
})

const guestFeedbackRetractedV2Schema = guestFeedbackRetractedSchema.extend({
  staffAttribution: primaryStaffAttributionSchema.nullable(),
})

const guestFeedbackV3Schema = guestFeedbackV2Schema.extend({
  responseRevision: z.number().int().positive().safe(),
})

const guestFeedbackRetractedV3Schema = guestFeedbackRetractedV2Schema.extend({
  responseRevision: z.number().int().positive().safe(),
})

const guestReviewLinkClickedSchema = z.object({
  linkId: z.string(),
  // Older click facts predate destination classification and represented
  // only secondary Portal links. Defaulting preserves their exact meaning.
  destinationKind: z
    .enum(['google_review', 'secondary_link'])
    .optional()
    .default('secondary_link'),
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

const goalMonthlyResultBaseSchema = z
  .object({
    // Tenant scope also lives in the durable envelope. These two fields are
    // optional only for replay of rows written by the pre-adapter producer.
    organizationId: z.string().trim().min(1).optional(),
    propertyId: z.uuid().optional(),
    programId: z.uuid(),
    programVersionId: z.uuid(),
    assignmentId: z.uuid(),
    monthlyResultId: z.uuid(),
    periodStart: z.iso.datetime(),
    periodEnd: z.iso.datetime(),
    evaluationState: z.enum([
      'eligible',
      'updating',
      'insufficient_data',
      'unavailable',
      'quarantined',
    ]),
    achieved: z.boolean().nullable(),
    // The outbox row created_at remains authoritative for the old producer.
    occurredAt: z.iso.datetime().optional(),
  })
  .superRefine((payload, ctx) => {
    if (new Date(payload.periodEnd) <= new Date(payload.periodStart)) {
      ctx.addIssue({ code: 'custom', message: 'periodEnd must follow periodStart' })
    }
    if (
      (payload.evaluationState === 'eligible' && payload.achieved === null) ||
      (payload.evaluationState !== 'eligible' && payload.achieved !== null)
    ) {
      ctx.addIssue({
        code: 'custom',
        message: 'achievement must match the evaluation state',
      })
    }
  })

const goalMonthlyResultClosedSchema = goalMonthlyResultBaseSchema
  .safeExtend({ status: z.literal('closed') })
  .superRefine((payload, ctx) => {
    if (payload.evaluationState === 'updating') {
      ctx.addIssue({ code: 'custom', message: 'closed result cannot be updating' })
    }
  })

const goalMonthlyResultReconciledSchema = goalMonthlyResultBaseSchema.safeExtend({
  status: z.literal('reconciling'),
})

const goalMonthlyResultRevisedSchema = goalMonthlyResultBaseSchema
  .safeExtend({
    status: z.literal('closed'),
    revisionId: z.uuid(),
    revision: z.number().int().positive(),
    supersedesRevisionId: z.uuid().nullable(),
    outcomeChanged: z.boolean(),
    availabilityChanged: z.boolean(),
  })
  .superRefine((payload, ctx) => {
    if (payload.evaluationState === 'updating') {
      ctx.addIssue({ code: 'custom', message: 'closed result cannot be updating' })
    }
    if (
      (payload.revision === 1 && payload.supersedesRevisionId !== null) ||
      (payload.revision > 1 && payload.supersedesRevisionId === null)
    ) {
      ctx.addIssue({ code: 'custom', message: 'result revision lineage is invalid' })
    }
  })

// ── Identity event schemas ──────────────────────────────────────────

const memberInvitedV2Schema = z.object({
  invitationId: z.string(),
  organizationId: z.string(),
  role: z.string(),
  // Recognize and reject the retired key instead of letting Zod's normal
  // unknown-key stripping make a directly injected v2 envelope look valid.
  email: z.never().optional(),
})

// Rolling expand compatibility: the old v1 dispatcher requires an `email`
// string. New producers never supply it; the database issuance trigger adds
// only the structural `[redacted]` sentinel while v1 remains active. Optional
// lets the new producer validate its pre-trigger payload and lets the new
// dispatcher consume already-scrubbed v1 rows during cutover.
const memberInvitedV1Schema = memberInvitedV2Schema.extend({
  email: z.string().optional(),
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
    propertyId: z.uuid(),
    authorizationLineageId: z.uuid(),
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

const organizationLifecycleChangedSchema = z
  .object({
    organizationId: z.string().trim().min(1).max(255),
    closureLineageId: databaseUuidSchema,
    state: z.enum([
      'active',
      'closure_requested',
      'closing',
      'purge_pending',
      'purging',
      'closed',
    ]),
    revision: z.number().int().safe().positive(),
    reactivationRequired: z.boolean(),
    recoverableUntil: z.iso.datetime(),
    occurredAt: z.iso.datetime(),
  })
  // LIF-01-T18: explicit reactivation is the only fact that lowers the fence,
  // and it is only reachable from `active`. Any other state reporting
  // `reactivationRequired: false` would mean a closing or purging
  // Organization silently resumed, so the literal is kept as a refinement
  // rather than dropped.
  .refine(
    (event) => event.reactivationRequired || event.state === 'active',
    'reactivationRequired may only be false for an active Organization',
  )

// ── Integration event schemas ───────────────────────────────────────

// v2 remains registered for already-written rows. Current producers emit v3,
// whose actor field follows the canonical event vocabulary.
const googleAccountConnectedV2Schema = z.object({
  connectionId: z.string(),
  organizationId: z.string(),
  connectedBy: z.string(),
})

const googleAccountConnectedV3Schema = z.object({
  connectionId: z.string(),
  organizationId: z.string(),
  userId: z.string(),
})

const googleAccountDisconnectedSchema = z.object({
  connectionId: z.string(),
  organizationId: z.string(),
})

const googleAccountReauthorizationRequiredSchema = z.object({
  connectionId: z.string(),
  organizationId: z.string(),
  cause: z.enum(['member_removed', 'account_admin_role_lost']),
  occurredAt: z.iso.datetime(),
})

const connectionVisibilityChangedSchema = z.object({
  connectionId: z.string(),
  organizationId: z.string(),
  visibility: z.string(),
})

// ── Portal event schemas ───────────────────────────────────────────

const portalWorkflowFactV1Schema = z.object({
  reviewId: z.string().min(1),
  revision: z.number().int().positive(),
  organizationId: z.string().min(1),
  propertyId: z.string().min(1),
  portalId: z.string().min(1),
  portalGroupId: z.string().nullable(),
  supersedesSourceEventId: z.string().min(1).nullable(),
  occurredAt: z.string(),
})

const portalWorkflowFactV2Schema = portalWorkflowFactV1Schema.extend({
  sourceAggregateVersion: z.iso.datetime(),
  occurredAt: z.iso.datetime(),
})

const portalContentReviewCompletedV1Schema = portalWorkflowFactV1Schema
const portalContentReviewCompletedV2Schema = portalWorkflowFactV2Schema
const portalConfigurationCompletenessRecordedV1Schema = portalWorkflowFactV1Schema.extend(
  {
    completedFields: z.number().int().nonnegative(),
    requiredFields: z.number().int().positive(),
  },
)
const portalConfigurationCompletenessRecordedV2Schema = portalWorkflowFactV2Schema.extend(
  {
    completedFields: z.number().int().nonnegative(),
    requiredFields: z.number().int().positive(),
  },
)
const portalApprovedDestinationRatioRecordedV1Schema = portalWorkflowFactV1Schema.extend({
  approvedDestinations: z.number().int().nonnegative(),
  configuredDestinations: z.number().int().nonnegative(),
})
const portalApprovedDestinationRatioRecordedV2Schema = portalWorkflowFactV2Schema.extend({
  approvedDestinations: z.number().int().nonnegative(),
  configuredDestinations: z.number().int().nonnegative(),
})

const portalLifecycleFactSchema = z.object({
  portalId: z.string(),
  organizationId: z.string(),
  propertyId: z.string(),
  sourceAggregateVersion: z.iso.datetime(),
  occurredAt: z.iso.datetime(),
})

const portalCreatedSchema = portalLifecycleFactSchema.extend({
  publicationState: z.enum(['draft', 'published', 'disabled', 'archived']),
})

const portalUpdatedSchema = portalCreatedSchema.extend({
  previousPublicationState: z.enum(['draft', 'published', 'disabled', 'archived']),
})

const portalActorLifecycleFactSchema = portalLifecycleFactSchema.extend({
  userId: z.string().trim().min(1),
})

const portalPublicationFactSchema = portalActorLifecycleFactSchema.extend({
  publicationSnapshotId: z.string().trim().min(1),
  publicationVersion: z.number().int().safe().positive(),
  publicationDigest: z.string().regex(/^[0-9a-f]{64}$/u),
})

const portalDeletedSchema = portalLifecycleFactSchema

const portalResponsibilityNeededV1Schema = z.object({
  portalId: z.string(),
  organizationId: z.string(),
  propertyId: z.string(),
  occurredAt: z.iso.datetime(),
})

const portalResponsibilityNeededV2Schema = portalLifecycleFactSchema

const portalResponsibleManagersUpdatedSchema = portalLifecycleFactSchema.extend({
  assignmentCount: z.number().int().nonnegative(),
})

const portalHealthStatusSchema = z.enum(['healthy', 'degraded', 'unavailable'])
const portalHealthReasonSchema = z.enum([
  'operational',
  'publication_draft',
  'publication_disabled',
  'publication_archived',
  'property_unavailable',
  'publication_snapshot_unavailable',
  'public_address_unavailable',
  'responsibility_needed',
  'google_destination_awaiting_refresh',
  'google_destination_unavailable',
])
const portalHealthChangedSchema = z.object({
  portalId: z.string().min(1),
  organizationId: z.string().min(1),
  propertyId: z.string().min(1),
  previousStatus: portalHealthStatusSchema,
  previousReason: portalHealthReasonSchema,
  status: portalHealthStatusSchema,
  reason: portalHealthReasonSchema,
  sourceVersion: z.string().trim().min(1).max(160),
  occurredAt: z.iso.datetime(),
})

const portalPropertyFactSchema = z.object({
  organizationId: z.string().min(1),
  propertyId: z.string().min(1),
  sourceAggregateVersion: z.iso.datetime(),
  occurredAt: z.iso.datetime(),
})
const portalPropertyBrandProfileUpdatedSchema = portalPropertyFactSchema.extend({
  profileVersion: z.number().int().positive(),
})
const portalPropertyBrandContentUpdatedSchema = portalPropertyFactSchema.extend({
  guestLocale: z.enum(['en', 'bg']),
  contentVersion: z.number().int().positive(),
})
const portalLocalizedOverrideUpdatedSchema = portalLifecycleFactSchema.extend({
  guestLocale: z.enum(['en', 'bg']),
  overrideVersion: z.number().int().positive().nullable(),
})
const portalLocaleSetUpdatedSchema = portalLifecycleFactSchema.extend({
  primaryGuestLocale: z.enum(['en', 'bg']),
  additionalGuestLocales: z.array(z.enum(['en', 'bg'])).max(1),
})
const portalApprovedDestinationUpdatedSchema = portalPropertyFactSchema.extend({
  approvedDestinationId: z.uuid(),
  approvalState: z.enum(['pending', 'approved', 'disabled', 'quarantined']),
})

const portalHeroImageProcessingRequestedSchema = z.object({
  uploadId: z.uuid(),
  portalId: z.uuid(),
  organizationId: z.string().min(1),
  propertyId: z.uuid(),
  sourceETag: z.string().regex(/^[A-Za-z0-9"'-]{1,200}$/),
  occurredAt: z.iso.datetime(),
})

const portalHeroImagePublishedSchema = portalLifecycleFactSchema.extend({
  uploadId: z.uuid(),
})

const portalTokenIssuedSchema = z.object({
  portalId: z.string(),
  organizationId: z.string(),
  propertyId: z.string(),
  tokenIdentifier: z.string(),
  version: z.number().int().positive(),
  sourceAggregateVersion: z.iso.datetime().optional(),
  occurredAt: z.iso.datetime().optional(),
})

const portalTokenRotatedSchema = z.object({
  portalId: z.string(),
  organizationId: z.string(),
  propertyId: z.string(),
  previousVersion: z.number().int().positive(),
  version: z.number().int().positive(),
  gracePeriodEnds: z.iso.datetime(),
  sourceAggregateVersion: z.iso.datetime().optional(),
  occurredAt: z.iso.datetime().optional(),
})

const portalTokenRevokedSchema = z.object({
  portalId: z.string(),
  organizationId: z.string(),
  propertyId: z.string(),
  sourceAggregateVersion: z.iso.datetime().optional(),
  occurredAt: z.iso.datetime().optional(),
})

const portalAccessArtifactPublishedSchema = portalLifecycleFactSchema.extend({
  accessArtifactId: z.uuid(),
  channel: z.enum(['qr', 'nfc']),
})

const portalGroupDeletedV1Schema = z.object({
  portalGroupId: z.string(),
  organizationId: z.string(),
  propertyId: z.string(),
})

const portalGroupDeletedV2Schema = portalGroupDeletedV1Schema.extend({
  sourceAggregateVersion: z.iso.datetime(),
  occurredAt: z.iso.datetime(),
})

const portalGroupCreatedSchema = z.object({
  portalGroupId: z.string(),
  organizationId: z.string(),
  propertyId: z.string(),
  sourceAggregateVersion: z.iso.datetime(),
  occurredAt: z.iso.datetime(),
})

const portalAddedToGroupSchema = z.object({
  portalGroupId: z.string(),
  portalId: z.string(),
  organizationId: z.string(),
  propertyId: z.string(),
  sourceAggregateVersion: z.iso.datetime(),
  occurredAt: z.iso.datetime(),
})

const portalGroupUpdatedSchema = portalGroupCreatedSchema

const portalRemovedFromGroupSchema = portalAddedToGroupSchema

const portalLinkCategoryCreatedSchema = z.object({
  portalId: z.string(),
  categoryId: z.string(),
  organizationId: z.string(),
  propertyId: z.string(),
  sourceAggregateVersion: z.iso.datetime(),
  occurredAt: z.iso.datetime(),
})

const portalLinkCategoryReorderedSchema = z.object({
  portalId: z.string(),
  organizationId: z.string(),
  propertyId: z.string(),
  sourceAggregateVersion: z.iso.datetime(),
  occurredAt: z.iso.datetime(),
})

const portalLinkCategoryUpdatedSchema = portalLinkCategoryCreatedSchema
const portalLinkCategoryDeletedSchema = portalLinkCategoryCreatedSchema

const portalLinkCreatedSchema = z.object({
  portalId: z.string(),
  linkId: z.string(),
  categoryId: z.string(),
  organizationId: z.string(),
  propertyId: z.string(),
  sourceAggregateVersion: z.iso.datetime(),
  occurredAt: z.iso.datetime(),
})

const portalLinkReorderedSchema = z.object({
  portalId: z.string(),
  categoryId: z.string(),
  organizationId: z.string(),
  propertyId: z.string(),
  sourceAggregateVersion: z.iso.datetime(),
  occurredAt: z.iso.datetime(),
})

const portalLinkUpdatedSchema = portalLinkCreatedSchema
const portalLinkDeletedSchema = portalLinkCreatedSchema

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
    type: 'review.google_reputation_snapshot.verified',
    version: EVENT_VERSION,
    schema: reviewGoogleReputationSnapshotVerifiedSchema,
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
    type: 'review.reply.publication_requested',
    version: EVENT_VERSION,
    schema: replyPublicationRequestedV1Schema,
  })
  registerEventSchema({
    type: 'review.reply.publication_requested',
    version: 2,
    schema: replyPublicationRequestedV2Schema,
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
    type: 'review.reply.observed',
    version: EVENT_VERSION,
    schema: replyObservedSchema,
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
  registerEventSchema({
    type: 'inbox.inbox_items.bulk_assignment_completed',
    version: EVENT_VERSION,
    schema: inboxBulkAssignmentCompletedSchema,
  })
  registerEventSchema({
    type: 'inbox.handling_cycle.opened',
    version: EVENT_VERSION,
    schema: inboxHandlingCycleOpenedSchema,
  })
  registerEventSchema({
    type: 'inbox.handling_cycle.closed',
    version: EVENT_VERSION,
    schema: inboxHandlingCycleClosedSchema,
  })
  registerEventSchema({
    type: 'inbox.handling_cycle.reopened',
    version: EVENT_VERSION,
    schema: inboxHandlingCycleReopenedSchema,
  })
  registerEventSchema({
    type: 'inbox.response_target.reminder_due',
    version: EVENT_VERSION,
    schema: inboxResponseTargetReminderDueSchema,
  })
  registerEventSchema({
    type: 'inbox.response_target.policy_changed',
    version: EVENT_VERSION,
    schema: inboxResponseTargetPolicyChangedSchema,
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
  registerEventSchema({
    type: 'metric.recorded',
    version: 2,
    schema: metricRecordedV2Schema,
  })
  registerEventSchema({
    type: 'metric.corrected',
    version: 2,
    schema: metricCorrectedV2Schema,
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
    type: 'property.archived',
    version: EVENT_VERSION,
    schema: propertyArchivedSchema,
  })
  registerEventSchema({
    type: 'property.restored',
    version: EVENT_VERSION,
    schema: propertyRestoredSchema,
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
    schema: guestScanV1Schema,
  })
  registerEventSchema({
    type: 'guest.scan.recorded',
    version: 2,
    schema: guestScanV2Schema,
  })
  registerEventSchema({
    type: 'guest.qualified_scan.recorded',
    version: EVENT_VERSION,
    schema: guestQualifiedScanSchema,
  })
  registerEventSchema({
    type: 'guest.qualified_scan.retracted',
    version: EVENT_VERSION,
    schema: guestQualifiedScanRetractedSchema,
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
    type: 'guest.qualified_scan.recorded',
    version: 2,
    schema: guestQualifiedScanV2Schema,
  })
  registerEventSchema({
    type: 'guest.qualified_scan.retracted',
    version: 2,
    schema: guestQualifiedScanRetractedV2Schema,
  })
  registerEventSchema({
    type: 'guest.rating.submitted',
    version: 2,
    schema: guestRatingV2Schema,
  })
  registerEventSchema({
    type: 'guest.rating.retracted',
    version: 2,
    schema: guestRatingRetractedV2Schema,
  })
  registerEventSchema({
    type: 'guest.feedback.submitted',
    version: 2,
    schema: guestFeedbackV2Schema,
  })
  registerEventSchema({
    type: 'guest.feedback.retracted',
    version: 2,
    schema: guestFeedbackRetractedV2Schema,
  })
  registerEventSchema({
    type: 'guest.feedback.submitted',
    version: 3,
    schema: guestFeedbackV3Schema,
  })
  registerEventSchema({
    type: 'guest.feedback.retracted',
    version: 3,
    schema: guestFeedbackRetractedV3Schema,
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
  registerEventSchema({
    type: 'goal.monthly_result.closed',
    version: EVENT_VERSION,
    schema: goalMonthlyResultClosedSchema,
  })
  registerEventSchema({
    type: 'goal.monthly_result.reconciled',
    version: EVENT_VERSION,
    schema: goalMonthlyResultReconciledSchema,
  })
  registerEventSchema({
    type: 'goal.monthly_result.revised',
    version: EVENT_VERSION,
    schema: goalMonthlyResultRevisedSchema,
  })

  // Identity events (consumed by activity)
  registerEventSchema({
    type: 'identity.member.invited',
    version: EVENT_VERSION,
    schema: memberInvitedV1Schema,
  })
  registerEventSchema({
    type: 'identity.member.invited',
    version: 2,
    schema: memberInvitedV2Schema,
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
  registerEventSchema({
    type: 'identity.organization_lifecycle.changed',
    version: EVENT_VERSION,
    schema: organizationLifecycleChangedSchema,
  })

  // Integration events
  registerEventSchema({
    type: 'integration.google_account.connected',
    version: 2,
    schema: googleAccountConnectedV2Schema,
  })
  registerEventSchema({
    type: 'integration.google_account.connected',
    version: 3,
    schema: googleAccountConnectedV3Schema,
  })
  registerEventSchema({
    type: 'integration.google_account.disconnected',
    version: EVENT_VERSION,
    schema: googleAccountDisconnectedSchema,
  })
  registerEventSchema({
    type: 'integration.google_account.reauthorization_required',
    version: EVENT_VERSION,
    schema: googleAccountReauthorizationRequiredSchema,
  })
  registerEventSchema({
    type: 'integration.google_connection.visibility_changed',
    version: EVENT_VERSION,
    schema: connectionVisibilityChangedSchema,
  })
  registerEventSchema({
    type: 'integration.google_review_push.accepted',
    version: EVENT_VERSION,
    schema: googleReviewPushAcceptedSchema,
  })

  // Portal events
  registerEventSchema({
    type: 'portal.created',
    version: EVENT_VERSION,
    schema: portalCreatedSchema,
  })
  registerEventSchema({
    type: 'portal.updated',
    version: EVENT_VERSION,
    schema: portalUpdatedSchema,
  })
  registerEventSchema({
    type: 'portal.publication.published',
    version: EVENT_VERSION,
    schema: portalPublicationFactSchema,
  })
  registerEventSchema({
    type: 'portal.publication.rolled_back',
    version: EVENT_VERSION,
    schema: portalPublicationFactSchema,
  })
  registerEventSchema({
    type: 'portal.archived',
    version: EVENT_VERSION,
    schema: portalActorLifecycleFactSchema,
  })
  registerEventSchema({
    type: 'portal.restored',
    version: EVENT_VERSION,
    schema: portalActorLifecycleFactSchema,
  })
  registerEventSchema({
    type: 'portal.deleted',
    version: EVENT_VERSION,
    schema: portalDeletedSchema,
  })
  registerEventSchema({
    type: 'portal.responsibility_became_needed',
    version: EVENT_VERSION,
    schema: portalResponsibilityNeededV1Schema,
  })
  registerEventSchema({
    type: 'portal.responsibility_became_needed',
    version: 2,
    schema: portalResponsibilityNeededV2Schema,
  })
  registerEventSchema({
    type: 'portal.responsible_managers.updated',
    version: 2,
    schema: portalResponsibleManagersUpdatedSchema,
  })
  registerEventSchema({
    type: 'portal.health.changed',
    version: EVENT_VERSION,
    schema: portalHealthChangedSchema,
  })
  registerEventSchema({
    type: 'portal.property_brand_profile.updated',
    version: EVENT_VERSION,
    schema: portalPropertyBrandProfileUpdatedSchema,
  })
  registerEventSchema({
    type: 'portal.property_brand_content.updated',
    version: EVENT_VERSION,
    schema: portalPropertyBrandContentUpdatedSchema,
  })
  registerEventSchema({
    type: 'portal.localized_override.updated',
    version: EVENT_VERSION,
    schema: portalLocalizedOverrideUpdatedSchema,
  })
  registerEventSchema({
    type: 'portal.locale_set.updated',
    version: EVENT_VERSION,
    schema: portalLocaleSetUpdatedSchema,
  })
  registerEventSchema({
    type: 'portal.approved_destination.updated',
    version: EVENT_VERSION,
    schema: portalApprovedDestinationUpdatedSchema,
  })
  registerEventSchema({
    type: 'portal.hero_image.processing_requested',
    version: EVENT_VERSION,
    schema: portalHeroImageProcessingRequestedSchema,
  })
  registerEventSchema({
    type: 'portal.hero_image.published',
    version: EVENT_VERSION,
    schema: portalHeroImagePublishedSchema,
  })
  registerEventSchema({
    type: 'portal.content_review.completed',
    version: EVENT_VERSION,
    schema: portalContentReviewCompletedV1Schema,
  })
  registerEventSchema({
    type: 'portal.content_review.completed',
    version: 2,
    schema: portalContentReviewCompletedV2Schema,
  })
  registerEventSchema({
    type: 'portal.configuration_completeness.recorded',
    version: EVENT_VERSION,
    schema: portalConfigurationCompletenessRecordedV1Schema,
  })
  registerEventSchema({
    type: 'portal.configuration_completeness.recorded',
    version: 2,
    schema: portalConfigurationCompletenessRecordedV2Schema,
  })
  registerEventSchema({
    type: 'portal.approved_destination_ratio.recorded',
    version: EVENT_VERSION,
    schema: portalApprovedDestinationRatioRecordedV1Schema,
  })
  registerEventSchema({
    type: 'portal.approved_destination_ratio.recorded',
    version: 2,
    schema: portalApprovedDestinationRatioRecordedV2Schema,
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
    type: 'portal.access_artifact.published',
    version: EVENT_VERSION,
    schema: portalAccessArtifactPublishedSchema,
  })
  registerEventSchema({
    type: 'portal_link_category.created',
    version: EVENT_VERSION,
    schema: portalLinkCategoryCreatedSchema,
  })
  registerEventSchema({
    type: 'portal_link_category.reordered',
    version: EVENT_VERSION,
    schema: portalLinkCategoryReorderedSchema,
  })
  registerEventSchema({
    type: 'portal_link_category.updated',
    version: EVENT_VERSION,
    schema: portalLinkCategoryUpdatedSchema,
  })
  registerEventSchema({
    type: 'portal_link_category.deleted',
    version: EVENT_VERSION,
    schema: portalLinkCategoryDeletedSchema,
  })
  registerEventSchema({
    type: 'portal_link.created',
    version: EVENT_VERSION,
    schema: portalLinkCreatedSchema,
  })
  registerEventSchema({
    type: 'portal_link.reordered',
    version: EVENT_VERSION,
    schema: portalLinkReorderedSchema,
  })
  registerEventSchema({
    type: 'portal_link.updated',
    version: EVENT_VERSION,
    schema: portalLinkUpdatedSchema,
  })
  registerEventSchema({
    type: 'portal_link.deleted',
    version: EVENT_VERSION,
    schema: portalLinkDeletedSchema,
  })
  registerEventSchema({
    type: 'portal_group.created',
    version: EVENT_VERSION,
    schema: portalGroupCreatedSchema,
  })
  registerEventSchema({
    type: 'portal_group.updated',
    version: EVENT_VERSION,
    schema: portalGroupUpdatedSchema,
  })
  registerEventSchema({
    type: 'portal_group.portal_added',
    version: EVENT_VERSION,
    schema: portalAddedToGroupSchema,
  })
  registerEventSchema({
    type: 'portal_group.portal_removed',
    version: EVENT_VERSION,
    schema: portalRemovedFromGroupSchema,
  })
  registerEventSchema({
    type: 'portal_group.deleted',
    version: EVENT_VERSION,
    schema: portalGroupDeletedV1Schema,
  })
  registerEventSchema({
    type: 'portal_group.deleted',
    version: 2,
    schema: portalGroupDeletedV2Schema,
  })
}
