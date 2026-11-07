// Identity membership-access event schemas, registered by
// ./schema-registrations.ts.
//
// Who joined through whose invitation, and which Properties an AccountAdmin
// granted or revoked for a PropertyManager. Identifiers only (ADR 0030): Feed
// resolves names at delivery, and no notice names another person.

import { z } from 'zod/v4'
import type { EventDescriptor } from './descriptor'

/** Mirrors the request bound: one change touches at most 200 Properties. */
const MAX_CHANGED_PROPERTIES = 200

const invitationAcceptedSchema = z.object({
  organizationId: z.string(),
  userId: z.string(),
  invitationId: z.string(),
  // Additive at version 1: the inviter hears their invitation was accepted.
  // Facts recorded before it was added lack it.
  inviterId: z.string().optional(),
})

const memberPropertyAccessChangedSchema = z.object({
  organizationId: z.string(),
  memberUserId: z.string(),
  // The AccountAdmin who made the change.
  userId: z.string(),
  grantedPropertyIds: z.array(z.uuid()).max(MAX_CHANGED_PROPERTIES),
  revokedPropertyIds: z.array(z.uuid()).max(MAX_CHANGED_PROPERTIES),
})

/** Both issued access facts retain their first schema version. */
export const identityAccessEventDescriptors = [
  {
    type: 'identity.invitation.accepted',
    aggregate: { type: 'invitation', id: 'invitationId' },
    version: 1,
    schema: invitationAcceptedSchema,
  },
  {
    type: 'identity.member.property_access_changed',
    aggregate: { type: 'user', id: 'userId' },
    version: 1,
    schema: memberPropertyAccessChangedSchema,
  },
] as const satisfies readonly EventDescriptor[]
