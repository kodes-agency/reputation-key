// AI event schemas, registered by ./schema-registrations.ts.
//
// Every AI fact is identifier-only (ADR 0030): which Property, which review revision,
// which analysis. Nothing a provider said and nothing a guest wrote crosses, and a
// field called `reason` would be stripped from an outbox payload as content
// (./../outbox/event-adapter.ts) in any case.

import { z } from 'zod/v4'
import { registerEventSchema } from './schema-registry'

const aiPropertyTrendGenerationRequestedSchema = z.object({
  scheduleId: z.uuid(),
  organizationId: z.string().min(1),
  propertyId: z.uuid(),
  occurredAt: z.string(),
})

// Envelope metadata is reattached after producer-side allowlist validation
// and stripped from the delivered fact payload before consumer-side validation.
// First-enablement Review Analysis enrollment replay. Identifier-only, with
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

// A v3 review analysis found the review Urgent. The same field set as the replay
// request above, and for the same reason: the fact says which revision was analysed
// and by which analysis, and says nothing of why. The reason stays beside the analysis
// and is read in the app; the alert's email names none (ADR 0046 r.8).
const aiReviewUrgentDetectedSchema = z.object({
  reviewId: z.string(),
  organizationId: z.string(),
  propertyId: z.string(),
  sourceEpoch: z.number().int().nonnegative(),
  sourceRevision: z.number().int().positive(),
  analysisSequence: z.number().int().positive(),
  occurredAt: z.string(),
})

export function registerAiEventSchemas(version: number): void {
  registerEventSchema({
    type: 'ai.property_trend.generation_requested',
    version,
    schema: aiPropertyTrendGenerationRequestedSchema,
  })
  registerEventSchema({
    type: 'ai.review_analysis.backfill_requested',
    version,
    schema: aiReviewAnalysisBackfillRequestedSchema,
  })
  registerEventSchema({
    type: 'ai.review_analysis.urgent_detected',
    version,
    schema: aiReviewUrgentDetectedSchema,
  })
}
