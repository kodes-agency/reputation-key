// Identity membership-access event schemas, registered by
// ./schema-registrations.ts.
//
// Who joined through whose invitation, and which Properties an AccountAdmin
// granted or revoked for a PropertyManager. Identifiers only (ADR 0030): Feed
// resolves names at delivery, and no notice names another person.

import { z } from 'zod/v4'
import { registerEventSchema } from './schema-registry'

/** Both facts are at their first version; `inviterId` was added in place. */
const IDENTITY_ACCESS_EVENT_VERSION = 1

/** Mirrors the request bound: one change touches at most 200 Properties. */
const MAX_CHANGED_PROPERTIES = 200

export const invitationAcceptedSchema = z.object({
  organizationId: z.string(),
  userId: z.string(),
  invitationId: z.string(),
  // Additive at version 1: the inviter hears their invitation was accepted.
  // Facts recorded before it was added lack it.
  inviterId: z.string().optional(),
})

export const memberPropertyAccessChangedSchema = z.object({
  organizationId: z.string(),
  memberUserId: z.string(),
  // The AccountAdmin who made the change.
  userId: z.string(),
  grantedPropertyIds: z.array(z.uuid()).max(MAX_CHANGED_PROPERTIES),
  revokedPropertyIds: z.array(z.uuid()).max(MAX_CHANGED_PROPERTIES),
})

/** Register both schemas; called once from registerAllEventSchemas. */
export function registerIdentityAccessEventSchemas(): void {
  registerEventSchema({
    type: 'identity.invitation.accepted',
    version: IDENTITY_ACCESS_EVENT_VERSION,
    schema: invitationAcceptedSchema,
  })
  registerEventSchema({
    type: 'identity.member.property_access_changed',
    version: IDENTITY_ACCESS_EVENT_VERSION,
    schema: memberPropertyAccessChangedSchema,
  })
}
