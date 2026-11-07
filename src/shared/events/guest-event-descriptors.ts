import { z } from 'zod/v4'
import type { EventDescriptor } from './descriptor'
import { primaryStaffAttributionSchema } from './staff-attribution-schema'

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

export const guestEventDescriptors = [
  {
    type: 'guest.scan.recorded',
    aggregate: { type: 'property', id: 'propertyId' },
    version: 1,
    schema: guestScanV1Schema,
  },
  {
    type: 'guest.scan.recorded',
    aggregate: { type: 'property', id: 'propertyId' },
    version: 2,
    emits: (event) => 'scanSource' in event,
    schema: guestScanV2Schema,
  },
  {
    type: 'guest.qualified_scan.recorded',
    aggregate: { type: 'property', id: 'propertyId' },
    version: 1,
    schema: guestQualifiedScanSchema,
  },
  {
    type: 'guest.qualified_scan.retracted',
    aggregate: { type: 'property', id: 'propertyId' },
    version: 1,
    schema: guestQualifiedScanRetractedSchema,
  },
  {
    type: 'guest.rating.submitted',
    aggregate: { type: 'property', id: 'propertyId' },
    version: 1,
    schema: guestRatingSchema,
  },
  {
    type: 'guest.rating.retracted',
    aggregate: { type: 'property', id: 'propertyId' },
    version: 1,
    schema: guestRatingRetractedSchema,
  },
  {
    type: 'guest.feedback.submitted',
    aggregate: { type: 'property', id: 'propertyId' },
    version: 1,
    schema: guestFeedbackSchema,
  },
  {
    type: 'guest.feedback.retracted',
    aggregate: { type: 'property', id: 'propertyId' },
    version: 1,
    schema: guestFeedbackRetractedSchema,
  },
  {
    type: 'guest.qualified_scan.recorded',
    aggregate: { type: 'property', id: 'propertyId' },
    version: 2,
    emits: (event) => 'staffAttribution' in event,
    schema: guestQualifiedScanV2Schema,
  },
  {
    type: 'guest.qualified_scan.retracted',
    aggregate: { type: 'property', id: 'propertyId' },
    version: 2,
    emits: (event) => 'staffAttribution' in event,
    schema: guestQualifiedScanRetractedV2Schema,
  },
  {
    type: 'guest.rating.submitted',
    aggregate: { type: 'property', id: 'propertyId' },
    version: 2,
    emits: (event) => 'staffAttribution' in event,
    schema: guestRatingV2Schema,
  },
  {
    type: 'guest.rating.retracted',
    aggregate: { type: 'property', id: 'propertyId' },
    version: 2,
    emits: (event) => 'staffAttribution' in event,
    schema: guestRatingRetractedV2Schema,
  },
  {
    type: 'guest.feedback.submitted',
    aggregate: { type: 'property', id: 'propertyId' },
    version: 2,
    emits: (event) => 'staffAttribution' in event,
    schema: guestFeedbackV2Schema,
  },
  {
    type: 'guest.feedback.retracted',
    aggregate: { type: 'property', id: 'propertyId' },
    version: 2,
    emits: (event) => 'staffAttribution' in event,
    schema: guestFeedbackRetractedV2Schema,
  },
  {
    type: 'guest.feedback.submitted',
    aggregate: { type: 'property', id: 'propertyId' },
    version: 3,
    emits: (event) => 'responseRevision' in event,
    schema: guestFeedbackV3Schema,
  },
  {
    type: 'guest.feedback.retracted',
    aggregate: { type: 'property', id: 'propertyId' },
    version: 3,
    emits: (event) => 'responseRevision' in event,
    schema: guestFeedbackRetractedV3Schema,
  },
  {
    type: 'guest.review_link.clicked',
    aggregate: { type: 'property', id: 'propertyId' },
    version: 1,
    schema: guestReviewLinkClickedSchema,
  },
] as const satisfies readonly EventDescriptor[]
