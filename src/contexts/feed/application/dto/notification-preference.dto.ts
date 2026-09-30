import { z } from 'zod/v4'

// The Property preference endpoints' request shapes. They live here, not in the
// server-function module: a plain export from that module survives the RPC
// transform and ships in the client's initial bundle.

const quietTime = z
  .string()
  .regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/)
  .nullable()

/** Configurable Property categories; Organization mandatory policy is refused. */
export const notificationPreferenceCategory = z.enum([
  'urgent_operational',
  'low_ratings',
  'arrivals',
  'workflow_collaboration',
  'recognition',
])

const notificationChannel = z.enum(['in_app', 'email'])

/**
 * One (Property, category, channel) row: whether it is delivered, and how
 * often. Quiet hours and the urgent bypass are no longer here — they are the
 * person's, saved through `notificationQuietHoursDto` (ADR 0046, amended
 * 2026-09-23).
 *
 * `applyToAllProperties` makes the same answer the person's default for every
 * Property they have and every Property they are given next.
 */
export const updateNotificationPreferenceDto = z
  .object({
    propertyId: z.uuid(),
    category: notificationPreferenceCategory,
    channel: notificationChannel,
    enabled: z.boolean(),
    cadence: z.enum(['immediate', 'daily']),
    /**
     * Low ratings only, and required there: the highest rating this channel
     * is on for ("N★ or lower"). Refused for every other category.
     */
    maxRating: z
      .union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)])
      .optional(),
    applyToAllProperties: z.boolean().optional(),
  })
  .refine(
    (value) => (value.category === 'low_ratings') === (value.maxRating !== undefined),
    'Choose how low a rating to be told about, for Low ratings only',
  )

/**
 * The person's quiet hours and urgent bypass, or one Property's override of
 * them. `propertyId` names the Property being overridden; omitted, this is the
 * person's own window for every Property that does not override it.
 *
 * `follow: true` removes a Property's override so it follows the person again;
 * it is refused without a `propertyId`, because a person always has a window
 * of their own even when it holds nothing back.
 */
export const notificationQuietHoursDto = z
  .object({
    propertyId: z.uuid().optional(),
    follow: z.boolean().optional(),
    quietHoursStart: quietTime.optional(),
    quietHoursEnd: quietTime.optional(),
    urgentBypassEnabled: z.boolean().optional(),
  })
  .refine(
    (value) => value.follow !== true || value.propertyId !== undefined,
    'Only a property can follow your quiet hours',
  )
  // Delivery reads equal times as no quiet hours at all.
  .refine(
    (value) =>
      value.quietHoursStart == null || value.quietHoursStart !== value.quietHoursEnd,
    'Quiet hours must start and end at different times',
  )
  .refine(
    (value) =>
      value.follow === true ||
      (value.quietHoursStart === null) === (value.quietHoursEnd === null),
    'Quiet hours need both a start and an end',
  )

export type NotificationQuietHoursInput = z.infer<typeof notificationQuietHoursDto>
