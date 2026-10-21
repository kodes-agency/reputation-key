// Event schemas for the Google reputation snapshot facts a Property's Review
// context publishes (kept apart from schema-registrations.ts, which is on the
// file-length ratchet). Identifier-only payloads (ADR 0030).

import { z } from 'zod/v4'
import { databaseUuidSchema } from './reply-publication-cancelled-schema'

/** The Property source-epoch scope both provider-snapshot run facts are keyed by. */
export const reviewSnapshotRunScope = {
  organizationId: z.string().trim().min(1).max(255),
  propertyId: databaseUuidSchema,
  sourceEpoch: z.number().int().safe().nonnegative(),
  runId: databaseUuidSchema,
} as const

export const reviewGoogleReputationSnapshotVerifiedSchema = z
  .object({
    ...reviewSnapshotRunScope,
    reviewCount: z.number().int().safe().min(0).max(10_000),
    averageRating: z.number().finite().min(0).max(5).nullable(),
    evaluatedAt: z.iso.datetime(),
    // When Google's numbers were read (see ReviewGoogleReputationSnapshotVerified).
    // Optional: an event an older process wrote has none, and an older relay
    // that strips unknown keys reads the event as if it had none.
    numbersObservedAt: z.iso.datetime().optional(),
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
