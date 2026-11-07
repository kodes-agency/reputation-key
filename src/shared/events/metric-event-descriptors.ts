import { z } from 'zod/v4'
import type { EventDescriptor } from './descriptor'
import { primaryStaffAttributionSchema } from './staff-attribution-schema'

// ── Metric event schemas ────────────────────────────────────────────

// Keep both metric.recorded versions decodable while stored outbox rows age out.
// New readings emit only correction facts when they replace an earlier reading.
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

export const metricEventDescriptors = [
  {
    type: 'metric.recorded',
    aggregate: { type: 'property', id: 'propertyId' },
    version: 1,
    schema: metricRecordedSchema,
  },
  {
    type: 'metric.corrected',
    aggregate: { type: 'property', id: 'propertyId' },
    version: 1,
    schema: metricCorrectedSchema,
  },
  {
    type: 'metric.recorded',
    aggregate: { type: 'property', id: 'propertyId' },
    version: 2,
    emits: (event) => 'staffAttribution' in event,
    schema: metricRecordedV2Schema,
  },
  {
    type: 'metric.corrected',
    aggregate: { type: 'property', id: 'propertyId' },
    version: 2,
    emits: (event) => 'staffAttribution' in event,
    schema: metricCorrectedV2Schema,
  },
] as const satisfies readonly EventDescriptor[]
