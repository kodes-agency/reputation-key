// AI event schemas, registered by ./schema-registrations.ts.
//
// Every AI fact is identifier-only (ADR 0030): which Property, which review revision,
// which analysis. Nothing a provider said and nothing a guest wrote crosses, and a
// field called `reason` would be stripped from an outbox payload as content
// (./../outbox/event-adapter.ts) in any case.

import { z } from 'zod/v4'
import { REVIEW_TOPICS_V3 } from '../review-topic-taxonomy'
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

// A Property's Guest voice summary is due to be mailed. Governed facts only: the twelve
// fixed topics, counts, a window, the stars a problem may be worth, and the issue a line
// links to by its opaque id. No cause, quote, person, review or Inbox item, and not the
// issue's name, which is the guests' words boiled down (ADR 0046 r.8; ADR 0031). Bounded:
// at most three lines, one per kind the page's "In short" has.
const guestVoiceSummaryLineSchema = z.object({
  kind: z.enum(['fix_first', 'protect', 'change']),
  topic: z.enum(REVIEW_TOPICS_V3),
  issueId: z.string().min(1).max(64).nullable(),
  reviewCount: z.number().int().min(0).max(1_000_000),
  textReviewCount: z.number().int().min(0).max(1_000_000),
  upTo: z.number().min(0).max(5).nullable(),
  change: z.enum(['rising', 'falling']).nullable(),
  polarity: z.enum(['complaint', 'praise']).nullable(),
})

const localDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

const aiGuestVoiceSummaryReadySchema = z.object({
  organizationId: z.string(),
  propertyId: z.string(),
  summaryKind: z.enum(['weekly', 'monthly']),
  localDate: localDateSchema,
  window: z.enum(['30d', '90d', '180d', '365d']),
  startLocalDate: localDateSchema,
  endLocalDate: localDateSchema,
  lines: z.array(guestVoiceSummaryLineSchema).max(3),
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
  registerEventSchema({
    type: 'ai.guest_voice_summary.ready',
    version,
    schema: aiGuestVoiceSummaryReadySchema,
  })
}
