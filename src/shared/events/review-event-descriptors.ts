import { z } from 'zod/v4'
import type { EventDescriptor } from './descriptor'
import {
  reviewGoogleReputationSnapshotVerifiedSchema,
  reviewSnapshotRunScope,
} from './review-reputation-event-schemas'
import {
  databaseUuidSchema,
  replyPublicationCancelledSchema,
} from './reply-publication-cancelled-schema'

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
  observationOrigin: z
    .enum(['ongoing', 'historical_onboarding', 'legacy_unknown'])
    .optional(),
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

/**
 * A Property's first Google history import reaching a terminal state.
 * Identifiers, one count, and a closed reason — never review content. Never
 * `.strict()`: an older relay must tolerate a field a newer producer adds.
 */
const reviewPropertyHistoryImportFinishedSchema = z
  .object({
    ...reviewSnapshotRunScope,
    outcome: z.enum(['completed', 'failed']),
    reviewsObserved: z.number().int().safe().min(0).max(10_000),
    failureReason: z
      .enum([
        'google_authorization',
        'property_source_changed',
        'location_too_large',
        'temporary',
      ])
      .nullable(),
    occurredAt: z.iso.datetime(),
    sourceAggregateVersion: z.iso.datetime(),
  })
  .superRefine((value, context) => {
    if ((value.outcome === 'failed') !== (value.failureReason !== null)) {
      context.addIssue({
        code: 'custom',
        path: ['failureReason'],
        message: 'A closed reason accompanies exactly a failed import',
      })
    }
    if (value.sourceAggregateVersion !== value.occurredAt) {
      context.addIssue({
        code: 'custom',
        path: ['sourceAggregateVersion'],
        message: 'The source aggregate version must equal occurredAt',
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

// The approver's reason stays on the reply; the fact says only whether there
// is one. Optional because rows recorded before the flag existed lack it.
const replyRejectedSchema = replyEventSchema.extend({
  hasReason: z.boolean().optional(),
})

// Two independent closed facts about an unconfirmed publication, both
// additive (earlier rows and producers omit them):
// - `outcome`: how it ended (nothing sent, refused, or not confirmed);
// - `cause`: present only when the remedy is reconnecting Google, not a retry.
const replyPublishFailedSchema = replyEventSchema.extend({
  outcome: z.enum(['not_sent', 'refused', 'unconfirmed']).optional(),
  cause: z.enum(['google_reauthorization_required']).optional(),
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

export const reviewEventDescriptors = [
  {
    type: 'review.created',
    aggregate: { type: 'review', id: 'reviewId' },
    version: 1,
    schema: reviewCreatedSchema,
  },
  {
    type: 'review.updated',
    aggregate: { type: 'review', id: 'reviewId' },
    version: 1,
    schema: reviewUpdatedSchema,
  },
  {
    type: 'review.expired',
    aggregate: { type: 'review', id: 'reviewId' },
    version: 1,
    schema: reviewExpiredSchema,
  },
  {
    type: 'review.source_transitioned',
    aggregate: { type: 'review', id: 'reviewId' },
    version: 1,
    schema: reviewSourceTransitionedSchema,
  },
  {
    type: 'review.google_reputation_snapshot.verified',
    aggregate: { type: 'run', id: 'runId' },
    version: 1,
    schema: reviewGoogleReputationSnapshotVerifiedSchema,
  },
  {
    type: 'review.property_history_import.finished',
    aggregate: { type: 'run', id: 'runId' },
    version: 1,
    schema: reviewPropertyHistoryImportFinishedSchema,
  },
  {
    type: 'review.reply.submitted',
    aggregate: { type: 'review', id: 'reviewId' },
    version: 1,
    schema: replyEventSchema,
  },
  {
    type: 'review.reply.approved',
    aggregate: { type: 'review', id: 'reviewId' },
    version: 1,
    schema: replyEventSchema,
  },
  {
    type: 'review.reply.publication_requested',
    aggregate: { type: 'review', id: 'reviewId' },
    version: 1,
    schema: replyPublicationRequestedV1Schema,
  },
  {
    type: 'review.reply.publication_requested',
    aggregate: { type: 'review', id: 'reviewId' },
    version: 2,
    schema: replyPublicationRequestedV2Schema,
  },
  {
    type: 'review.reply.rejected',
    aggregate: { type: 'review', id: 'reviewId' },
    version: 1,
    schema: replyRejectedSchema,
  },
  {
    type: 'review.reply.published',
    aggregate: { type: 'review', id: 'reviewId' },
    version: 1,
    schema: replyEventSchema,
  },
  {
    type: 'review.reply.observed',
    aggregate: { type: 'review', id: 'reviewId' },
    version: 1,
    schema: replyObservedSchema,
  },
  {
    type: 'review.reply.publish_failed',
    aggregate: { type: 'review', id: 'reviewId' },
    version: 1,
    schema: replyPublishFailedSchema,
  },
  {
    type: 'review.reply.publication_cancelled',
    aggregate: { type: 'review', id: 'reviewId' },
    version: 1,
    schema: replyPublicationCancelledSchema,
  },
  {
    type: 'review.reply.updated',
    aggregate: { type: 'review', id: 'reviewId' },
    version: 1,
    schema: replyEventSchema,
  },
] as const satisfies readonly EventDescriptor[]
