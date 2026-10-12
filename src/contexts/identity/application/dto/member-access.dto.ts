// Identity context — DTOs for editing a PropertyManager's Property access
// from Members. Browser-safe: the Members UI imports the schema and types.

import { z } from 'zod/v4'
import type {
  AppliedPropertyAccess,
  MemberPropertyAccess,
} from '../ports/member-property-access.port'

/** Bounds one request; an Organization's Property list stays well below it. */
const MAX_PROPERTY_IDS_PER_CHANGE = 200

const propertyIdsSchema = z.array(z.uuid()).max(MAX_PROPERTY_IDS_PER_CHANGE).default([])

export const setMemberPropertyAccessInputSchema = z
  .object({
    memberId: z.string().min(1, 'Member ID is required'),
    grantPropertyIds: propertyIdsSchema,
    revokePropertyIds: propertyIdsSchema,
  })
  .refine((input) => input.grantPropertyIds.length + input.revokePropertyIds.length > 0, {
    message: 'Choose at least one Property to grant or revoke',
  })
  .refine(
    (input) => !input.grantPropertyIds.some((id) => input.revokePropertyIds.includes(id)),
    { message: 'A Property cannot be granted and revoked at once' },
  )
export type SetMemberPropertyAccessInput = z.infer<
  typeof setMemberPropertyAccessInputSchema
>

/** The Properties the change actually granted and revoked. */
export type SetMemberPropertyAccessOutput = AppliedPropertyAccess

/** Every member's current Property grants in the active Organization. */
export type ListMemberPropertyAccessOutput = Readonly<{
  access: ReadonlyArray<MemberPropertyAccess>
}>
