// Portal context — create portal DTO
// Per architecture: "Zod schema for HTTP input, also reused as the form schema."

import { z } from 'zod/v4'
import { MAX_ADDITIONAL_GUEST_LOCALES } from '#/shared/domain/guest-locale'
import { offeredGuestLocaleSchema } from '#/shared/guest-locale-schemas'

/** What a new Portal starts from: the Property's wording, or a copy of another Portal. */
const newPortalStartFromSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('property') }).strict(),
  z
    .object({
      kind: z.literal('portal'),
      portalId: z.string().min(1, 'Choose the portal to copy'),
    })
    .strict(),
])

/** At most this many responsible managers can be named when a Portal is created. */
const MAX_INITIAL_RESPONSIBLE_MANAGERS = 20

const createPortalFieldsSchema = z.object({
  name: z.string().min(1, 'Portal name is required').max(100),
  slug: z.string().min(2).max(64).optional(),
  /** The group the Portal joins as it is created; none when omitted. */
  groupId: z.string().min(1).optional(),
  /** The first language is the primary. Defaults to the Property's (or the copied Portal's). */
  guestLocales: z
    .array(offeredGuestLocaleSchema)
    .min(1, 'Choose at least one language')
    .max(MAX_ADDITIONAL_GUEST_LOCALES + 1)
    .refine((locales) => new Set(locales).size === locales.length, {
      message: 'Guest locales must be unique',
    })
    .optional(),
  startFrom: newPortalStartFromSchema.optional(),
  /** Omitted: the creator when eligible. An empty list starts the Portal with nobody. */
  responsibleManagerUserIds: z
    .array(z.string().min(1))
    .max(MAX_INITIAL_RESPONSIBLE_MANAGERS)
    .optional(),
  description: z.string().max(500).optional(),
  privateFeedbackThreshold: z.number().int().min(1).max(5).optional(),
  propertyId: z.string().min(1, 'Property ID is required'),
  entityType: z.literal('property').optional(),
  entityId: z.string().optional(),
  theme: z
    .object({
      primaryColor: z.string(),
      backgroundColor: z.string().optional(),
      textColor: z.string().optional(),
    })
    .optional(),
})

export const createPortalInputSchema = createPortalFieldsSchema
  .strict()
  .superRefine((input, ctx) => {
    if (input.entityId !== undefined && input.entityId !== input.propertyId) {
      ctx.addIssue({
        code: 'custom',
        path: ['entityId'],
        message: 'Portal ownership must match the selected Property',
      })
    }
  })

/**
 * The New portal dialog's own values. Everything is a plain value so the form
 * can hold it: `''` means "no group" and "the default manager", and the copy
 * choice is only read when `startFrom` is `portal`.
 */
export const newPortalFormSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, 'Give the portal a name')
      .max(100, 'Use at most 100 characters'),
    groupId: z.string(),
    guestLocales: z
      .array(offeredGuestLocaleSchema)
      .min(1, 'Choose at least one language'),
    startFrom: z.enum(['property', 'portal']),
    sourcePortalId: z.string(),
    /** Null keeps the default: the creator, when eligible. */
    responsibleManagerUserIds: z.array(z.string()).nullable(),
  })
  .superRefine((values, ctx) => {
    if (values.startFrom === 'portal' && values.sourcePortalId === '') {
      ctx.addIssue({
        code: 'custom',
        path: ['sourcePortalId'],
        message: 'Choose the portal to copy',
      })
    }
  })

export type CreatePortalInput = z.infer<typeof createPortalInputSchema>
export type NewPortalFormValues = z.infer<typeof newPortalFormSchema>
