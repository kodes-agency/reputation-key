// Portal workflow fact schemas, registered by ./schema-registrations.ts.
//
// A content review records three facts at once: the review itself, the
// configuration completeness and the approved destination ratio. They share
// one base contract per version, so they live together, apart from the
// registration list. Version 2 added the aggregate revision.

import { z } from 'zod/v4'

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

const completenessCounts = {
  completedFields: z.number().int().nonnegative(),
  requiredFields: z.number().int().positive(),
}

const destinationCounts = {
  approvedDestinations: z.number().int().nonnegative(),
  configuredDestinations: z.number().int().nonnegative(),
}

export const portalContentReviewCompletedV1Schema = portalWorkflowFactV1Schema
export const portalContentReviewCompletedV2Schema = portalWorkflowFactV2Schema
export const portalConfigurationCompletenessRecordedV1Schema =
  portalWorkflowFactV1Schema.extend(completenessCounts)
export const portalConfigurationCompletenessRecordedV2Schema =
  portalWorkflowFactV2Schema.extend(completenessCounts)
// v3 names the fields it counted. v1 and v2 facts all counted the legacy
// settings (name, description, theme colour, categories, link addresses).
export const portalConfigurationCompletenessRecordedV3Schema =
  portalConfigurationCompletenessRecordedV2Schema.extend({
    fieldSet: z.enum(['immersive_hub']),
  })
export const portalApprovedDestinationRatioRecordedV1Schema =
  portalWorkflowFactV1Schema.extend(destinationCounts)
export const portalApprovedDestinationRatioRecordedV2Schema =
  portalWorkflowFactV2Schema.extend(destinationCounts)
