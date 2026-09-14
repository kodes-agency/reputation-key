// Identity context — DTOs for the Merchant AI consent commands.
// The server functions validate with these; the use case stays the authority
// for everything a schema cannot know (the served notice, authority, state).

import { z } from 'zod/v4'

export const merchantAiCapabilityInputSchema = z.enum([
  'review_analysis',
  'reply_drafting',
  'property_trends',
])

export const merchantAiAuthorizationInputSchema = z.object({
  propertyId: z.uuid().optional(),
})

/** A decision that grants nothing ("not now"), so it carries no consent. */
export const merchantAiPropertyInputSchema = z.object({
  propertyId: z.uuid(),
})

/** A revoke: withdraws consent, so it carries no acknowledgement. */
export const merchantAiCommandInputSchema = z.object({
  propertyId: z.uuid(),
  idempotencyKey: z.string().min(8).max(128),
  expectedStateVersion: z.number().int().safe().nonnegative(),
})

/**
 * The notice the merchant acknowledged, exactly as the authorization read
 * served it. It is a claim about what was on screen, checked against the
 * served notice by the use case.
 */
export const merchantAiNoticeAcknowledgementSchema = z.object({
  noticeVersion: z.string().min(1).max(100),
  noticeDigest: z.string().regex(/^[0-9a-f]{64}$/),
})

/** An enable: grants consent for the current capability bundle. */
export const merchantAiConsentCommandInputSchema = merchantAiCommandInputSchema.extend({
  acknowledgement: merchantAiNoticeAcknowledgementSchema,
})

/** A change: grants consent for exactly these capabilities. */
export const merchantAiCapabilityChangeInputSchema =
  merchantAiConsentCommandInputSchema.extend({
    capabilities: z.array(merchantAiCapabilityInputSchema).min(1).max(3),
  })

/**
 * One consent ceremony for several Properties: an import batch at most. The use
 * case refuses a Property listed twice.
 */
export const merchantAiEnableForPropertiesInputSchema = z.object({
  propertyIds: z.array(z.uuid()).min(1).max(100),
  capabilities: z.array(merchantAiCapabilityInputSchema).min(1).max(3),
  acknowledgement: merchantAiNoticeAcknowledgementSchema,
  idempotencyKey: z.string().min(8).max(128),
})
