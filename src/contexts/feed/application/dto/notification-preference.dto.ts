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
  'workflow_collaboration',
  'recognition',
])

const notificationChannel = z.enum(['in_app', 'email'])

export const updateNotificationPreferenceDto = z
  .object({
    propertyId: z.uuid(),
    category: notificationPreferenceCategory,
    channel: notificationChannel,
    enabled: z.boolean(),
    cadence: z.enum(['immediate', 'daily']),
    urgentBypassEnabled: z.boolean(),
    quietHoursStart: quietTime,
    quietHoursEnd: quietTime,
  })
  // Delivery reads equal times as no quiet hours at all.
  .refine(
    (data) =>
      data.quietHoursStart === null || data.quietHoursStart !== data.quietHoursEnd,
    'Quiet hours must start and end at different times',
  )
