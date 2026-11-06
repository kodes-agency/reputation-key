import { z } from 'zod/v4'

export const propertyGoogleBindingChangedSchema = z
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
    importFollowUps: z.literal(true).optional(),
  })
  .strict()
  .transform(
    ({
      organizationId,
      propertyId,
      connectionId,
      sourceEpoch,
      change,
      occurredAt,
      importFollowUps,
    }) => ({
      organizationId,
      propertyId,
      connectionId,
      sourceEpoch,
      change,
      occurredAt,
      ...(importFollowUps ? { importFollowUps } : {}),
    }),
  )
