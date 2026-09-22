// The Recent Activity reads' inputs, kept apart from the server functions so
// the client bundle never carries them (a server-fn module's exports stay in
// its client stub) and their bounds can be tested at the boundary.
//
// Whole numbers only: a fraction or an exponent otherwise passed validation and
// failed in PostgreSQL's LIMIT/OFFSET parse as a masked 500, not a 400.

import { z } from 'zod/v4'
import { ACTIVITY_RESOURCE_TYPES } from '../../domain/activity-types'

// Derive accepted resourceType values from the domain ResourceType union so the
// DTO cannot drift from the domain (ctx-small §6): team / staff_assignment /
// integration activity was previously rejected with a 400 because the enum
// lagged the ResourceTypes that handlers write ('organization' added in
// BQC-3.9 for the identity.organization.created Recent Activity consumer).
export const activityTimelineReadDto = z.object({
  resourceType: z.enum(ACTIVITY_RESOURCE_TYPES),
  resourceId: z.string(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
})

/** Deeper than any reader pages by hand; past it the offset scan only costs the database. */
const MAX_RECENT_ACTIVITY_OFFSET = 10_000

export const recentActivityListDto = z.object({
  propertyId: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional().default(50),
  offset: z.coerce
    .number()
    .int()
    .min(0)
    .max(MAX_RECENT_ACTIVITY_OFFSET)
    .optional()
    .default(0),
})
