// Identity context — DTOs for invitation flow
// Zod schemas for input/output shapes that cross network boundaries.
// Per architecture: "Zod at HTTP boundaries (server function inputs)"

import { z } from 'zod/v4'

export const inviteMemberInputSchema = z.object({
  email: z.email('A valid email address is required'),
  role: z.enum(['AccountAdmin', 'PropertyManager', 'Staff'] as const),
})
export type InviteMemberInput = z.infer<typeof inviteMemberInputSchema>

export const acceptInvitationInputSchema = z.object({
  invitationId: z.string().min(1, 'Invitation ID is required'),
})
export type AcceptInvitationInput = z.infer<typeof acceptInvitationInputSchema>

export const updateMemberRoleInputSchema = z.object({
  memberId: z.string().min(1, 'Member ID is required'),
  role: z.enum(['AccountAdmin', 'PropertyManager', 'Staff'] as const),
})
export type UpdateMemberRoleInput = z.infer<typeof updateMemberRoleInputSchema>

export const removeMemberInputSchema = z.object({
  memberId: z.string().min(1, 'Member ID is required'),
})
export type RemoveMemberInput = z.infer<typeof removeMemberInputSchema>

export const registerUserInputSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100),
  email: z.email('A valid email address is required'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  organizationName: z
    .string()
    .min(2, 'Organization name must be at least 2 characters')
    .max(100, 'Organization name must be at most 100 characters'),
})
export type RegisterUserInput = z.infer<typeof registerUserInputSchema>

export const setActiveOrgInputSchema = z.object({
  organizationId: z.string().min(1, 'Organization ID is required'),
})
export type SetActiveOrgInput = z.infer<typeof setActiveOrgInputSchema>

export const signInInputSchema = z.object({
  email: z.email('A valid email address is required'),
  password: z.string().min(1, 'Password is required'),
})
export type SignInInput = z.infer<typeof signInInputSchema>

/** Role as returned in API responses */
export const roleSchema = z.enum(['AccountAdmin', 'PropertyManager', 'Staff'] as const)
export type RoleResponse = z.infer<typeof roleSchema>

export const memberResponseSchema = z.object({
  id: z.string(),
  userId: z.string(),
  role: roleSchema,
  email: z.string(),
  name: z.string(),
  image: z.string().nullable(),
  createdAt: z.date(),
})
export type MemberResponse = z.infer<typeof memberResponseSchema>

export const invitationResponseSchema = z.object({
  id: z.string(),
  email: z.string(),
  role: roleSchema,
  status: z.enum(['pending', 'accepted', 'rejected', 'canceled'] as const),
  expiresAt: z.date(),
  createdAt: z.date(),
})
export type InvitationResponse = z.infer<typeof invitationResponseSchema>
